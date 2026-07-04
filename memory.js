/**
 * 翻译记忆库模块
 * 管理翻译历史记录，支持搜索、筛选、导入导出
 */
const VibeMemory = {
  // 当前选中的记忆库条目（用于模态框操作）
  selectedItem: null,
  // 预览弹窗的原始数据快照（用于撤销）
  previewOriginalData: null,
  items: [],

  // 搜索和筛选条件
  searchQuery: '',
  langFilter: 'all',
  categoryFilter: 'all',
  // 高级筛选：使用次数、相似度、来源类型
  usageFilter: 'all',          // all | high | low | unused
  usageThreshold: 5,           // 高频阈值（>=5 视为高频）
  sourceFilter: 'all',         // all | human | machine
  similarityQuery: '',         // 相似度筛选的参考文本
  similarityThreshold: 70,     // 相似度筛选阈值
  // 排序：默认按入库时间倒序
  sortBy: 'createTimeDesc',   // createTimeDesc | createTimeAsc | useCountDesc | useCountAsc | similarityDesc

  // 分页
  currentPage: 1,
  pageSize: 20,
  totalResults: 0,

  // 批量选中的条目ID
  selectedIds: new Set(),
  batchMode: false,

  // 记忆库分类
  categories: [],
  defaultCategories: [
    { id: 'default', name: '通用', icon: '📦', color: '#165dff' },
    { id: 'movie', name: '电影', icon: '🎬', color: '#ff6b6b' },
    { id: 'course', name: '网课', icon: '🎓', color: '#52c41a' },
    { id: 'shortvideo', name: '短视频', icon: '📱', color: '#faad14' },
    { id: 'business', name: '商务', icon: '💼', color: '#722ed1' }
  ],

  // 匹配规则设置
  matchSettings: {
    ignoreCase: true,
    ignorePunctuation: true,
    segmentMatch: true,
    threshold: 70
  },

  /**
   * 生成标准本地时间戳（精确到分）
   * @returns {string} YYYY-MM-DD HH:mm 格式
   */
  generateTimestamp() {
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  },

  /**
   * 初始化记忆库
   * 从localStorage加载数据
   */
  init() {
    try {
      // 加载分类
      const savedCategories = VibeStorage.get(VibeStorage.KEYS.MEMORY_CATEGORIES, null);
      if (savedCategories && Array.isArray(savedCategories) && savedCategories.length > 0) {
        this.categories = savedCategories;
      } else {
        this.categories = [...this.defaultCategories];
        this.saveCategories();
      }

      // 加载匹配设置
      const savedSettings = VibeStorage.get(VibeStorage.KEYS.MEMORY_SETTINGS, null);
      if (savedSettings) {
        this.matchSettings = { ...this.matchSettings, ...savedSettings };
      }

      const saved = VibeStorage.get(VibeStorage.KEYS.MEMORY, []);
      this.items = Array.isArray(saved) ? saved : [];
      // 兼容旧数据：补充缺失字段
      this.items = this.items.map(item => ({
        ...item,
        createTime: item.createTime || item.createdAt || this.generateTimestamp(),
        updateTime: item.updateTime || item.lastUsed || this.generateTimestamp(),
        category: item.category || 'default'
      }));
      // 按入库时间倒序排序
      this.items.sort((a, b) => {
        const timeA = new Date(a.createTime);
        const timeB = new Date(b.createTime);
        return timeB - timeA;
      });
      this.renderCategories();
      this.applyCategoryFilter(this.categoryFilter);
      if (document.getElementById('memoryTotal')) {
        this.updateStats();
      }
    } catch (error) {
      console.error('Memory init error:', error);
      this.items = [];
      this.categories = [...this.defaultCategories];
    }
  },

  /**
   * 添加翻译记录到记忆库
   * @param {string} sourceText - 原文
   * @param {string} targetText - 译文
   * @param {string} sourceLang - 源语言
   * @param {string} targetLang - 目标语言
   * @param {string} category - 分类
   * @param {string} translationSource - 翻译来源：'human' | 'api' | 'machine'
   * @returns {Object} 添加的记录
   */
  add(sourceText, targetText, sourceLang, targetLang, category = 'default', translationSource = 'human') {
    if (!sourceText.trim() || !targetText.trim()) {
      return null;
    }

    const now = this.generateTimestamp();

    // 检查是否已存在相同记录
    const existing = this.items.find(item =>
      item.sourceText === sourceText &&
      item.sourceLang === sourceLang &&
      item.targetLang === targetLang &&
      item.category === category
    );

    if (existing) {
      existing.useCount++;
      existing.lastUsed = now;
      existing.updateTime = now;
      existing.targetText = targetText.trim();
      existing.translationSource = translationSource;
      existing.source = translationSource;
    } else {
      const newItem = {
        id: Date.now() + Math.random(),
        sourceText: sourceText.trim(),
        targetText: targetText.trim(),
        sourceLang,
        targetLang,
        langPair: `${sourceLang}-${targetLang}`,
        category,
        matchScore: 100,
        useCount: 1,
        createdAt: now,
        lastUsed: now,
        createTime: now,
        updateTime: now,
        translationSource: translationSource,
        source: translationSource
      };
      this.items.unshift(newItem);
    }

    this.save();
    this.render();
    this.updateStats();

    return existing || this.items[0];
  },

  /**
   * 根据ID删除记录
   * @param {number} id - 记录ID
   * @returns {boolean} 是否删除成功
   */
  remove(id) {
    const index = this.items.findIndex(item => item.id === id);
    if (index !== -1) {
      this.items.splice(index, 1);
      this.save();
      this.render();
      this.updateStats();
      return true;
    }
    return false;
  },

  /**
   * 清空所有记录
   */
  clear() {
    this.items = [];
    this.save();
    this.render();
    this.updateStats();
  },

  // ===== 批量编辑 =====

  toggleBatchMode() {
    this.batchMode = !this.batchMode;
    if (!this.batchMode) {
      this.selectedIds.clear();
    }
    this.render();
    this.renderBatchToolbar();
  },

  toggleSelection(id) {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.renderBatchToolbar();
  },

  selectAll() {
    const results = this.search(this.searchQuery, this.langFilter, this.categoryFilter);
    results.forEach(item => this.selectedIds.add(item.id));
    this.render();
    this.renderBatchToolbar();
  },

  deselectAll() {
    this.selectedIds.clear();
    this.render();
    this.renderBatchToolbar();
  },

  batchDelete() {
    if (this.selectedIds.size === 0) {
      VibeApp.showToast('请先选择要删除的条目', 'info');
      return;
    }
    if (!confirm(`确定要删除选中的 ${this.selectedIds.size} 条记录吗？`)) return;

    const idSet = new Set(this.selectedIds);
    this.items = this.items.filter(item => !idSet.has(item.id));
    this.selectedIds.clear();
    this.save();
    this.render();
    this.renderBatchToolbar();
    this.updateStats();
    VibeApp.showToast('批量删除成功', 'success');
  },

  batchUpdateLangPair(sourceLang, targetLang) {
    if (this.selectedIds.size === 0) {
      VibeApp.showToast('请先选择要修改的条目', 'info');
      return;
    }
    if (!sourceLang || !targetLang) {
      VibeApp.showToast('请选择源语言和目标语言', 'error');
      return;
    }

    const idSet = new Set(this.selectedIds);
    let count = 0;
    this.items.forEach(item => {
      if (idSet.has(item.id)) {
        item.sourceLang = sourceLang;
        item.targetLang = targetLang;
        item.langPair = `${sourceLang}-${targetLang}`;
        item.updateTime = this.generateTimestamp();
        count++;
      }
    });

    this.save();
    this.render();
    VibeApp.showToast(`已更新 ${count} 条记录的语言对`, 'success');
  },

  batchUpdateText(findText, replaceText, field = 'both') {
    if (this.selectedIds.size === 0) {
      VibeApp.showToast('请先选择要修改的条目', 'info');
      return;
    }
    if (!findText) {
      VibeApp.showToast('请输入查找内容', 'error');
      return;
    }

    const idSet = new Set(this.selectedIds);
    let count = 0;
    this.items.forEach(item => {
      if (idSet.has(item.id)) {
        if (field === 'both' || field === 'source') {
          if (item.sourceText.includes(findText)) {
            item.sourceText = item.sourceText.split(findText).join(replaceText);
          }
        }
        if (field === 'both' || field === 'target') {
          if (item.targetText.includes(findText)) {
            item.targetText = item.targetText.split(findText).join(replaceText);
          }
        }
        item.updateTime = this.generateTimestamp();
        count++;
      }
    });

    this.save();
    this.render();
    VibeApp.showToast(`已更新 ${count} 条记录的文本`, 'success');
  },

  renderBatchToolbar() {
    const toolbar = document.getElementById('memoryBatchToolbar');
    if (!toolbar) return;

    if (!this.batchMode) {
      toolbar.style.display = 'none';
      return;
    }

    toolbar.style.display = 'flex';
    const count = this.selectedIds.size;
    const countEl = document.getElementById('batchSelectedCount');
    if (countEl) countEl.textContent = count;
  },

  // ===== 分类管理 =====

  saveCategories() {
    VibeStorage.set(VibeStorage.KEYS.MEMORY_CATEGORIES, this.categories);
  },

  saveMatchSettings() {
    VibeStorage.set(VibeStorage.KEYS.MEMORY_SETTINGS, this.matchSettings);
  },

  createCategory(name, icon = '📁', color = '#165dff') {
    const id = 'cat_' + Date.now();
    this.categories.push({ id, name, icon, color });
    this.saveCategories();
    this.renderCategories();
    VibeApp.showToast(`分类「${name}」创建成功`, 'success');
    return id;
  },

  deleteCategory(id) {
    if (id === 'default') {
      VibeApp.showToast('默认分类不可删除', 'error');
      return;
    }
    if (!confirm('删除分类后，该分类下的条目将移至「通用」分类。确定删除？')) return;

    // 将该分类下的条目移至默认分类
    this.items.forEach(item => {
      if (item.category === id) {
        item.category = 'default';
      }
    });

    this.categories = this.categories.filter(c => c.id !== id);
    if (this.categoryFilter === id) {
      this.categoryFilter = 'all';
    }
    this.saveCategories();
    this.save();
    this.renderCategories();
    this.render();
    VibeApp.showToast('分类已删除', 'success');
  },

  renderCategories() {
    const container = document.getElementById('memoryCategories');
    if (!container) return;

    const allCount = this.items.length;
    let html = `<button class="category-chip ${this.categoryFilter === 'all' ? 'active' : ''}" 
      onclick="VibeMemory.applyCategoryFilter('all')">
      <span class="cat-icon">🗂️</span>
      <span class="cat-name">全部</span>
      <span class="cat-count">${allCount}</span>
    </button>`;

    this.categories.forEach(cat => {
      const count = this.items.filter(i => i.category === cat.id).length;
      html += `<button class="category-chip ${this.categoryFilter === cat.id ? 'active' : ''}" 
        onclick="VibeMemory.applyCategoryFilter('${cat.id}')"
        style="--cat-color: ${cat.color}">
        <span class="cat-icon">${cat.icon}</span>
        <span class="cat-name">${this.escapeHtml(cat.name)}</span>
        <span class="cat-count">${count}</span>
      </button>`;
    });

    html += `<button class="category-chip add-category" onclick="VibeMemory.showCreateCategoryDialog()">
      <span class="cat-icon">➕</span>
      <span class="cat-name">新建</span>
    </button>`;

    container.innerHTML = html;
  },

  applyCategoryFilter(category) {
    this.categoryFilter = category;
    this.renderCategories();
    this.render();
  },

  showCreateCategoryDialog() {
    let modal = document.getElementById('createCategoryModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'createCategoryModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
          <button class="modal-close-btn" onclick="document.getElementById('createCategoryModal').classList.remove('show')">✕</button>
          <h3 style="margin-bottom: 16px;">新建分类</h3>
          <div class="form-group">
            <label>分类名称</label>
            <input type="text" id="newCategoryName" class="form-input" placeholder="如：法律、医学..." maxlength="20">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>图标</label>
              <select id="newCategoryIcon" class="lang-select">
                <option value="📁">📁 文件夹</option>
                <option value="🎬">🎬 电影</option>
                <option value="🎓">🎓 学习</option>
                <option value="📱">📱 短视频</option>
                <option value="💼">💼 商务</option>
                <option value="⚖️">⚖️ 法律</option>
                <option value="🏥">🏥 医学</option>
                <option value="⚙️">⚙️ 技术</option>
                <option value="🎵">🎵 音乐</option>
                <option value="📚">📚 文学</option>
              </select>
            </div>
            <div class="form-group">
              <label>颜色</label>
              <input type="color" id="newCategoryColor" value="#165dff" class="color-picker">
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="document.getElementById('createCategoryModal').classList.remove('show')">取消</button>
            <button class="btn btn-primary" onclick="VibeMemory.confirmCreateCategory()">创建</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    modal.classList.add('show');
  },

  confirmCreateCategory() {
    const name = document.getElementById('newCategoryName').value.trim();
    if (!name) {
      VibeApp.showToast('请输入分类名称', 'error');
      return;
    }
    const icon = document.getElementById('newCategoryIcon').value;
    const color = document.getElementById('newCategoryColor').value;
    this.createCategory(name, icon, color);
    document.getElementById('createCategoryModal').classList.remove('show');
  },

  // ===== 匹配规则设置 =====

  updateMatchSetting(key, value) {
    this.matchSettings[key] = value;
    this.saveMatchSettings();
    VibeApp.showToast('匹配规则已更新', 'success');
  },

  showMatchSettingsDialog() {
    let modal = document.getElementById('matchSettingsModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'matchSettingsModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 450px;">
          <button class="modal-close-btn" onclick="document.getElementById('matchSettingsModal').classList.remove('show')">✕</button>
          <h3 style="margin-bottom: 16px;">⚙️ 匹配规则设置</h3>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="settingIgnoreCase" ${this.matchSettings.ignoreCase ? 'checked' : ''} 
                onchange="VibeMemory.updateMatchSetting('ignoreCase', this.checked)"> 忽略大小写
            </label>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="settingIgnorePunctuation" ${this.matchSettings.ignorePunctuation ? 'checked' : ''} 
                onchange="VibeMemory.updateMatchSetting('ignorePunctuation', this.checked)"> 忽略标点符号
            </label>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="settingSegmentMatch" ${this.matchSettings.segmentMatch ? 'checked' : ''} 
                onchange="VibeMemory.updateMatchSetting('segmentMatch', this.checked)"> 启用分段匹配（按句子分段逐段匹配）
            </label>
          </div>
          <div class="form-group">
            <label>匹配阈值：<span id="thresholdValue">${this.matchSettings.threshold}%</span></label>
            <input type="range" id="settingThreshold" min="50" max="100" value="${this.matchSettings.threshold}" 
              oninput="document.getElementById('thresholdValue').textContent = this.value + '%'; VibeMemory.updateMatchSetting('threshold', parseInt(this.value))">
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary" onclick="document.getElementById('matchSettingsModal').classList.remove('show')">完成</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    modal.classList.add('show');
  },

  // ===== 批量修改弹窗 =====

  showBatchEditDialog(type) {
    if (this.selectedIds.size === 0) {
      VibeApp.showToast('请先选择要修改的条目', 'info');
      return;
    }

    let modal = document.getElementById('batchEditModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'batchEditModal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    let content = '';
    if (type === 'langPair') {
      content = `
        <div class="form-row">
          <div class="form-group">
            <label>源语言</label>
            <select id="batchSourceLang" class="lang-select">
              <option value="en">英语</option>
              <option value="zh">中文</option>
              <option value="ja">日语</option>
              <option value="ko">韩语</option>
              <option value="fr">法语</option>
              <option value="de">德语</option>
            </select>
          </div>
          <div class="form-group">
            <label>目标语言</label>
            <select id="batchTargetLang" class="lang-select">
              <option value="zh">中文</option>
              <option value="en">英语</option>
              <option value="ja">日语</option>
              <option value="ko">韩语</option>
              <option value="fr">法语</option>
              <option value="de">德语</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('batchEditModal').classList.remove('show')">取消</button>
          <button class="btn btn-primary" onclick="VibeMemory.confirmBatchLangPair()">确认修改</button>
        </div>
      `;
    } else if (type === 'text') {
      content = `
        <div class="form-group">
          <label>查找内容</label>
          <input type="text" id="batchFindText" class="form-input" placeholder="输入要查找的文本">
        </div>
        <div class="form-group">
          <label>替换为</label>
          <input type="text" id="batchReplaceText" class="form-input" placeholder="输入替换后的文本">
        </div>
        <div class="form-group">
          <label>修改范围</label>
          <select id="batchTextField" class="lang-select">
            <option value="both">原文和译文</option>
            <option value="source">仅原文</option>
            <option value="target">仅译文</option>
          </select>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('batchEditModal').classList.remove('show')">取消</button>
          <button class="btn btn-primary" onclick="VibeMemory.confirmBatchText()">确认替换</button>
        </div>
      `;
    } else if (type === 'category') {
      const catOptions = this.categories.map(cat => 
        `<option value="${cat.id}">${cat.icon} ${this.escapeHtml(cat.name)}</option>`
      ).join('');
      content = `
        <div class="form-group">
          <label>目标分类</label>
          <select id="batchCategory" class="lang-select">
            ${catOptions}
          </select>
        </div>
        <p style="font-size: 12px; color: var(--text-tertiary); margin-top: -8px;">
          将选中的 ${this.selectedIds.size} 条记录移动到指定分类
        </p>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('batchEditModal').classList.remove('show')">取消</button>
          <button class="btn btn-primary" onclick="VibeMemory.confirmBatchCategory()">确认移动</button>
        </div>
      `;
    }

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 500px;">
        <button class="modal-close-btn" onclick="document.getElementById('batchEditModal').classList.remove('show')">✕</button>
        <h3 style="margin-bottom: 16px;">批量修改 - ${this.selectedIds.size} 条记录</h3>
        ${content}
      </div>
    `;
    modal.classList.add('show');
  },

  confirmBatchLangPair() {
    const sourceLang = document.getElementById('batchSourceLang').value;
    const targetLang = document.getElementById('batchTargetLang').value;
    this.batchUpdateLangPair(sourceLang, targetLang);
    document.getElementById('batchEditModal').classList.remove('show');
  },

  confirmBatchText() {
    const findText = document.getElementById('batchFindText').value;
    const replaceText = document.getElementById('batchReplaceText').value;
    const field = document.getElementById('batchTextField').value;
    if (!findText) {
      VibeApp.showToast('请输入查找内容', 'error');
      return;
    }
    this.batchUpdateText(findText, replaceText, field);
    document.getElementById('batchEditModal').classList.remove('show');
  },

  confirmBatchCategory() {
    const category = document.getElementById('batchCategory').value;
    this.batchUpdateCategory(category);
    document.getElementById('batchEditModal').classList.remove('show');
  },

  batchUpdateCategory(category) {
    if (this.selectedIds.size === 0) {
      VibeApp.showToast('请先选择要修改的条目', 'info');
      return;
    }

    const idSet = new Set(this.selectedIds);
    let count = 0;
    this.items.forEach(item => {
      if (idSet.has(item.id)) {
        item.category = category;
        item.updateTime = this.generateTimestamp();
        count++;
      }
    });

    this.save();
    this.renderCategories();
    this.render();
    VibeApp.showToast(`已移动 ${count} 条记录到目标分类`, 'success');
  },

  /**
   * 搜索记忆库（模糊匹配 + 高级筛选 + 排序）
   * @param {string} query - 搜索关键词
   * @param {string} langPair - 语言对筛选
   * @param {string} category - 分类筛选
   * @returns {Array} 匹配的记录列表
   */
  search(query, langPair = 'all', category = 'all') {
    let results = [...this.items];

    // 分类筛选
    if (category !== 'all') {
      results = results.filter(item => item.category === category);
    }

    // 语言对筛选
    if (langPair !== 'all') {
      results = results.filter(item => item.langPair === langPair);
    }

    // 关键词搜索（同时匹配原文和译文）
    if (query && query.trim()) {
      const lowerQuery = query.toLowerCase();
      results = results.filter(item =>
        item.sourceText.toLowerCase().includes(lowerQuery) ||
        item.targetText.toLowerCase().includes(lowerQuery)
      );
    }

    // ===== 高级筛选 =====

    // 1. 按使用次数筛选
    if (this.usageFilter !== 'all') {
      const threshold = this.usageThreshold || 5;
      if (this.usageFilter === 'high') {
        results = results.filter(item => (item.useCount || 0) >= threshold);
      } else if (this.usageFilter === 'low') {
        results = results.filter(item => (item.useCount || 0) > 0 && (item.useCount || 0) < threshold);
      } else if (this.usageFilter === 'unused') {
        results = results.filter(item => !item.useCount || item.useCount === 0);
      }
    }

    // 2. 按来源类型筛选（人工 / 机器译文）
    if (this.sourceFilter !== 'all') {
      if (this.sourceFilter === 'human') {
        results = results.filter(item => item.translationSource === 'human' || item.source === 'human');
      } else if (this.sourceFilter === 'machine') {
        results = results.filter(item => item.translationSource === 'api' || item.translationSource === 'machine' || item.source === 'machine');
      }
    }

    // 3. 按相似度筛选（用户提供参考文本，相似度 >= 阈值才保留）
    if (this.similarityQuery && this.similarityQuery.trim()) {
      const threshold = this.similarityThreshold || 70;
      const refText = this.similarityQuery.trim();
      results = results.filter(item => {
        const simSrc = this.calculateSimilarity(refText, item.sourceText);
        const simTgt = this.calculateSimilarity(refText, item.targetText);
        return Math.max(simSrc, simTgt) >= threshold;
      });
    }

    // ===== 排序 =====
    switch (this.sortBy) {
      case 'createTimeAsc':
        results.sort((a, b) => this.compareTimestamp(a.createTime, b.createTime));
        break;
      case 'useCountDesc':
        results.sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
        break;
      case 'useCountAsc':
        results.sort((a, b) => (a.useCount || 0) - (b.useCount || 0));
        break;
      case 'similarityDesc':
        if (this.similarityQuery && this.similarityQuery.trim()) {
          const refText = this.similarityQuery.trim();
          results.sort((a, b) => {
            const sa = Math.max(this.calculateSimilarity(refText, a.sourceText), this.calculateSimilarity(refText, a.targetText));
            const sb = Math.max(this.calculateSimilarity(refText, b.sourceText), this.calculateSimilarity(refText, b.targetText));
            return sb - sa;
          });
        }
        break;
      case 'createTimeDesc':
      default:
        results.sort((a, b) => this.compareTimestamp(b.createTime, a.createTime));
        break;
    }

    return results;
  },

  /**
   * 比较时间戳字符串（YYYY-MM-DD HH:mm 格式）
   */
  compareTimestamp(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    return a.localeCompare(b);
  },

  /**
   * 应用高级筛选（统一入口）
   */
  applyAdvancedFilter(key, value) {
    this[key] = value;
    this.render();
    this.renderAdvancedFilters();
  },

  /**
   * 渲染高级筛选面板（使用次数 / 相似度 / 来源类型 / 排序）
   */
  renderAdvancedFilters() {
    const container = document.getElementById('memoryAdvancedFilters');
    if (!container) return;

    const usageOptions = [
      { value: 'all', label: '不限' },
      { value: 'high', label: '高频复用' },
      { value: 'low', label: '低频' },
      { value: 'unused', label: '未使用' }
    ];
    const sourceOptions = [
      { value: 'all', label: '全部来源' },
      { value: 'human', label: '人工译文' },
      { value: 'machine', label: '机器译文' }
    ];
    const sortOptions = [
      { value: 'createTimeDesc', label: '入库时间↓' },
      { value: 'createTimeAsc', label: '入库时间↑' },
      { value: 'useCountDesc', label: '使用次数↓' },
      { value: 'useCountAsc', label: '使用次数↑' },
      { value: 'similarityDesc', label: '相似度↓' }
    ];

    container.innerHTML = `
      <div class="adv-filter-row">
        <div class="adv-filter-item">
          <label class="adv-filter-label">使用次数</label>
          <select class="adv-filter-select" onchange="VibeMemory.applyAdvancedFilter('usageFilter', this.value)">
            ${usageOptions.map(o => `<option value="${o.value}" ${this.usageFilter === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="adv-filter-item">
          <label class="adv-filter-label">高频阈值</label>
          <input type="number" class="adv-filter-input" min="1" max="999" value="${this.usageThreshold}"
                 onchange="VibeMemory.applyAdvancedFilter('usageThreshold', parseInt(this.value) || 5)">
        </div>
        <div class="adv-filter-item">
          <label class="adv-filter-label">来源</label>
          <select class="adv-filter-select" onchange="VibeMemory.applyAdvancedFilter('sourceFilter', this.value)">
            ${sourceOptions.map(o => `<option value="${o.value}" ${this.sourceFilter === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
        <div class="adv-filter-item">
          <label class="adv-filter-label">排序</label>
          <select class="adv-filter-select" onchange="VibeMemory.applyAdvancedFilter('sortBy', this.value)">
            ${sortOptions.map(o => `<option value="${o.value}" ${this.sortBy === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="adv-filter-row">
        <div class="adv-filter-item" style="flex: 2;">
          <label class="adv-filter-label">相似度筛选（输入参考文本）</label>
          <input type="text" class="adv-filter-input" placeholder="输入一段文本，按相似度筛选/排序"
                 value="${this.escapeHtml(this.similarityQuery)}"
                 oninput="VibeMemory.applyAdvancedFilter('similarityQuery', this.value)">
        </div>
        <div class="adv-filter-item">
          <label class="adv-filter-label">相似度阈值</label>
          <input type="number" class="adv-filter-input" min="0" max="100" value="${this.similarityThreshold}"
                 onchange="VibeMemory.applyAdvancedFilter('similarityThreshold', parseInt(this.value) || 70)">
        </div>
        <div class="adv-filter-item" style="align-self: flex-end;">
          <button class="btn btn-secondary btn-sm" onclick="VibeMemory.resetAdvancedFilters()">重置筛选</button>
        </div>
      </div>
    `;
  },

  resetAdvancedFilters() {
    this.usageFilter = 'all';
    this.usageThreshold = 5;
    this.sourceFilter = 'all';
    this.similarityQuery = '';
    this.similarityThreshold = 70;
    this.sortBy = 'createTimeDesc';
    this.render();
    this.renderAdvancedFilters();
    VibeApp.showToast('已重置高级筛选', 'info');
  },

  /**
   * 文本规范化（用于匹配时忽略大小写/标点）
   * @param {string} text - 原始文本
   * @returns {string} 规范化后的文本
   */
  normalizeText(text) {
    let result = text.trim();
    if (this.matchSettings.ignoreCase) {
      result = result.toLowerCase();
    }
    if (this.matchSettings.ignorePunctuation) {
      // 去除中英文标点
      result = result.replace(/[。，！？；：""''（）【】《》、…—\.,!?;:"'()\[\]{}<>\-—…]/g, '');
      // 去除多余空格
      result = result.replace(/\s+/g, ' ').trim();
    }
    return result;
  },

  /**
   * 将文本分段（按句子分割）
   * @param {string} text - 原始文本
   * @returns {Array} 分段后的句子数组
   */
  segmentText(text) {
    // 按中英文句号、问号、感叹号、分号分段
    const segments = text.split(/[。！？.!?；;\n]+/).map(s => s.trim()).filter(s => s.length > 0);
    return segments.length > 0 ? segments : [text.trim()];
  },

  /**
   * 计算文本相似度（Levenshtein距离）
   * @param {string} str1 - 字符串1
   * @param {string} str2 - 字符串2
   * @returns {number} 相似度百分比（0-100）
   */
  calculateSimilarity(str1, str2) {
    const s1 = this.normalizeText(str1);
    const s2 = this.normalizeText(str2);

    if (s1 === s2) return 100;
    if (s1.length === 0 || s2.length === 0) return 0;

    const matrix = [];
    for (let i = 0; i <= s2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= s1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= s2.length; i++) {
      for (let j = 1; j <= s1.length; j++) {
        if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    const distance = matrix[s2.length][s1.length];
    const maxLen = Math.max(s1.length, s2.length);
    return Math.round(((maxLen - distance) / maxLen) * 100);
  },

  /**
   * 分段匹配：将输入文本分段后逐段匹配，取最佳结果
   * @param {string} text - 输入文本
   * @param {Array} candidates - 候选记忆条目
   * @returns {Object|null} 最佳匹配结果（含分段匹配信息）
   */
  segmentMatchText(text, candidates) {
    const inputSegments = this.segmentText(text);
    if (inputSegments.length <= 1) {
      // 无法分段，返回 null 走常规匹配
      return null;
    }

    let bestMatch = null;
    let bestScore = 0;

    for (const item of candidates) {
      const itemSegments = this.segmentText(item.sourceText);
      // 逐段比较，计算匹配的段数和平均相似度
      let matchedSegments = 0;
      let totalScore = 0;

      for (const inputSeg of inputSegments) {
        let segBestScore = 0;
        for (const itemSeg of itemSegments) {
          const score = this.calculateSimilarity(inputSeg, itemSeg);
          if (score > segBestScore) segBestScore = score;
        }
        if (segBestScore >= this.matchSettings.threshold) {
          matchedSegments++;
        }
        totalScore += segBestScore;
      }

      // 综合评分：匹配段比例 * 平均段相似度
      const matchRatio = matchedSegments / inputSegments.length;
      const avgScore = totalScore / inputSegments.length;
      const combinedScore = Math.round(matchRatio * 60 + avgScore * 0.4);

      if (combinedScore >= this.matchSettings.threshold && combinedScore > bestScore) {
        bestScore = combinedScore;
        bestMatch = {
          ...item,
          matchScore: combinedScore,
          segmentMatch: true,
          matchedSegments,
          totalSegments: inputSegments.length
        };
      }
    }

    return bestMatch;
  },

  /**
   * 模糊匹配翻译
   * @param {string} text - 要翻译的文本
   * @param {string} sourceLang - 源语言
   * @param {string} targetLang - 目标语言
   * @param {number} threshold - 相似度阈值（默认使用matchSettings中的阈值）
   * @returns {Object|null} 匹配结果
   */
  fuzzyMatch(text, sourceLang, targetLang, threshold = null) {
    const effectiveThreshold = threshold || this.matchSettings.threshold;
    const langPair = `${sourceLang}-${targetLang}`;
    const candidates = this.items.filter(item => item.langPair === langPair);

    // 尝试分段匹配
    if (this.matchSettings.segmentMatch) {
      const segResult = this.segmentMatchText(text, candidates);
      if (segResult && segResult.matchScore >= effectiveThreshold) {
        segResult.useCount++;
        segResult.lastUsed = this.generateTimestamp();
        this.save();
        return segResult;
      }
    }

    // 常规模糊匹配
    let bestMatch = null;
    let bestScore = 0;

    for (const item of candidates) {
      const score = this.calculateSimilarity(text, item.sourceText);
      if (score >= effectiveThreshold && score > bestScore) {
        bestScore = score;
        bestMatch = {
          ...item,
          matchScore: score
        };
      }
    }

    if (bestMatch) {
      const origItem = this.items.find(i => i.id === bestMatch.id);
      if (origItem) {
        origItem.useCount++;
        origItem.lastUsed = this.generateTimestamp();
        this.save();
      }
    }

    return bestMatch;
  },

  findSimilar(text, sourceLang, targetLang, threshold = null, limit = 5) {
    const effectiveThreshold = threshold || this.matchSettings.threshold;
    const langPair = `${sourceLang}-${targetLang}`;
    const candidates = this.items.filter(item => item.langPair === langPair);

    const matches = [];

    // 分段匹配
    if (this.matchSettings.segmentMatch) {
      const inputSegments = this.segmentText(text);
      if (inputSegments.length > 1) {
        for (const item of candidates) {
          const itemSegments = this.segmentText(item.sourceText);
          let matchedSegments = 0;
          let totalScore = 0;
          for (const inputSeg of inputSegments) {
            let segBestScore = 0;
            for (const itemSeg of itemSegments) {
              const score = this.calculateSimilarity(inputSeg, itemSeg);
              if (score > segBestScore) segBestScore = score;
            }
            if (segBestScore >= effectiveThreshold) matchedSegments++;
            totalScore += segBestScore;
          }
          const matchRatio = matchedSegments / inputSegments.length;
          const avgScore = totalScore / inputSegments.length;
          const combinedScore = Math.round(matchRatio * 60 + avgScore * 0.4);
          if (combinedScore >= effectiveThreshold) {
            matches.push({
              ...item,
              matchScore: combinedScore,
              segmentMatch: true
            });
          }
        }
      }
    }

    // 常规匹配
    for (const item of candidates) {
      const score = this.calculateSimilarity(text, item.sourceText);
      if (score >= effectiveThreshold) {
        // 避免重复添加
        if (!matches.find(m => m.id === item.id)) {
          matches.push({
            ...item,
            matchScore: Math.round(score)
          });
        }
      }
    }

    return matches.sort((a, b) => b.matchScore - a.matchScore).slice(0, limit);
  },

  /**
   * 导出记忆库数据为JSON
   * @returns {string} JSON字符串
   */
  export() {
    try {
      const data = {
        version: '1.0',
        exportTime: new Date().toISOString(),
        count: this.items.length,
        items: this.items
      };
      return JSON.stringify(data, null, 2);
    } catch (error) {
      console.error('Memory export error:', error);
      return null;
    }
  },

  /**
   * 导入记忆库数据
   * @param {string} jsonStr - JSON字符串
   * @returns {Object} 导入结果
   */
  import(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      
      if (!data.items || !Array.isArray(data.items)) {
        return { success: false, message: '无效的JSON格式' };
      }

      // 合并数据（去重）
      const existingIds = new Set(this.items.map(item => item.id));
      let importedCount = 0;

      for (const item of data.items) {
        if (!existingIds.has(item.id)) {
          this.items.push(item);
          importedCount++;
        }
      }

      this.save();
      this.render();
      this.updateStats();

      return { 
        success: true, 
        message: `成功导入 ${importedCount} 条记录`,
        count: importedCount
      };
    } catch (error) {
      console.error('Memory import error:', error);
      return { success: false, message: 'JSON解析失败' };
    }
  },

  /**
   * 保存到本地存储
   */
  save() {
    VibeStorage.set(VibeStorage.KEYS.MEMORY, this.items);
  },

  /**
   * 更新统计数据
   */
  updateStats() {
    const total = this.items.length;
    
    // 计算命中率（基于使用次数）
    const stats = VibeStorage.get(VibeStorage.KEYS.STATS, {
      totalTranslations: 0,
      memoryHits: 0
    });
    
    const hitRate = stats.totalTranslations > 0 
      ? Math.round((stats.memoryHits / stats.totalTranslations) * 100)
      : 0;

    // 计算节省时间（假设每条记忆库匹配节省2秒）
    const savedTime = stats.memoryHits * 2;

    // 计算存储大小
    const size = Math.round((JSON.stringify(this.items).length / 1024) * 100) / 100;

    // 更新DOM（元素不存在则跳过）
    const memoryTotal = document.getElementById('memoryTotal');
    const memoryHitRate = document.getElementById('memoryHitRate');
    const memorySavedTime = document.getElementById('memorySavedTime');
    const memorySize = document.getElementById('memorySize');

    if (memoryTotal) memoryTotal.textContent = total;
    if (memoryHitRate) memoryHitRate.textContent = `${hitRate}%`;
    if (memorySavedTime) memorySavedTime.textContent = `${savedTime}s`;
    if (memorySize) memorySize.textContent = `${size}KB`;
  },

  /**
   * 渲染记忆库列表
   */
  render() {
    const listContainer = document.getElementById('memoryList');
    const emptyState = document.getElementById('memoryEmpty');

    if (!listContainer) return;

    const results = this.search(this.searchQuery, this.langFilter, this.categoryFilter);
    this.totalResults = results.length;

    // 修正当前页越界
    const totalPages = Math.max(1, Math.ceil(results.length / this.pageSize));
    if (this.currentPage > totalPages) this.currentPage = totalPages;
    if (this.currentPage < 1) this.currentPage = 1;

    if (results.length === 0) {
      listContainer.innerHTML = `
        <div class="memory-empty" style="text-align:center; padding:40px 20px; color:var(--text-tertiary);">
          <div style="font-size:48px; margin-bottom:12px;">📚</div>
          <div style="font-size:14px; margin-bottom:6px;">暂无记忆条目</div>
          <div style="font-size:12px;">可前往文本翻译/实时字幕页面翻译后存入</div>
        </div>
      `;
      // 渲染高级筛选面板
      this.renderAdvancedFilters();
      return;
    }

    // 分页切片
    const startIdx = (this.currentPage - 1) * this.pageSize;
    const pageItems = results.slice(startIdx, startIdx + this.pageSize);

    listContainer.innerHTML = pageItems.map(item => {
      const cat = this.categories.find(c => c.id === item.category);
      const catBadge = cat ? `<span class="cat-badge" style="background-color: ${cat.color};">${cat.icon} ${this.escapeHtml(cat.name)}</span>` : '';
      const useCount = item.useCount || 0;
      const isHighFreq = useCount >= (this.usageThreshold || 5);
      const useBadge = useCount > 0
        ? `<span class="tag ${isHighFreq ? 'tag-high-freq' : ''}" style="font-size: 11px;" title="使用次数">🔁 ${useCount}</span>`
        : `<span class="tag tag-unused" style="font-size: 11px;" title="未使用过">○ 未用</span>`;
      const srcBadge = this.getSourceBadge(item);

      if (this.batchMode) {
        const checked = this.selectedIds.has(item.id) ? 'checked' : '';
        return `
          <div class="memory-card batch-mode" data-id="${item.id}" style="
            padding: 14px 16px; border-bottom: 1px solid var(--border-light);
            display: flex; align-items: flex-start; gap: 10px;
          ">
            <input type="checkbox" ${checked} onchange="VibeMemory.toggleSelection(${item.id})" style="margin-top: 4px;">
            <div style="flex: 1; min-width: 0;" onclick="VibeMemory.toggleSelection(${item.id})">
              <div style="display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                  <span class="tag" style="font-size: 11px;">${item.langPair}</span>
                  ${catBadge}
                  ${useBadge}
                  ${srcBadge}
                </div>
                <span style="font-size: 11px; color: var(--text-tertiary); flex-shrink: 0;">${item.createTime || this.formatDate(item.createdAt)}</span>
              </div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${this.escapeHtml(item.sourceText)}
              </div>
              <div style="font-size: 13px; color: var(--text-primary); font-weight: 500; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                ${this.escapeHtml(item.targetText)}
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="memory-card ${isHighFreq ? 'high-freq-card' : ''}" onclick="VibeMemory.showPreview(${item.id})" style="
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-light);
          cursor: pointer;
          transition: background-color 0.15s ease;
          ${isHighFreq ? 'border-left: 3px solid var(--warning-color);' : ''}
        " onmouseover="this.style.backgroundColor='var(--bg-secondary)'" onmouseout="this.style.backgroundColor='transparent'">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px;">
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
              <span class="tag" style="font-size: 11px;">${item.langPair}</span>
              ${catBadge}
              ${useBadge}
              ${srcBadge}
            </div>
            <span style="font-size: 11px; color: var(--text-tertiary); flex-shrink: 0;">${item.createTime || this.formatDate(item.createdAt)}</span>
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.escapeHtml(item.sourceText)}">
            ${this.escapeHtml(item.sourceText)}
          </div>
          <div style="font-size: 14px; color: var(--text-primary); font-weight: 500; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${this.escapeHtml(item.targetText)}">
            ${this.escapeHtml(item.targetText)}
          </div>
        </div>
      `;
    }).join('');

    // 渲染高级筛选面板
    this.renderAdvancedFilters();

    // 渲染分页控件
    this.renderPagination(results.length);
  },

  /**
   * 渲染分页控件
   */
  renderPagination(totalItems) {
    let pager = document.getElementById('memoryPagination');
    const listContainer = document.getElementById('memoryList');
    if (!listContainer) return;

    const totalPages = Math.max(1, Math.ceil(totalItems / this.pageSize));
    if (totalPages <= 1) {
      if (pager) pager.remove();
      // 仍显示统计信息
      this.renderListStats(totalItems);
      return;
    }

    if (!pager) {
      pager = document.createElement('div');
      pager.id = 'memoryPagination';
      pager.className = 'memory-pagination';
      listContainer.parentNode.insertBefore(pager, listContainer.nextSibling);
    }

    // 生成分页按钮（最多显示 7 个页码，省略号折叠）
    const pages = [];
    const maxShow = 7;
    if (totalPages <= maxShow) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (this.currentPage > 3) pages.push('...');
      const start = Math.max(2, this.currentPage - 1);
      const end = Math.min(totalPages - 1, this.currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (this.currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }

    const from = (this.currentPage - 1) * this.pageSize + 1;
    const to = Math.min(this.currentPage * this.pageSize, totalItems);

    pager.innerHTML = `
      <div class="pagination-info">
        第 ${from}-${to} 条，共 ${totalItems} 条 · 第 ${this.currentPage}/${totalPages} 页
      </div>
      <div class="pagination-controls">
        <button class="btn btn-secondary btn-sm" ${this.currentPage === 1 ? 'disabled' : ''}
                onclick="VibeMemory.goToPage(${this.currentPage - 1})">‹ 上一页</button>
        ${pages.map(p => {
          if (p === '...') return `<span class="page-ellipsis">…</span>`;
          return `<button class="btn btn-sm ${p === this.currentPage ? 'btn-primary' : 'btn-secondary'}"
                          onclick="VibeMemory.goToPage(${p})">${p}</button>`;
        }).join(' ')}
        <button class="btn btn-secondary btn-sm" ${this.currentPage === totalPages ? 'disabled' : ''}
                onclick="VibeMemory.goToPage(${this.currentPage + 1})">下一页 ›</button>
        <select class="page-size-select" onchange="VibeMemory.changePageSize(parseInt(this.value))" title="每页显示">
          <option value="10" ${this.pageSize === 10 ? 'selected' : ''}>10/页</option>
          <option value="20" ${this.pageSize === 20 ? 'selected' : ''}>20/页</option>
          <option value="50" ${this.pageSize === 50 ? 'selected' : ''}>50/页</option>
          <option value="100" ${this.pageSize === 100 ? 'selected' : ''}>100/页</option>
        </select>
      </div>
    `;
  },

  /**
   * 列表统计信息（无分页时也显示）
   */
  renderListStats(totalItems) {
    let stats = document.getElementById('memoryListStats');
    const listContainer = document.getElementById('memoryList');
    if (!listContainer) return;
    if (!stats) {
      stats = document.createElement('div');
      stats.id = 'memoryListStats';
      stats.className = 'memory-list-stats';
      listContainer.parentNode.insertBefore(stats, listContainer.nextSibling);
    }
    stats.innerHTML = `<div class="pagination-info">共 ${totalItems} 条记忆</div>`;
  },

  goToPage(page) {
    this.currentPage = page;
    this.render();
  },

  changePageSize(size) {
    this.pageSize = size;
    this.currentPage = 1;
    this.render();
  },

  /**
   * 导出 CSV（标准格式，含 BOM 头，Excel 直接打开不乱码）
   */
  exportCsv() {
    if (this.items.length === 0) {
      VibeApp.showToast('记忆库为空', 'info');
      return;
    }
    const results = this.search(this.searchQuery, this.langFilter, this.categoryFilter);
    if (results.length === 0) {
      VibeApp.showToast('当前筛选下无数据', 'info');
      return;
    }

    const escapeCsv = (s) => {
      const str = String(s || '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const header = ['ID', '原文', '译文', '源语言', '目标语言', '语言对', '分类', '使用次数', '来源', '创建时间', '最后使用'];
    const rows = results.map(item => [
      escapeCsv(item.id),
      escapeCsv(item.sourceText),
      escapeCsv(item.targetText),
      escapeCsv(item.sourceLang),
      escapeCsv(item.targetLang),
      escapeCsv(item.langPair),
      escapeCsv(item.category),
      escapeCsv(item.useCount || 0),
      escapeCsv(item.translationSource || item.source || ''),
      escapeCsv(item.createTime || ''),
      escapeCsv(item.lastUsed || '')
    ].join(','));

    // 加 BOM 头，避免 Excel 打开 UTF-8 中文乱码
    const csv = '\ufeff' + header.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vibetrans-memory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    VibeApp.showToast(`已导出 ${results.length} 条 CSV`, 'success');
  },

  /**
   * 获取来源标签（人工/机器）
   */
  getSourceBadge(item) {
    const src = item.translationSource || item.source;
    if (src === 'human') {
      return `<span class="tag tag-human" style="font-size: 11px;" title="人工译文">✍ 人工</span>`;
    } else if (src === 'api' || src === 'machine') {
      return `<span class="tag tag-machine" style="font-size: 11px;" title="机器译文">🤖 机器</span>`;
    }
    return '';
  },

  /**
   * 显示记忆库条目预览弹窗（支持编辑+撤销）
   * @param {number} id - 条目ID
   */
  showPreview(id) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;

    this.selectedItem = item;
    // 保存原始数据快照，用于撤销
    this.previewOriginalData = {
      sourceText: item.sourceText,
      targetText: item.targetText,
      category: item.category || 'default'
    };

    // 创建或获取预览弹窗
    let modal = document.getElementById('memoryPreviewModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'memoryPreviewModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content modal-lg" style="max-width: 700px;">
          <button class="modal-close-btn" onclick="VibeMemory.closePreview()">✕</button>
          <div class="preview-header" style="padding: 20px 20px 0; display: flex; justify-content: space-between; align-items: center;">
            <h3 style="margin: 0;">记忆库条目详情</h3>
            <span id="previewModifiedBadge" class="preview-modified-badge" style="display: none; font-size: 11px; padding: 2px 8px; background-color: var(--warning-color); color: white; border-radius: 12px; font-weight: 500;">已修改</span>
          </div>
          <div id="memoryPreviewBody" class="modal-body" style="padding: 20px;"></div>
          <div class="modal-footer">
            <button class="btn btn-danger" onclick="VibeMemory.deleteFromPreview()">删除本条</button>
            <button id="previewUndoBtn" class="btn btn-secondary" onclick="VibeMemory.undoPreviewChanges()" disabled style="opacity: 0.5; cursor: not-allowed;">↩ 撤销修改</button>
            <button class="btn btn-secondary" onclick="VibeMemory.closePreview()">关闭</button>
            <button class="btn btn-primary" onclick="VibeMemory.saveFromPreview()">覆盖保存</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // 点击遮罩关闭（有修改时确认）
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closePreview();
      });
    }

    // 渲染内容
    const createTime = item.createTime || this.formatDate(item.createdAt);
    const updateTime = item.updateTime || this.formatDate(item.lastUsed);

    document.getElementById('memoryPreviewBody').innerHTML = `
      <div class="preview-time-info">
        <div class="preview-time-item">
          <span class="preview-time-label">首次入库</span>
          <span class="preview-time-value">${createTime}</span>
        </div>
        <div class="preview-time-item">
          <span class="preview-time-label">最后修改</span>
          <span class="preview-time-value">${updateTime}</span>
        </div>
      </div>
      <div class="preview-lang-pair">
        <span class="tag">${item.sourceLang}</span>
        <span style="margin: 0 8px; color: var(--text-tertiary);">→</span>
        <span class="tag">${item.targetLang}</span>
      </div>
      <div class="preview-text-section">
        <label class="preview-label">分类</label>
        <div class="preview-category-select">
          ${this.categories.map(cat => `
            <button type="button" class="cat-select-chip ${item.category === cat.id ? 'selected' : ''}" 
              data-cat-id="${cat.id}"
              style="--cat-color: ${cat.color};"
              onclick="VibeMemory.selectPreviewCategory('${cat.id}')">
              <span>${cat.icon}</span>
              <span>${this.escapeHtml(cat.name)}</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="preview-text-section">
        <label class="preview-label">原文</label>
        <textarea id="previewSourceText" class="preview-textarea" style="min-height: 100px;">${this.escapeHtml(item.sourceText)}</textarea>
      </div>
      <div class="preview-text-section">
        <label class="preview-label">译文</label>
        <textarea id="previewTargetText" class="preview-textarea" style="min-height: 100px;">${this.escapeHtml(item.targetText)}</textarea>
      </div>
    `;

    // 绑定输入事件，检测修改状态
    const sourceInput = document.getElementById('previewSourceText');
    const targetInput = document.getElementById('previewTargetText');
    const self = this;

    function checkModified() {
      const sourceModified = sourceInput.value !== self.previewOriginalData.sourceText;
      const targetModified = targetInput.value !== self.previewOriginalData.targetText;
      const currentCategory = self.getCurrentPreviewCategory();
      const categoryModified = currentCategory !== self.previewOriginalData.category;
      const modified = sourceModified || targetModified || categoryModified;

      const badge = document.getElementById('previewModifiedBadge');
      const undoBtn = document.getElementById('previewUndoBtn');

      if (badge) badge.style.display = modified ? 'inline-block' : 'none';
      if (undoBtn) {
        undoBtn.disabled = !modified;
        undoBtn.style.opacity = modified ? '1' : '0.5';
        undoBtn.style.cursor = modified ? 'pointer' : 'not-allowed';
      }
    }

    sourceInput.addEventListener('input', checkModified);
    targetInput.addEventListener('input', checkModified);

    // 重置修改状态
    checkModified();

    modal.classList.add('show');
  },

  /**
   * 撤销预览弹窗中的修改，恢复原始内容
   */
  undoPreviewChanges() {
    if (!this.previewOriginalData) return;

    const sourceInput = document.getElementById('previewSourceText');
    const targetInput = document.getElementById('previewTargetText');

    if (sourceInput) sourceInput.value = this.previewOriginalData.sourceText;
    if (targetInput) targetInput.value = this.previewOriginalData.targetText;

    // 恢复分类
    if (this.previewOriginalData.category) {
      document.querySelectorAll('.cat-select-chip').forEach(chip => {
        chip.classList.toggle('selected', chip.dataset.catId === this.previewOriginalData.category);
      });
    }

    // 更新修改状态
    const badge = document.getElementById('previewModifiedBadge');
    const undoBtn = document.getElementById('previewUndoBtn');
    if (badge) badge.style.display = 'none';
    if (undoBtn) {
      undoBtn.disabled = true;
      undoBtn.style.opacity = '0.5';
      undoBtn.style.cursor = 'not-allowed';
    }

    VibeApp.showToast('已撤销修改', 'info');
  },

  /**
   * 从预览弹窗保存修改
   */
  saveFromPreview() {
    if (!this.selectedItem) return;

    const sourceText = document.getElementById('previewSourceText').value.trim();
    const targetText = document.getElementById('previewTargetText').value.trim();
    const category = this.getCurrentPreviewCategory();

    if (!sourceText || !targetText) {
      VibeApp.showToast('原文和译文不能为空', 'error');
      return;
    }

    const now = this.generateTimestamp();
    this.selectedItem.sourceText = sourceText;
    this.selectedItem.targetText = targetText;
    this.selectedItem.category = category;
    this.selectedItem.updateTime = now;
    this.selectedItem.lastUsed = now;

    this.save();
    this.renderCategories();
    this.render();
    this.closePreview();
    VibeApp.showToast('修改已保存', 'success');
  },

  /**
   * 从预览弹窗删除
   */
  deleteFromPreview() {
    if (!this.selectedItem) return;
    if (confirm('确定要删除这条翻译记忆吗？')) {
      this.remove(this.selectedItem.id);
      this.closePreview();
      VibeApp.showToast('删除成功', 'success');
    }
  },

  /**
   * 检查预览弹窗是否有未保存的修改
   */
  hasPreviewChanges() {
    if (!this.previewOriginalData) return false;

    const sourceInput = document.getElementById('previewSourceText');
    const targetInput = document.getElementById('previewTargetText');

    if (!sourceInput || !targetInput) return false;

    const currentCategory = this.getCurrentPreviewCategory();

    return sourceInput.value !== this.previewOriginalData.sourceText ||
           targetInput.value !== this.previewOriginalData.targetText ||
           currentCategory !== this.previewOriginalData.category;
  },

  /**
   * 获取预览弹窗中当前选中的分类
   */
  getCurrentPreviewCategory() {
    const selectedChip = document.querySelector('.cat-select-chip.selected');
    return selectedChip ? selectedChip.dataset.catId : 'default';
  },

  /**
   * 在预览弹窗中选择分类
   */
  selectPreviewCategory(catId) {
    document.querySelectorAll('.cat-select-chip').forEach(chip => {
      chip.classList.toggle('selected', chip.dataset.catId === catId);
    });

    // 检测修改状态
    const sourceInput = document.getElementById('previewSourceText');
    const targetInput = document.getElementById('previewTargetText');
    if (sourceInput && targetInput) {
      const sourceModified = sourceInput.value !== this.previewOriginalData.sourceText;
      const targetModified = targetInput.value !== this.previewOriginalData.targetText;
      const categoryModified = catId !== this.previewOriginalData.category;
      const modified = sourceModified || targetModified || categoryModified;

      const badge = document.getElementById('previewModifiedBadge');
      const undoBtn = document.getElementById('previewUndoBtn');
      if (badge) badge.style.display = modified ? 'inline-block' : 'none';
      if (undoBtn) {
        undoBtn.disabled = !modified;
        undoBtn.style.opacity = modified ? '1' : '0.5';
        undoBtn.style.cursor = modified ? 'pointer' : 'not-allowed';
      }
    }
  },

  /**
   * 关闭预览弹窗
   */
  closePreview() {
    // 有未保存修改时确认
    if (this.hasPreviewChanges()) {
      if (!confirm('有未保存的修改，确定要关闭吗？')) return;
    }

    const modal = document.getElementById('memoryPreviewModal');
    if (modal) {
      modal.classList.remove('show');
    }
    this.selectedItem = null;
    this.previewOriginalData = null;
  },

  /**
   * 设置搜索查询
   * @param {string} query - 搜索关键词
   */
  setSearchQuery(query) {
    this.searchQuery = query;
    this.render();
  },

  /**
   * 设置语言筛选
   * @param {string} langPair - 语言对
   */
  setLangFilter(langPair) {
    this.langFilter = langPair;
    this.render();
  },

  /**
   * 复制到翻译模块
   * @param {number} id - 记录ID
   */
  copyToTranslator(id) {
    const item = this.items.find(i => i.id === id);
    if (item) {
      // 更新翻译模块的输入
      document.getElementById('sourceText').value = item.sourceText;
      document.getElementById('sourceLang').value = item.sourceLang;
      document.getElementById('targetLang').value = item.targetLang;
      
      // 切换到翻译模块
      document.querySelector('[data-module="translator"]').click();
      
      // 触发翻译
      document.getElementById('translateBtn').click();
    }
  },

  /**
   * 确认删除
   * @param {number} id - 记录ID
   */
  confirmDelete(id) {
    if (confirm('确定要删除这条翻译记忆吗？')) {
      this.remove(id);
      VibeApp.showToast('删除成功', 'success');
    }
  },

  /**
   * HTML转义
   * @param {string} text - 文本
   * @returns {string} 转义后的文本
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * 格式化日期
   * @param {string} dateStr - ISO日期字符串
   * @returns {string} 格式化后的日期
   */
  formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  // ===== 高级筛选 / 迁移 / 来源标记 =====

  /**
   * 切换高级筛选面板显示
   */
  toggleAdvancedFilters() {
    const panel = document.getElementById('memoryAdvancedFilters');
    if (!panel) return;
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
      this.renderAdvancedFilters();
    }
  },

  /**
   * 显示迁移分类对话框（仅迁移到现有分类，与"批量改分类"一致，但更直观）
   */
  showMigrateCategoryDialog() {
    if (this.selectedIds.size === 0) {
      VibeApp.showToast('请先选择要迁移的条目', 'info');
      return;
    }
    this.showBatchEditDialog('category');
  },

  /**
   * 批量标记翻译来源（人工/机器）
   */
  batchMarkSource(source) {
    if (this.selectedIds.size === 0) {
      VibeApp.showToast('请先选择条目', 'info');
      return;
    }
    const idSet = new Set(this.selectedIds);
    let count = 0;
    const now = this.generateTimestamp();
    this.items.forEach(item => {
      if (idSet.has(item.id)) {
        item.translationSource = source;
        item.source = source;
        item.updateTime = now;
        count++;
      }
    });
    this.save();
    this.render();
    VibeApp.showToast(`已标记 ${count} 条为${source === 'human' ? '人工' : '机器'}译文`, 'success');
  },

  // ===== Excel 双语表格导入 =====

  /**
   * 导入 Excel 双语表格
   * 表格需包含至少两列：原文、译文（首行可为表头）
   */
  async importExcelBilingual() {
    // 动态加载 SheetJS
    if (typeof XLSX === 'undefined') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('SheetJS 加载失败，请检查网络'));
        document.head.appendChild(script);
      }).catch(err => {
        VibeApp.showToast(err.message, 'error');
        return;
      });
    }
    if (typeof XLSX === 'undefined') {
      VibeApp.showToast('Excel 解析库加载失败', 'error');
      return;
    }

    // 弹出文件选择框
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        if (rows.length < 2) {
          VibeApp.showToast('表格内容太少（至少2行）', 'error');
          return;
        }

        // 自动识别原文/译文列：默认第0/1列；若有表头则按命名识别
        let srcCol = 0, tgtCol = 1, langPairCol = -1, startRow = 0;
        const header = rows[0].map(c => String(c).trim().toLowerCase());
        const findCol = (keys) => header.findIndex(h => keys.some(k => h.includes(k)));
        const c1 = findCol(['原文', 'source', '原文', 'original']);
        const c2 = findCol(['译文', 'target', '翻译', 'translation', '译文']);
        const cLp = findCol(['语言对', 'langpair', 'lang']);
        if (c1 >= 0 && c2 >= 0) {
          srcCol = c1; tgtCol = c2; langPairCol = cLp; startRow = 1;
        }

        // 让用户选择语言对
        const langPair = await this.promptLangPair();
        if (!langPair) return;

        let count = 0;
        for (let i = startRow; i < rows.length; i++) {
          const src = String(rows[i][srcCol] || '').trim();
          const tgt = String(rows[i][tgtCol] || '').trim();
          if (!src || !tgt) continue;
          this.add(src, tgt, langPair.source, langPair.target, 'default', 'human');
          count++;
        }
        VibeApp.showToast(`从 Excel 导入 ${count} 条记忆`, 'success');
      } catch (err) {
        console.error('Excel 导入失败:', err);
        VibeApp.showToast('Excel 解析失败: ' + err.message, 'error');
      }
    };
    input.click();
  },

  /**
   * 弹窗让用户选择语言对
   */
  promptLangPair() {
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay show';
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 380px;">
          <button class="modal-close-btn" onclick="this.closest('.modal-overlay').remove(); window.__pendingLangPair=null;">✕</button>
          <h3 style="margin-bottom: 16px;">选择语言对</h3>
          <div class="form-row">
            <div class="form-group">
              <label>源语言</label>
              <select id="excelSrcLang" class="lang-select">
                <option value="en">英文</option>
                <option value="zh" selected>中文</option>
                <option value="ja">日文</option>
                <option value="ko">韩文</option>
                <option value="fr">法文</option>
                <option value="de">德文</option>
                <option value="es">西班牙文</option>
              </select>
            </div>
            <div class="form-group">
              <label>目标语言</label>
              <select id="excelTgtLang" class="lang-select">
                <option value="en">英文</option>
                <option value="zh">中文</option>
                <option value="ja">日文</option>
                <option value="ko">韩文</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove(); window.__pendingLangPair=null;">取消</button>
            <button class="btn btn-primary" onclick="window.__pendingLangPair={source:document.getElementById('excelSrcLang').value,target:document.getElementById('excelTgtLang').value}; this.closest('.modal-overlay').remove();">确定</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      const check = setInterval(() => {
        if (!document.body.contains(modal)) {
          clearInterval(check);
          resolve(window.__pendingLangPair || null);
          delete window.__pendingLangPair;
        }
      }, 200);
    });
  },

  // ===== TMX 1.4b 导入导出 =====

  /**
   * 导出标准 TMX 1.4b 文件（兼容 Trados/OmegaT/Aegisub）
   */
  exportTmx() {
    if (this.items.length === 0) {
      VibeApp.showToast('记忆库为空', 'info');
      return;
    }

    const now = new Date().toISOString();
    const escapeXml = (s) => String(s || '').replace(/[<>&'"]/g, c => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
    }[c]));

    // 统计语言对
    const langPairs = [...new Set(this.items.map(i => i.langPair || `${i.sourceLang}-${i.targetLang}`))];

    let bodyXml = '';
    this.items.forEach(item => {
      const srcLang = this.toTmxLangCode(item.sourceLang);
      const tgtLang = this.toTmxLangCode(item.targetLang);
      bodyXml += `
    <tu tuid="${escapeXml(String(item.id))}" srclang="${srcLang}" datatype="text">
      <note>${escapeHtml(item.category || '')}</note>
      <prop type="useCount">${item.useCount || 0}</prop>
      <prop type="source">${escapeXml(item.translationSource || item.source || 'human')}</prop>
      <tuv xml:lang="${srcLang}">
        <seg>${escapeXml(item.sourceText)}</seg>
      </tuv>
      <tuv xml:lang="${tgtLang}">
        <seg>${escapeXml(item.targetText)}</seg>
      </tuv>
    </tu>`;
    });

    const tmx = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tmx SYSTEM "tmx14b.dtd">
<tmx version="1.4b">
  <header creationtool="VibeTrans"
          creationtoolversion="1.0"
          segtype="sentence"
          o-tmf="plain text"
          adminlang="zh-CN"
          srclang="*all*"
          datatype="plaintext"
          creationdate="${now}">
  </header>
  <body>${bodyXml}
  </body>
</tmx>`;

    const blob = new Blob([tmx], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vibetrans-memory-${new Date().toISOString().slice(0, 10)}.tmx`;
    a.click();
    URL.revokeObjectURL(url);
    VibeApp.showToast(`已导出 ${this.items.length} 条 (TMX 1.4b，${langPairs.length} 个语言对)`, 'success');
  },

  /**
   * 将语言代码转换为 TMX 标准（RFC 3066）
   */
  toTmxLangCode(lang) {
    const map = {
      'zh': 'zh-CN', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW',
      'en': 'en-US', 'en-US': 'en-US', 'en-GB': 'en-GB',
      'ja': 'ja-JP', 'ko': 'ko-KR', 'fr': 'fr-FR',
      'de': 'de-DE', 'es': 'es-ES'
    };
    return map[lang] || lang || 'zh-CN';
  },

  /**
   * 从 TMX 字符串导入
   */
  importTmx(tmxStr) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(tmxStr, 'text/xml');
      const parseError = doc.querySelector('parsererror');
      if (parseError) throw new Error('XML 解析失败');

      const tus = doc.querySelectorAll('tu');
      let count = 0;
      tus.forEach(tu => {
        const tuvs = tu.querySelectorAll('tuv');
        if (tuvs.length < 2) return;
        const srcSeg = tuvs[0].querySelector('seg');
        const tgtSeg = tuvs[1].querySelector('seg');
        if (!srcSeg || !tgtSeg) return;
        const sourceText = srcSeg.textContent.trim();
        const targetText = tgtSeg.textContent.trim();
        if (!sourceText || !targetText) return;

        const srcLang = this.fromTmxLangCode(tuvs[0].getAttribute('xml:lang') || tuvs[0].getAttribute('lang') || 'en');
        const tgtLang = this.fromTmxLangCode(tuvs[1].getAttribute('xml:lang') || tuvs[1].getAttribute('lang') || 'zh');

        // 提取属性
        const useCountProp = tu.querySelector('prop[type="useCount"]');
        const sourceProp = tu.querySelector('prop[type="source"]');
        const useCount = useCountProp ? parseInt(useCountProp.textContent) || 1 : 1;
        const source = sourceProp ? sourceProp.textContent.trim() : 'human';

        // 去重检查
        const existing = this.items.find(item =>
          item.sourceText === sourceText && item.targetText === targetText &&
          item.sourceLang === srcLang && item.targetLang === tgtLang
        );
        if (existing) {
          existing.useCount = (existing.useCount || 0) + useCount;
          existing.translationSource = source;
          existing.source = source;
        } else {
          const now = this.generateTimestamp();
          this.items.push({
            id: Date.now() + Math.random() + count,
            sourceText, targetText,
            sourceLang: srcLang, targetLang: tgtLang,
            langPair: `${srcLang}-${tgtLang}`,
            category: 'default',
            matchScore: 100,
            useCount: useCount,
            createdAt: now, lastUsed: now,
            createTime: now, updateTime: now,
            translationSource: source, source: source
          });
          count++;
        }
      });
      this.save();
      this.render();
      this.updateStats();
      VibeApp.showToast(`从 TMX 导入 ${count} 条记录`, 'success');
      return count;
    } catch (err) {
      console.error('TMX 导入失败:', err);
      VibeApp.showToast('TMX 导入失败: ' + err.message, 'error');
      return 0;
    }
  },

  fromTmxLangCode(code) {
    if (!code) return 'zh';
    const map = {
      'zh-CN': 'zh', 'zh-TW': 'zh', 'zh-HK': 'zh',
      'en-US': 'en', 'en-GB': 'en', 'ja-JP': 'ja', 'ko-KR': 'ko',
      'fr-FR': 'fr', 'de-DE': 'de', 'es-ES': 'es'
    };
    return map[code] || code.split('-')[0] || 'zh';
  }
};

// 暴露模块
window.VibeMemory = VibeMemory;