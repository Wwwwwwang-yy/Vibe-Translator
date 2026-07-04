/**
 * 语料清洗与对齐模块
 * 支持：
 *  - 导入 TXT/MD/PDF/DOCX 原文/译文文件
 *  - Gale-Church 简化版长度对齐算法
 *  - 表格内编辑、合并拆分、去重去空格、查找替换
 *  - 一键导入到记忆库/语料库/术语库
 *  - 导出 TMX / CSV / 双语 TXT
 */
const VibeAligner = {
  // 原文段落列表
  sourceSegments: [],
  // 译文段落列表
  targetSegments: [],
  // 对齐结果 [{ source: '...', target: '...', sourceIdx, targetIdx, score, id }]
  alignedPairs: [],
  // 选中的对齐项ID
  selectedIds: new Set(),
  // 原文文件名、译文文件名
  sourceFileName: '',
  targetFileName: '',

  // ===== 文件导入 =====

  /**
   * 加载文件并提取文本
   * @param {string} type - 'source' | 'target'
   * @param {File} file
   */
  async loadFile(type, file) {
    if (!file) return;
    try {
      // 直接提取纯文本，不走 VibeCorpus.parseDocument（那个会把语料直接加到库中）
      const text = await this.extractPlainText(file);
      if (!text || !text.trim()) {
        VibeApp.showToast('文件内容为空或解析失败', 'error');
        return;
      }

      // 切分成段落
      const segments = this.splitIntoSentences(text);

      if (type === 'source') {
        this.sourceSegments = segments;
        this.sourceFileName = file.name;
        const info = document.getElementById('alignerSourceInfo');
        if (info) info.innerHTML = `<strong>${this.escapeHtml(file.name)}</strong><br>${segments.length} 个段落`;
      } else {
        this.targetSegments = segments;
        this.targetFileName = file.name;
        const info = document.getElementById('alignerTargetInfo');
        if (info) info.innerHTML = `<strong>${this.escapeHtml(file.name)}</strong><br>${segments.length} 个段落`;
      }
      VibeApp.showToast(`已加载 ${file.name}（${segments.length} 段）`, 'success');
    } catch (err) {
      console.error('Aligner loadFile error:', err);
      VibeApp.showToast('加载失败: ' + err.message, 'error');
    }
  },

  /**
   * 从文件提取纯文本（支持 txt/md/docx/pdf/html/csv，复用 VibeCorpus 的解析能力）
   * 与 parseDocument 不同：本方法仅返回纯文本，不写入语料库
   */
  async extractPlainText(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    // 纯文本类：直接读取
    if (ext === 'txt' || ext === 'md' || ext === 'text') {
      return await this.readFile(file);
    }
    // HTML
    if (ext === 'html' || ext === 'htm') {
      const html = await this.readFile(file);
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      return tmp.textContent || '';
    }
    // CSV：取每行第一列拼接
    if (ext === 'csv') {
      const content = await this.readFile(file);
      return content.split(/\r?\n/).map(line => line.split(',')[0]).join('\n');
    }
    // JSON：尝试提取纯文本字段
    if (ext === 'json') {
      const content = await this.readFile(file);
      try {
        const data = JSON.parse(content);
        const items = Array.isArray(data) ? data : (data.items || data.corpus || data.data || []);
        return items.map(it => it.sourceText || it.source || it.original || '').filter(Boolean).join('\n');
      } catch (e) {
        return content;
      }
    }
    // DOCX：用 mammoth.js
    if (ext === 'docx') {
      try {
        await VibeCorpus.loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js');
        const arrayBuffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        return result.value || '';
      } catch (e) {
        console.error('DOCX解析失败:', e);
        throw new Error('DOCX解析失败: ' + e.message);
      }
    }
    // PDF：用 pdf.js
    if (ext === 'pdf') {
      try {
        await VibeCorpus.loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js');
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        }
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map(it => it.str).join(' ') + '\n';
        }
        return text;
      } catch (e) {
        console.error('PDF解析失败:', e);
        throw new Error('PDF解析失败: ' + e.message);
      }
    }
    // Excel：用 SheetJS
    if (ext === 'xlsx' || ext === 'xls') {
      try {
        await VibeCorpus.loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
        const arrayBuffer = await file.arrayBuffer();
        const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
        let text = '';
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });
          for (const row of rows) {
            text += (row[0] || '') + '\n';
          }
        }
        return text;
      } catch (e) {
        console.error('Excel解析失败:', e);
        throw new Error('Excel解析失败: ' + e.message);
      }
    }
    // 兜底：当作文本读取
    return await this.readFile(file);
  },

  /**
   * 读取文件为文本
   */
  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  },

  /**
   * 将文本切分为句子/段落
   * 优先按换行切，再按句号切
   */
  splitIntoSentences(text) {
    if (!text) return [];
    // 标准化换行
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // 先按双换行（段落）切
    let parts = normalized.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length > 0);
    // 如果段落数太少，按单换行切
    if (parts.length <= 1) {
      parts = normalized.split(/\n/).map(s => s.trim()).filter(s => s.length > 0);
    }
    // 如果还是太少，按句号切
    if (parts.length <= 1) {
      parts = normalized.split(/(?<=[。！？.!?])\s*/).map(s => s.trim()).filter(s => s.length > 0);
    }
    return parts;
  },

  // ===== Gale-Church 长度对齐算法（简化版）=====

  /**
   * Gale-Church 对齐算法
   * 基于句子长度（字符数）的动态规划对齐
   * 支持 5 种对齐模式：1-1, 1-0, 0-1, 2-1, 1-2
   */
  alignGaleChurch(sourceSents, targetSents) {
    const m = sourceSents.length;
    const n = targetSents.length;

    if (m === 0 || n === 0) {
      // 退化情况：直接 1-0 或 0-1 配对
      const pairs = [];
      sourceSents.forEach(s => pairs.push({ source: s, target: '', sourceIdx: -1, targetIdx: -1, score: 0 }));
      targetSents.forEach(t => pairs.push({ source: '', target: t, sourceIdx: -1, targetIdx: -1, score: 0 }));
      return pairs;
    }

    // 长度数组（用字符数代替 c = 字符数 * 1，假设 1 中文字符 ≈ 1 英文字符 * 2.5）
    const sLen = sourceSents.map(s => this.charLen(s));
    const tLen = targetSents.map(t => this.charLen(t));

    // 中英文长度比例估计（中文每字 ≈ 2.5 英文字符）
    let avgRatio = 1.0;
    if (m > 0 && n > 0) {
      const sTotal = sLen.reduce((a, b) => a + b, 0);
      const tTotal = tLen.reduce((a, b) => a + b, 0);
      if (sTotal > 0 && tTotal > 0) {
        avgRatio = tTotal / sTotal;
      }
    }
    // 把目标长度归一化到与源长度同尺度
    const tLenNorm = tLen.map(l => l / (avgRatio || 1));

    // 动态规划表 dp[i][j] = 对齐前 i 个源句和前 j 个目标句的最小代价
    // 回溯表 trace[i][j] = 来自哪个对齐模式
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(Infinity));
    const trace = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(null));

    dp[0][0] = 0;

    // 5 种对齐模式的代价
    const matchCost = (i1, i2, j1, j2) => {
      // i1..i2-1 是源句索引，j1..j2-1 是目标句索引
      const sSum = sLen.slice(i1, i2).reduce((a, b) => a + b, 0);
      const tSum = tLenNorm.slice(j1, j2).reduce((a, b) => a + b, 0);
      // 代价：长度差的平方 / 总长度 + 模式惩罚
      const delta = Math.abs(sSum - tSum);
      const total = sSum + tSum || 1;
      const cost = (delta * delta) / total + 1; // +1 是基础代价
      return cost;
    };

    // 模式惩罚（鼓励 1-1 对齐）
    const MODE_PENALTY = {
      '1-1': 0,
      '1-0': 2.5,   // 源句无对应译文
      '0-1': 2.5,   // 译文无对应源句
      '2-1': 1.5,   // 两个源句对一个译文
      '1-2': 1.5    // 一个源句对两个译文
    };

    for (let i = 0; i <= m; i++) {
      for (let j = 0; j <= n; j++) {
        if (i === 0 && j === 0) continue;

        // 1-1: 第 i 个源句对第 j 个目标句
        if (i >= 1 && j >= 1) {
          const cost = dp[i - 1][j - 1] + matchCost(i - 1, i, j - 1, j) + MODE_PENALTY['1-1'];
          if (cost < dp[i][j]) {
            dp[i][j] = cost;
            trace[i][j] = { mode: '1-1', prevI: i - 1, prevJ: j - 1 };
          }
        }
        // 1-0: 仅源句
        if (i >= 1) {
          const cost = dp[i - 1][j] + matchCost(i - 1, i, 0, 0) + MODE_PENALTY['1-0'];
          if (cost < dp[i][j]) {
            dp[i][j] = cost;
            trace[i][j] = { mode: '1-0', prevI: i - 1, prevJ: j };
          }
        }
        // 0-1: 仅目标句
        if (j >= 1) {
          const cost = dp[i][j - 1] + matchCost(0, 0, j - 1, j) + MODE_PENALTY['0-1'];
          if (cost < dp[i][j]) {
            dp[i][j] = cost;
            trace[i][j] = { mode: '0-1', prevI: i, prevJ: j - 1 };
          }
        }
        // 2-1: 两个源句对一个目标句
        if (i >= 2 && j >= 1) {
          const cost = dp[i - 2][j - 1] + matchCost(i - 2, i, j - 1, j) + MODE_PENALTY['2-1'];
          if (cost < dp[i][j]) {
            dp[i][j] = cost;
            trace[i][j] = { mode: '2-1', prevI: i - 2, prevJ: j - 1 };
          }
        }
        // 1-2: 一个源句对两个目标句
        if (i >= 1 && j >= 2) {
          const cost = dp[i - 1][j - 2] + matchCost(i - 1, i, j - 2, j) + MODE_PENALTY['1-2'];
          if (cost < dp[i][j]) {
            dp[i][j] = cost;
            trace[i][j] = { mode: '1-2', prevI: i - 1, prevJ: j - 2 };
          }
        }
      }
    }

    // 回溯
    const pairs = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      const t = trace[i][j];
      if (!t) break;
      if (t.mode === '1-1') {
        pairs.unshift({
          source: sourceSents[i - 1],
          target: targetSents[j - 1],
          sourceIdx: i - 1, targetIdx: j - 1,
          mode: '1-1'
        });
        i = t.prevI; j = t.prevJ;
      } else if (t.mode === '1-0') {
        pairs.unshift({
          source: sourceSents[i - 1],
          target: '',
          sourceIdx: i - 1, targetIdx: -1,
          mode: '1-0'
        });
        i = t.prevI; j = t.prevJ;
      } else if (t.mode === '0-1') {
        pairs.unshift({
          source: '',
          target: targetSents[j - 1],
          sourceIdx: -1, targetIdx: j - 1,
          mode: '0-1'
        });
        i = t.prevI; j = t.prevJ;
      } else if (t.mode === '2-1') {
        pairs.unshift({
          source: sourceSents[i - 2] + ' ' + sourceSents[i - 1],
          target: targetSents[j - 1],
          sourceIdx: i - 2, targetIdx: j - 1,
          mode: '2-1'
        });
        i = t.prevI; j = t.prevJ;
      } else if (t.mode === '1-2') {
        pairs.unshift({
          source: sourceSents[i - 1],
          target: targetSents[j - 2] + ' ' + targetSents[j - 1],
          sourceIdx: i - 1, targetIdx: j - 2,
          mode: '1-2'
        });
        i = t.prevI; j = t.prevJ;
      }
    }

    return pairs;
  },

  /**
   * 计算字符长度（中文按 1 字符，英文按 1 字符，但归一化时调整）
   */
  charLen(s) {
    return String(s || '').length;
  },

  // ===== 运行对齐 =====

  /**
   * 运行自动对齐
   */
  runAlign() {
    if (this.sourceSegments.length === 0 && this.targetSegments.length === 0) {
      VibeApp.showToast('请先导入原文和译文文件', 'info');
      return;
    }
    if (this.sourceSegments.length === 0 || this.targetSegments.length === 0) {
      // 单边情况：直接生成空对
      VibeApp.showToast('只导入了单边文件，将生成半空配对', 'info');
    }

    const pairs = this.alignGaleChurch(this.sourceSegments, this.targetSegments);
    // 分配 ID
    this.alignedPairs = pairs.map((p, idx) => ({ ...p, id: idx }));
    this.selectedIds.clear();

    // 显示后续区域
    document.getElementById('alignerCleanSection').style.display = 'block';
    document.getElementById('alignerTableSection').style.display = 'block';
    document.getElementById('alignerExportSection').style.display = 'block';

    this.renderTable();
    VibeApp.showToast(`对齐完成：${pairs.length} 对（1-1: ${pairs.filter(p => p.mode === '1-1').length}）`, 'success');
  },

  // ===== 表格渲染 =====

  renderTable() {
    const tbody = document.getElementById('alignerTableBody');
    if (!tbody) return;
    const info = document.getElementById('alignerCountInfo');
    if (info) info.textContent = `${this.alignedPairs.length} 对`;

    if (this.alignedPairs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 30px; color: var(--text-tertiary);">无对齐数据</td></tr>`;
      return;
    }

    tbody.innerHTML = this.alignedPairs.map((pair, idx) => {
      const selected = this.selectedIds.has(pair.id) ? 'checked' : '';
      const modeBadge = `<span class="aligner-mode mode-${pair.mode}" title="${pair.mode}">${pair.mode}</span>`;
      const linked = pair.linked ? '🔗' : '';
      const isSelected = this.selectedIds.has(pair.id);
      return `
        <tr data-id="${pair.id}" class="${pair.linked ? 'linked-row' : ''} ${isSelected ? 'split-ready' : ''}">
          <td class="col-sel"><input type="checkbox" ${selected} onchange="VibeAligner.toggleSelect(${pair.id}, this.checked)"></td>
          <td class="col-idx">${idx + 1} ${linked}</td>
          <td class="col-src"
              ondblclick="VibeAligner.onCellDblClick(${pair.id}, 'source', this, event)"
              title="${isSelected ? '已选中：双击光标位置拆分' : '双击编辑'}">${this.escapeHtml(pair.source)} ${modeBadge}</td>
          <td class="col-tgt"
              ondblclick="VibeAligner.onCellDblClick(${pair.id}, 'target', this, event)"
              title="${isSelected ? '已选中：双击光标位置拆分' : '双击编辑'}">${this.escapeHtml(pair.target)}</td>
          <td class="col-actions">
            <button class="action-btn" onclick="VibeAligner.linkPair(${pair.id})" title="链接译文对">🔗</button>
            <button class="action-btn" onclick="VibeAligner.showCompareView(${pair.id})" title="对照查看">👁️</button>
            <button class="action-btn" onclick="VibeAligner.swapPair(${pair.id})" title="交换原文译文">🔄</button>
            <button class="action-btn" onclick="VibeAligner.splitRow(${pair.id})" title="按标点拆分">✂️</button>
            <button class="action-btn" onclick="VibeAligner.deleteRow(${pair.id})" title="删除此行">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  // 单元格双击事件：选中行时在光标位置拆分，未选中时编辑
  onCellDblClick(id, field, cell, event) {
    if (this.selectedIds.has(id)) {
      this.splitAtCursor(id, field, cell, event);
    } else {
      this.startEdit(id, field, cell);
    }
  },

  // 在光标位置拆分文本
  splitAtCursor(id, field, cell, event) {
    const pair = this.alignedPairs.find(p => p.id === id);
    if (!pair) return;
    const text = pair[field] || '';
    if (!text.trim()) {
      VibeApp.showToast('文本为空，无法拆分', 'info');
      return;
    }

    // 创建拆分编辑器：显示文本，用户放置光标后按"在此拆分"
    const existing = document.getElementById('splitCursorEditor');
    if (existing) existing.remove();

    const textarea = document.createElement('textarea');
    textarea.id = 'splitCursorEditor';
    textarea.className = 'inline-edit-textarea';
    textarea.value = text;
    textarea.style.width = '100%';
    textarea.style.minHeight = '60px';
    textarea.style.padding = '6px 8px';
    textarea.style.fontSize = '12px';
    textarea.style.border = '2px solid var(--warning-color)';
    textarea.style.borderRadius = '4px';
    textarea.style.resize = 'vertical';
    textarea.placeholder = '将光标放在要拆分的位置，然后点击下方"在此拆分"按钮';

    cell.innerHTML = '';
    cell.appendChild(textarea);
    textarea.focus();

    // 尝试将光标定位到双击位置附近
    // 使用 Range 来估算双击位置对应的字符偏移
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        // 简单地将光标放在文本中间作为默认
        const midPos = Math.floor(text.length / 2);
        textarea.setSelectionRange(midPos, midPos);
      } else {
        textarea.setSelectionRange(text.length, text.length);
      }
    } catch (e) {
      textarea.setSelectionRange(text.length, text.length);
    }

    // 创建操作按钮栏
    const btnBar = document.createElement('div');
    btnBar.style.cssText = 'display: flex; gap: 4px; margin-top: 4px;';
    btnBar.innerHTML = `
      <button class="btn btn-primary btn-sm" style="font-size: 10px; padding: 2px 8px;" title="在当前光标位置拆分">✂️ 在此拆分</button>
      <button class="btn btn-secondary btn-sm" style="font-size: 10px; padding: 2px 8px;">取消</button>
    `;
    cell.appendChild(btnBar);

    const splitBtn = btnBar.querySelector('button:first-child');
    const cancelBtn = btnBar.querySelector('button:last-child');

    const doSplit = () => {
      const cursorPos = textarea.selectionStart;
      if (cursorPos <= 0 || cursorPos >= text.length) {
        VibeApp.showToast('请将光标放在文本中间位置', 'info');
        return;
      }

      const part1 = text.substring(0, cursorPos).trim();
      const part2 = text.substring(cursorPos).trim();

      if (!part1 || !part2) {
        VibeApp.showToast('拆分后不能有空内容', 'info');
        return;
      }

      // 执行拆分
      const idx = this.alignedPairs.findIndex(p => p.id === id);
      if (idx === -1) return;

      // 原文拆分时，译文按比例或保持原样
      const otherField = field === 'source' ? 'target' : 'source';
      const otherText = pair[otherField] || '';

      // 更新当前行为前半部分
      pair[field] = part1;

      // 插入新行为后半部分
      const newPair = {
        id: Date.now() + Math.random(),
        source: field === 'source' ? part2 : otherText,
        target: field === 'target' ? part2 : otherText,
        sourceIdx: pair.sourceIdx,
        targetIdx: pair.targetIdx,
        mode: 'split'
      };

      this.alignedPairs.splice(idx + 1, 0, newPair);
      this.selectedIds.delete(id);
      this.renderTable();
      VibeApp.showToast(`已从光标位置拆分`, 'success');
    };

    splitBtn.onclick = doSplit;
    cancelBtn.onclick = () => this.renderTable();

    // 快捷键：Ctrl+Enter 拆分，Escape 取消
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        doSplit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.renderTable();
      }
    });
  },

  // 链接译文对：进入分栏链接模式（无弹窗，直接在页面上操作）
  linkPair(id) {
    this.enterLinkMode(id);
  },

  // 分栏链接模式状态
  linkMode: false,
  linkModeSelectedSource: null,
  linkModeSelectedTarget: null,
  linkModePairs: [], // 临时链接对 [{sourceId, targetId}]
  linkModeSourceId: null, // 触发链接的原始行ID

  // 进入分栏链接模式
  enterLinkMode(sourceId) {
    this.linkMode = true;
    this.linkModeSelectedSource = null;
    this.linkModeSelectedTarget = null;
    this.linkModePairs = [];
    this.linkModeSourceId = sourceId;

    // 预选触发行
    const pair = this.alignedPairs.find(p => p.id === sourceId);
    if (pair) {
      this.linkModeSelectedSource = sourceId;
    }

    this.renderLinkModeView();

    // 添加 Enter 键监听
    this._linkModeKeyHandler = (e) => {
      if (e.key === 'Enter' && this.linkMode) {
        e.preventDefault();
        this.confirmLinkMode();
      } else if (e.key === 'Escape' && this.linkMode) {
        e.preventDefault();
        this.cancelLinkMode();
      }
    };
    document.addEventListener('keydown', this._linkModeKeyHandler);
  },

  // 渲染分栏链接视图
  renderLinkModeView() {
    const container = document.getElementById('alignerTableBody');
    if (!container) return;

    // 隐藏表头
    const tableWrapper = document.querySelector('.aligner-table-wrapper');
    const table = document.querySelector('.aligner-table');
    if (table) table.style.display = 'none';

    // 创建或更新分栏视图
    let linkView = document.getElementById('linkModeView');
    if (!linkView) {
      linkView = document.createElement('div');
      linkView.id = 'linkModeView';
      linkView.className = 'link-mode-view';
      if (tableWrapper) tableWrapper.appendChild(linkView);
    }

    // 按是否已临时链接分组
    const linkedSourceIds = new Set(this.linkModePairs.map(p => p.sourceId));
    const linkedTargetIds = new Set(this.linkModePairs.map(p => p.targetId));

    linkView.innerHTML = `
      <div class="link-mode-toolbar">
        <span class="link-mode-hint">💡 点击左侧原文，再点击右侧译文进行链接（也可反向操作）。已链接的对会高亮显示。</span>
        <div class="link-mode-actions">
          <button class="btn btn-secondary btn-sm" onclick="VibeAligner.cancelLinkMode()">取消</button>
          <button class="btn btn-primary btn-sm" onclick="VibeAligner.confirmLinkMode()" title="按 Enter 确认">✅ 确认链接</button>
        </div>
      </div>
      <div class="link-mode-columns">
        <div class="link-column source-column">
          <div class="link-column-header">
            <span>📝 原文（${this.alignedPairs.length}）</span>
            <span class="link-count">${this.linkModePairs.length} 已链接</span>
          </div>
          <div class="link-column-body">
            ${this.alignedPairs.map((pair, idx) => {
              const isLinked = linkedSourceIds.has(pair.id);
              const isSelected = this.linkModeSelectedSource === pair.id;
              return `
                <div class="link-item ${isSelected ? 'selected' : ''} ${isLinked ? 'linked' : ''}"
                     onclick="VibeAligner.onLinkItemClick('source', ${pair.id})">
                  <span class="link-item-idx">${idx + 1}</span>
                  <span class="link-item-text">${this.escapeHtml(pair.source || '(空)')}</span>
                  ${isLinked ? '<span class="link-badge">🔗</span>' : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
        <div class="link-column target-column">
          <div class="link-column-header">
            <span>🌐 译文（${this.alignedPairs.length}）</span>
            <span class="link-count">${this.linkModePairs.length} 已链接</span>
          </div>
          <div class="link-column-body">
            ${this.alignedPairs.map((pair, idx) => {
              const isLinked = linkedTargetIds.has(pair.id);
              const isSelected = this.linkModeSelectedTarget === pair.id;
              return `
                <div class="link-item ${isSelected ? 'selected' : ''} ${isLinked ? 'linked' : ''}"
                     onclick="VibeAligner.onLinkItemClick('target', ${pair.id})">
                  <span class="link-item-idx">${idx + 1}</span>
                  <span class="link-item-text">${this.escapeHtml(pair.target || '(空)')}</span>
                  ${isLinked ? '<span class="link-badge">🔗</span>' : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  },

  // 分栏模式中点击条目
  onLinkItemClick(side, id) {
    if (side === 'source') {
      if (this.linkModeSelectedSource === id) {
        // 再次点击取消选择
        this.linkModeSelectedSource = null;
      } else {
        this.linkModeSelectedSource = id;
      }
    } else {
      if (this.linkModeSelectedTarget === id) {
        this.linkModeSelectedTarget = null;
      } else {
        this.linkModeSelectedTarget = id;
      }
    }

    // 如果两边都选了，创建临时链接
    if (this.linkModeSelectedSource !== null && this.linkModeSelectedTarget !== null) {
      // 检查是否已有这个链接
      const existing = this.linkModePairs.findIndex(p =>
        p.sourceId === this.linkModeSelectedSource && p.targetId === this.linkModeSelectedTarget
      );
      if (existing >= 0) {
        // 取消已有链接
        this.linkModePairs.splice(existing, 1);
      } else {
        // 移除涉及这两个ID的旧链接
        this.linkModePairs = this.linkModePairs.filter(p =>
          p.sourceId !== this.linkModeSelectedSource && p.targetId !== this.linkModeSelectedTarget
        );
        // 添加新链接
        this.linkModePairs.push({
          sourceId: this.linkModeSelectedSource,
          targetId: this.linkModeSelectedTarget
        });
      }
      // 清除选择
      this.linkModeSelectedSource = null;
      this.linkModeSelectedTarget = null;
    }

    this.renderLinkModeView();
  },

  // 确认链接模式：将临时链接对应用到数据中，并重新排列
  confirmLinkMode() {
    if (this.linkModePairs.length === 0) {
      VibeApp.showToast('没有创建任何链接', 'info');
      this.cancelLinkMode();
      return;
    }

    // 保存操作前的状态用于撤回
    this._undoStack = this._undoStack || [];
    this._undoStack.push({
      alignedPairs: JSON.parse(JSON.stringify(this.alignedPairs)),
      action: 'link'
    });

    // 应用链接：将链接对移到一起，并设置 linked/linkedTo
    const newPairs = [];
    const usedIds = new Set();

    // 先添加已链接的对
    this.linkModePairs.forEach(link => {
      const sourcePair = this.alignedPairs.find(p => p.id === link.sourceId);
      const targetPair = this.alignedPairs.find(p => p.id === link.targetId);

      if (sourcePair && targetPair) {
        // 合并为一条：source 来自源行，target 来自目标行
        const merged = {
          id: Date.now() + Math.random(),
          source: sourcePair.source,
          target: targetPair.target,
          sourceIdx: sourcePair.sourceIdx,
          targetIdx: targetPair.targetIdx,
          mode: 'manual',
          linked: true,
          linkedTo: null
        };
        newPairs.push(merged);
        usedIds.add(link.sourceId);
        usedIds.add(link.targetId);
      } else if (sourcePair) {
        // 只有源
        sourcePair.linked = true;
        newPairs.push(sourcePair);
        usedIds.add(link.sourceId);
      }
    });

    // 再添加未链接的剩余条目
    this.alignedPairs.forEach(pair => {
      if (!usedIds.has(pair.id)) {
        newPairs.push(pair);
      }
    });

    this.alignedPairs = newPairs;
    const linkedCount = this.linkModePairs.length;
    this.exitLinkMode();
    this.renderTable();

    // 显示带撤回按钮的提示
    this._showUndoToast(`已链接 ${linkedCount} 对译文对`, 'link');
  },

  // 撤回上一步操作
  undoLastAction() {
    if (!this._undoStack || this._undoStack.length === 0) {
      VibeApp.showToast('没有可撤回的操作', 'info');
      return;
    }
    const undo = this._undoStack.pop();
    this.alignedPairs = undo.alignedPairs;
    this.renderTable();
    VibeApp.showToast(`已撤回${undo.action === 'link' ? '链接' : '操作'}`, 'success');
  },

  // 显示带撤回按钮的 Toast
  _showUndoToast(message, actionType) {
    const existing = document.getElementById('undoToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'undoToast';
    toast.style.cssText = `
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      background-color: #333; color: #fff; padding: 10px 16px;
      border-radius: 8px; display: flex; align-items: center; gap: 12px;
      z-index: 10000; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      font-size: 13px; animation: slideUp 0.3s ease;
    `;
    toast.innerHTML = `
      <span>${message}</span>
      <button style="background: #165dff; color: #fff; border: none; padding: 4px 12px;
        border-radius: 4px; cursor: pointer; font-size: 12px;" onmouseover="this.style.background='#0052d9'"
        onmouseout="this.style.background='#165dff'">↩️ 撤回</button>
    `;
    document.body.appendChild(toast);

    toast.querySelector('button').onclick = () => {
      this.undoLastAction();
      toast.remove();
    };

    // 5秒后自动消失
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 5000);
  },

  // 取消链接模式
  cancelLinkMode() {
    this.exitLinkMode();
    this.renderTable();
  },

  // 退出链接模式
  exitLinkMode() {
    this.linkMode = false;
    this.linkModeSelectedSource = null;
    this.linkModeSelectedTarget = null;
    this.linkModePairs = [];

    // 移除键盘监听
    if (this._linkModeKeyHandler) {
      document.removeEventListener('keydown', this._linkModeKeyHandler);
      this._linkModeKeyHandler = null;
    }

    const linkView = document.getElementById('linkModeView');
    if (linkView) linkView.remove();

    const table = document.querySelector('.aligner-table');
    if (table) table.style.display = '';
  },

  // 显示对照查看小框（可拖动浮窗）
  showCompareView(id) {
    const pair = this.alignedPairs.find(p => p.id === id);
    if (!pair) return;

    // 移除已存在的对照窗
    const existing = document.getElementById('compareViewPanel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'compareViewPanel';
    panel.className = 'compare-view-panel';
    panel.innerHTML = `
      <div class="compare-view-header">
        <span class="compare-view-title">📖 对照查看 #${this.alignedPairs.indexOf(pair) + 1}</span>
        <div class="compare-view-actions">
          <button class="compare-nav-btn" onclick="VibeAligner.comparePrev(${id})" title="上一条">⬆</button>
          <button class="compare-nav-btn" onclick="VibeAligner.compareNext(${id})" title="下一条">⬇</button>
          <button class="compare-close-btn" onclick="document.getElementById('compareViewPanel').remove()">✕</button>
        </div>
      </div>
      <div class="compare-view-body">
        <div class="compare-view-section">
          <div class="compare-view-label">
            <span>📝 原文</span>
            <button class="compare-copy-btn" onclick="VibeAligner.copyCompareText('source', ${id})">📋 复制</button>
          </div>
          <div class="compare-view-text source-text" id="compareSource">${this.escapeHtml(pair.source)}</div>
        </div>
        <div class="compare-view-section">
          <div class="compare-view-label">
            <span>🌐 译文</span>
            <button class="compare-copy-btn" onclick="VibeAligner.copyCompareText('target', ${id})">📋 复制</button>
          </div>
          <div class="compare-view-text target-text" id="compareTarget">${this.escapeHtml(pair.target)}</div>
        </div>
      </div>
      <div class="compare-view-footer">
        <label class="compare-load-label">
          <input type="file" id="compareFileInput" accept=".txt,.md,.docx,.pdf" onchange="VibeAligner.loadCompareFile(this.files[0])">
          📂 打开文档对照
        </label>
        <div id="compareExternalText" class="compare-external-text"></div>
      </div>
    `;
    document.body.appendChild(panel);

    // 使面板可拖动
    this.makeDraggable(panel, panel.querySelector('.compare-view-header'));
  },

  // 对照查看 - 上一条
  comparePrev(currentId) {
    const idx = this.alignedPairs.findIndex(p => p.id === currentId);
    if (idx <= 0) {
      VibeApp.showToast('已是第一条', 'info');
      return;
    }
    this.showCompareView(this.alignedPairs[idx - 1].id);
  },

  // 对照查看 - 下一条
  compareNext(currentId) {
    const idx = this.alignedPairs.findIndex(p => p.id === currentId);
    if (idx >= this.alignedPairs.length - 1) {
      VibeApp.showToast('已是最后一条', 'info');
      return;
    }
    this.showCompareView(this.alignedPairs[idx + 1].id);
  },

  // 复制对照文本
  copyCompareText(field, id) {
    const pair = this.alignedPairs.find(p => p.id === id);
    if (!pair) return;
    const text = pair[field] || '';
    navigator.clipboard.writeText(text).then(() => {
      VibeApp.showToast('已复制到剪贴板', 'success');
    });
  },

  // 加载外部文档进行对照
  async loadCompareFile(file) {
    if (!file) return;
    try {
      const text = await this.extractPlainText(file);
      const container = document.getElementById('compareExternalText');
      if (container) {
        container.innerHTML = `
          <div class="compare-external-header">
            <span>📄 ${this.escapeHtml(file.name)}</span>
            <button class="compare-close-btn" onclick="this.parentElement.parentElement.innerHTML=''">✕</button>
          </div>
          <div class="compare-external-body">${this.escapeHtml(text.substring(0, 2000))}${text.length > 2000 ? '...' : ''}</div>
        `;
      }
      VibeApp.showToast(`已加载 ${file.name}`, 'success');
    } catch (err) {
      VibeApp.showToast('加载文档失败: ' + err.message, 'error');
    }
  },

  // 使元素可拖动
  makeDraggable(element, handle) {
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      element.style.left = (startLeft + dx) + 'px';
      element.style.top = (startTop + dy) + 'px';
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  },

  /**
   * 双击编辑单元格
   */
  startEdit(id, field, cell) {
    const pair = this.alignedPairs.find(p => p.id === id);
    if (!pair) return;
    const oldValue = pair[field] || '';
    const textarea = document.createElement('textarea');
    textarea.className = 'inline-edit-textarea';
    textarea.value = oldValue;
    textarea.style.width = '100%';
    textarea.style.minHeight = '40px';
    textarea.style.padding = '4px 6px';
    textarea.style.fontSize = '12px';
    textarea.style.border = '1px solid var(--primary-color)';
    textarea.style.borderRadius = '4px';
    textarea.style.resize = 'vertical';
    cell.innerHTML = '';
    cell.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const finishEdit = () => {
      pair[field] = textarea.value;
      this.renderTable();
    };
    textarea.addEventListener('blur', finishEdit);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // 取消，恢复原值
        this.renderTable();
      } else if (e.key === 'Enter' && e.ctrlKey) {
        // Ctrl+Enter 确认
        finishEdit();
      }
    });
  },

  // ===== 选择操作 =====

  toggleSelect(id, checked) {
    if (checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
  },

  selectAll(checked) {
    if (checked) {
      this.alignedPairs.forEach(p => this.selectedIds.add(p.id));
    } else {
      this.selectedIds.clear();
    }
    this.renderTable();
  },

  // ===== 清洗操作 =====

  /**
   * 去除所有原文和译文的首尾空白
   */
  cleanTrimAll() {
    let count = 0;
    this.alignedPairs.forEach(pair => {
      const beforeS = pair.source;
      const beforeT = pair.target;
      pair.source = (pair.source || '').trim();
      pair.target = (pair.target || '').trim();
      if (pair.source !== beforeS || pair.target !== beforeT) count++;
    });
    this.renderTable();
    VibeApp.showToast(`已清理 ${count} 行首尾空白`, 'success');
  },

  /**
   * 去重：移除完全重复的原文+译文对
   */
  cleanDedupAll() {
    const seen = new Set();
    const before = this.alignedPairs.length;
    this.alignedPairs = this.alignedPairs.filter(pair => {
      const key = (pair.source || '') + '|||' + (pair.target || '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const removed = before - this.alignedPairs.length;
    this.renderTable();
    VibeApp.showToast(`已去除 ${removed} 条重复`, 'success');
  },

  /**
   * 去空行：移除原文和译文都为空的行
   */
  cleanEmptyAll() {
    const before = this.alignedPairs.length;
    this.alignedPairs = this.alignedPairs.filter(pair =>
      (pair.source || '').trim().length > 0 || (pair.target || '').trim().length > 0
    );
    const removed = before - this.alignedPairs.length;
    this.renderTable();
    VibeApp.showToast(`已移除 ${removed} 条空行`, 'success');
  },

  /**
   * 查找替换对话框
   */
  showFindReplaceDialog() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 480px;">
        <button class="modal-close-btn" onclick="this.closest('.modal-overlay').remove()">✕</button>
        <h3>🔍 查找替换</h3>
        <div class="form-group">
          <label>查找内容</label>
          <input type="text" id="findText" class="form-input" placeholder="要查找的文本">
        </div>
        <div class="form-group">
          <label>替换为</label>
          <input type="text" id="replaceText" class="form-input" placeholder="替换为（留空表示删除）">
        </div>
        <div class="form-group">
          <label>作用范围</label>
          <div style="display:flex; gap:12px;">
            <label><input type="checkbox" id="applySource" checked> 原文</label>
            <label><input type="checkbox" id="applyTarget" checked> 译文</label>
            <label><input type="checkbox" id="applySelectedOnly"> 仅选中行</label>
          </div>
        </div>
        <div class="form-group">
          <label><input type="checkbox" id="useRegex"> 使用正则表达式</label>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" onclick="VibeAligner.executeFindReplace()">替换全部</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  executeFindReplace() {
    const findText = document.getElementById('findText').value;
    const replaceText = document.getElementById('replaceText').value;
    const applySource = document.getElementById('applySource').checked;
    const applyTarget = document.getElementById('applyTarget').checked;
    const selectedOnly = document.getElementById('applySelectedOnly').checked;
    const useRegex = document.getElementById('useRegex').checked;

    if (!findText) {
      VibeApp.showToast('请输入查找内容', 'info');
      return;
    }

    let regex;
    try {
      regex = useRegex ? new RegExp(findText, 'g') : null;
    } catch (e) {
      VibeApp.showToast('正则表达式错误: ' + e.message, 'error');
      return;
    }

    let count = 0;
    const targetPairs = selectedOnly
      ? this.alignedPairs.filter(p => this.selectedIds.has(p.id))
      : this.alignedPairs;

    targetPairs.forEach(pair => {
      if (applySource && pair.source) {
        const before = pair.source;
        pair.source = regex
          ? pair.source.replace(regex, replaceText)
          : pair.source.split(findText).join(replaceText);
        if (before !== pair.source) count++;
      }
      if (applyTarget && pair.target) {
        const before = pair.target;
        pair.target = regex
          ? pair.target.replace(regex, replaceText)
          : pair.target.split(findText).join(replaceText);
        if (before !== pair.target) count++;
      }
    });

    document.querySelector('.modal-overlay.show')?.remove();
    this.renderTable();
    VibeApp.showToast(`已替换 ${count} 处`, 'success');
  },

  /**
   * 合并选中的多行为一行
   */
  mergeSelected() {
    if (this.selectedIds.size < 2) {
      VibeApp.showToast('请至少选择 2 行进行合并', 'info');
      return;
    }
    const ids = Array.from(this.selectedIds).sort((a, b) => a - b);
    const pairs = ids.map(id => this.alignedPairs.find(p => p.id === id)).filter(Boolean);
    if (pairs.length < 2) return;

    const mergedSource = pairs.map(p => p.source).filter(s => s).join(' ');
    const mergedTarget = pairs.map(p => p.target).filter(t => t).join(' ');

    const firstIdx = this.alignedPairs.findIndex(p => p.id === ids[0]);
    this.alignedPairs[firstIdx] = {
      ...this.alignedPairs[firstIdx],
      source: mergedSource,
      target: mergedTarget,
      mode: 'merged'
    };
    // 移除其他行
    this.alignedPairs = this.alignedPairs.filter(p => !ids.slice(1).includes(p.id));
    this.selectedIds.clear();
    this.renderTable();
    VibeApp.showToast(`已合并 ${pairs.length} 行`, 'success');
  },

  /**
   * 拆分选中行：按句号或换行拆分
   */
  splitSelected() {
    if (this.selectedIds.size === 0) {
      VibeApp.showToast('请选择要拆分的行', 'info');
      return;
    }
    let addedCount = 0;
    const newPairs = [];
    this.alignedPairs.forEach(pair => {
      if (this.selectedIds.has(pair.id)) {
        // 按 句号/问号/感叹号/换行 拆分
        const srcParts = (pair.source || '').split(/(?<=[。！？.!?])\s*|\n+/).map(s => s.trim()).filter(s => s);
        const tgtParts = (pair.target || '').split(/(?<=[。！？.!?])\s*|\n+/).map(t => t.trim()).filter(t => t);

        if (srcParts.length <= 1 && tgtParts.length <= 1) {
          newPairs.push(pair);
          return;
        }
        // 取最大长度，缺失的留空
        const maxLen = Math.max(srcParts.length, tgtParts.length);
        for (let i = 0; i < maxLen; i++) {
          newPairs.push({
            id: Date.now() + Math.random() + i,
            source: srcParts[i] || '',
            target: tgtParts[i] || '',
            sourceIdx: pair.sourceIdx,
            targetIdx: pair.targetIdx,
            mode: 'split'
          });
          addedCount++;
        }
      } else {
        newPairs.push(pair);
      }
    });
    this.alignedPairs = newPairs;
    this.selectedIds.clear();
    this.renderTable();
    VibeApp.showToast(`已拆分，新增 ${addedCount} 行`, 'success');
  },

  /**
   * 拆分单行（按钮操作）
   */
  splitRow(id) {
    this.selectedIds.clear();
    this.selectedIds.add(id);
    this.splitSelected();
  },

  /**
   * 删除选中行
   */
  deleteSelected() {
    if (this.selectedIds.size === 0) {
      VibeApp.showToast('请选择要删除的行', 'info');
      return;
    }
    const count = this.selectedIds.size;
    this.alignedPairs = this.alignedPairs.filter(p => !this.selectedIds.has(p.id));
    this.selectedIds.clear();
    this.renderTable();
    VibeApp.showToast(`已删除 ${count} 行`, 'success');
  },

  /**
   * 删除单行
   */
  deleteRow(id) {
    this.alignedPairs = this.alignedPairs.filter(p => p.id !== id);
    this.renderTable();
  },

  /**
   * 交换原文和译文
   */
  swapPair(id) {
    const pair = this.alignedPairs.find(p => p.id === id);
    if (!pair) return;
    [pair.source, pair.target] = [pair.target, pair.source];
    this.renderTable();
  },

  // ===== 手动配对 =====

  showManualAlignDialog() {
    if (this.sourceSegments.length === 0 && this.targetSegments.length === 0) {
      VibeApp.showToast('请先导入文件', 'info');
      return;
    }
    const modal = document.createElement('div');
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 900px;">
        <button class="modal-close-btn" onclick="this.closest('.modal-overlay').remove()">✕</button>
        <h3>✋ 手动配对</h3>
        <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">勾选要配对的原文和译文，点击"配对选中"生成一对</p>
        <div style="display: flex; gap: 16px;">
          <div style="flex: 1;">
            <h4>原文 (${this.sourceSegments.length})</h4>
            <div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 4px;">
              ${this.sourceSegments.map((s, i) => `
                <div style="padding: 6px 10px; border-bottom: 1px solid var(--border-light);">
                  <label><input type="checkbox" class="manual-src" value="${i}"> ${this.escapeHtml(s.slice(0, 60))}${s.length > 60 ? '...' : ''}</label>
                </div>
              `).join('')}
            </div>
          </div>
          <div style="flex: 1;">
            <h4>译文 (${this.targetSegments.length})</h4>
            <div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 4px;">
              ${this.targetSegments.map((t, i) => `
                <div style="padding: 6px 10px; border-bottom: 1px solid var(--border-light);">
                  <label><input type="checkbox" class="manual-tgt" value="${i}"> ${this.escapeHtml(t.slice(0, 60))}${t.length > 60 ? '...' : ''}</label>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">完成</button>
          <button class="btn btn-primary" onclick="VibeAligner.addManualPair()">配对选中</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  addManualPair() {
    const srcChecked = Array.from(document.querySelectorAll('.manual-src:checked')).map(c => parseInt(c.value));
    const tgtChecked = Array.from(document.querySelectorAll('.manual-tgt:checked')).map(c => parseInt(c.value));
    if (srcChecked.length === 0 && tgtChecked.length === 0) {
      VibeApp.showToast('请勾选要配对的项', 'info');
      return;
    }
    const source = srcChecked.map(i => this.sourceSegments[i]).join(' ');
    const target = tgtChecked.map(i => this.targetSegments[i]).join(' ');
    this.alignedPairs.push({
      id: Date.now() + Math.random(),
      source, target,
      sourceIdx: -1, targetIdx: -1,
      mode: 'manual'
    });
    // 清除勾选
    document.querySelectorAll('.manual-src:checked, .manual-tgt:checked').forEach(c => c.checked = false);
    // 显示区域
    document.getElementById('alignerCleanSection').style.display = 'block';
    document.getElementById('alignerTableSection').style.display = 'block';
    document.getElementById('alignerExportSection').style.display = 'block';
    this.renderTable();
    VibeApp.showToast('已配对，可继续勾选下一对', 'success');
  },

  // ===== 导出和入库 =====

  /**
   * 一键导入到记忆库
   */
  importToMemory() {
    if (this.alignedPairs.length === 0) {
      VibeApp.showToast('没有对齐数据', 'info');
      return;
    }
    const srcLang = document.getElementById('alignerSourceLang').value;
    const tgtLang = document.getElementById('alignerTargetLang').value;
    let count = 0;
    this.alignedPairs.forEach(pair => {
      if (pair.source && pair.target && pair.source.trim() && pair.target.trim()) {
        VibeMemory.add(pair.source, pair.target, srcLang, tgtLang, 'default', 'human');
        count++;
      }
    });
    VibeApp.showToast(`已导入 ${count} 条到记忆库`, 'success');
  },

  /**
   * 一键导入到语料库
   */
  importToCorpus() {
    if (this.alignedPairs.length === 0) {
      VibeApp.showToast('没有对齐数据', 'info');
      return;
    }
    const srcLang = document.getElementById('alignerSourceLang').value;
    const tgtLang = document.getElementById('alignerTargetLang').value;
    let count = 0;
    this.alignedPairs.forEach(pair => {
      if (pair.source && pair.target && pair.source.trim() && pair.target.trim()) {
        VibeCorpus.add(pair.source, pair.target, srcLang, tgtLang, '', 'aligner', false);
        count++;
      }
    });
    VibeApp.showToast(`已导入 ${count} 条到语料库`, 'success');
  },

  /**
   * 一键导入到术语库（标记为术语）
   */
  importToGlossary() {
    if (this.alignedPairs.length === 0) {
      VibeApp.showToast('没有对齐数据', 'info');
      return;
    }
    const srcLang = document.getElementById('alignerSourceLang').value;
    const tgtLang = document.getElementById('alignerTargetLang').value;
    let count = 0;
    this.alignedPairs.forEach(pair => {
      if (pair.source && pair.target && pair.source.trim() && pair.target.trim()) {
        VibeCorpus.add(pair.source, pair.target, srcLang, tgtLang, '术语', 'aligner', true);
        count++;
      }
    });
    VibeApp.showToast(`已导入 ${count} 条到术语库`, 'success');
  },

  /**
   * 导出 TMX 1.4b
   */
  exportTmx() {
    if (this.alignedPairs.length === 0) {
      VibeApp.showToast('没有对齐数据', 'info');
      return;
    }
    const srcLang = document.getElementById('alignerSourceLang').value;
    const tgtLang = document.getElementById('alignerTargetLang').value;
    const now = new Date().toISOString();
    const escapeXml = (s) => String(s || '').replace(/[<>&'"]/g, c => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
    }[c]));
    const srcTmx = VibeMemory.toTmxLangCode(srcLang);
    const tgtTmx = VibeMemory.toTmxLangCode(tgtLang);

    const bodyXml = this.alignedPairs
      .filter(p => p.source && p.target)
      .map((pair, i) => `
    <tu tuid="align-${i}" srclang="${srcTmx}" datatype="text">
      <prop type="mode">${pair.mode || 'aligned'}</prop>
      <tuv xml:lang="${srcTmx}"><seg>${escapeXml(pair.source)}</seg></tuv>
      <tuv xml:lang="${tgtTmx}"><seg>${escapeXml(pair.target)}</seg></tuv>
    </tu>`).join('');

    const tmx = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tmx SYSTEM "tmx14b.dtd">
<tmx version="1.4b">
  <header creationtool="VibeTrans-Aligner" creationtoolversion="1.0"
          segtype="sentence" o-tmf="plain text" adminlang="zh-CN"
          srclang="${srcTmx}" datatype="plaintext" creationdate="${now}"/>
  <body>${bodyXml}
  </body>
</tmx>`;

    const blob = new Blob([tmx], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aligned-${new Date().toISOString().slice(0, 10)}.tmx`;
    a.click();
    URL.revokeObjectURL(url);
    VibeApp.showToast('TMX 导出完成', 'success');
  },

  /**
   * 导出 CSV
   */
  exportCsv() {
    if (this.alignedPairs.length === 0) {
      VibeApp.showToast('没有对齐数据', 'info');
      return;
    }
    const escapeCsv = (s) => {
      const str = String(s || '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    const header = ['序号', '原文', '译文', '对齐模式'];
    const rows = this.alignedPairs.map((p, i) => [
      i + 1, escapeCsv(p.source), escapeCsv(p.target), escapeCsv(p.mode)
    ].join(','));
    const csv = '\ufeff' + header.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aligned-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    VibeApp.showToast('CSV 导出完成', 'success');
  },

  /**
   * 导出双语 TXT（原文 \t 译文 \n）
   */
  exportBilingualTxt() {
    if (this.alignedPairs.length === 0) {
      VibeApp.showToast('没有对齐数据', 'info');
      return;
    }
    const lines = this.alignedPairs
      .filter(p => p.source && p.target)
      .map(p => `${p.source}\t${p.target}`);
    const text = lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aligned-bilingual-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    VibeApp.showToast('双语 TXT 导出完成', 'success');
  },

  // ===== 其他工具 =====

  resetAll() {
    if (!confirm('确定清空所有对齐数据？')) return;
    this.sourceSegments = [];
    this.targetSegments = [];
    this.alignedPairs = [];
    this.selectedIds.clear();
    this.sourceFileName = '';
    this.targetFileName = '';
    document.getElementById('alignerSourceInfo').textContent = '未导入';
    document.getElementById('alignerTargetInfo').textContent = '未导入';
    document.getElementById('alignerSourceFile').value = '';
    document.getElementById('alignerTargetFile').value = '';
    document.getElementById('alignerCleanSection').style.display = 'none';
    document.getElementById('alignerTableSection').style.display = 'none';
    document.getElementById('alignerExportSection').style.display = 'none';
    VibeApp.showToast('已清空', 'success');
  },

  showHelp() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <button class="modal-close-btn" onclick="this.closest('.modal-overlay').remove()">✕</button>
        <h3>❓ 使用说明</h3>
        <div style="font-size: 13px; line-height: 1.7;">
          <p><strong>① 导入文件</strong>：分别选择原文和译文文件（支持 TXT/MD/PDF/DOCX/DOC），系统会自动按段落和句子切分。</p>
          <p><strong>② 自动对齐</strong>：使用 Gale-Church 长度对齐算法，根据句子长度自动配对原文和译文。支持 5 种对齐模式：1-1、1-0、0-1、2-1、1-2。</p>
          <p><strong>② 手动配对</strong>：勾选要配对的原文/译文段落，手动生成对。</p>
          <p><strong>③ 清洗工具</strong>：</p>
          <ul style="padding-left: 20px;">
            <li>去空格：去除每行首尾空白</li>
            <li>去重：移除完全相同的原文+译文对</li>
            <li>去空行：移除原文和译文都为空的行</li>
            <li>查找替换：批量替换文本，支持正则</li>
            <li>合并选中：将多行原文/译文合并为一行</li>
            <li>拆分选中：按句号或换行拆分为多行</li>
          </ul>
          <p><strong>④ 表格编辑</strong>：双击原文/译文单元格可直接编辑，按 Esc 取消，Ctrl+Enter 确认。</p>
          <p><strong>⑤ 导出与入库</strong>：一键导入到记忆库/语料库/术语库，或导出为 TMX/CSV/双语 TXT。</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">知道了</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text || '');
    return div.innerHTML;
  }
};

window.VibeAligner = VibeAligner;
