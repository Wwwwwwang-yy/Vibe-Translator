/**
 * 实时字幕模块
 * 实现视频字幕翻译与编辑功能
 */
const VibeSubtitles = {
  // 字幕数组
  subtitles: [],

  // 当前视频URL
  videoUrl: null,

  // 当前视频文件
  videoFile: null,

  // 视频元素引用（用于同步）
  videoElement: null,

  // 当前活跃的字幕索引（播放中的字幕）
  currentSubtitleIndex: -1,

  // 当前选中的字幕索引（用于单条样式编辑）
  selectedSubtitleIndex: -1,

  // 多选字幕索引数组
  selectedIndices: [],

  // 字幕显示模式：original（仅原文）、translated（仅译文）、both（双语）
  displayMode: 'both',

  // 当前编辑的轨道
  currentTrack: 'main',

  // 时间轴列表的排序和筛选
  timelineSortBy: 'timeAsc',       // timeAsc | timeDesc | durationDesc | durationAsc | textLenDesc | translationStatus
  timelineSearchQuery: '',
  timelineFilterTranslated: 'all', // all | translated | untranslated
  timelineBatchMode: false,
  
  // 翻译并发控制
  maxConcurrent: 3,
  activeRequests: 0,
  
  // 时间标记
  markedStartTime: null,
  markedEndTime: null,
  
  // 全局样式设置（默认值）
  globalStyleSettings: {
    position: 10,
    horizontalPosition: 50,
    originalFontSize: 12,
    translatedFontSize: 12,
    originalFontFamily: "'Microsoft YaHei', sans-serif",
    translatedFontFamily: "'Microsoft YaHei', sans-serif",
    originalColor: '#ffffff',
    translatedColor: '#ffffff',
    originalVerticalOffset: 0,
    translatedVerticalOffset: 4,
    fontFamily: "'Microsoft YaHei', sans-serif",
    originalHorizontalOffset: 0,
    translatedHorizontalOffset: 0,
    originalLetterSpacing: 0,
    translatedLetterSpacing: 0,
    textDirection: 'horizontal',
    globalDisplayMode: 'bilingual',
    strokeColor: '#000000',
    strokeWidth: 0,
    shadowColor: '#000000',
    shadowOffset: 2,
    shadowBlur: 4,
    useGradient: false,
    gradientStart: '#ffffff',
    gradientEnd: '#a0a0ff',
    gradientDirection: 'horizontal',
    scrollMode: 'none',
    scrollSpeed: 5,
    bgOpacity: 0,
    bgColor: '#000000',
    letterSpacing: 0,
    lineHeight: 16,
    karaokeEnabled: false,
    karaokeColor: '#00ff00',
    karaokeDimColor: '#888888',
    karaokeAnimation: 'gradient',
    karaokeSpeed: 5
  },
  
  // 是否使用全局统一样式
  isGlobalStyle: true,
  
  // 样式模板列表
  styleTemplates: [],
  
  // 当前选中的字符信息
  selectedChar: {
    textType: 'original',
    index: -1
  },
  
  // 语音识别相关
  whisperPipeline: null,
  voskModel: null,
  voskRecognizer: null,
  ffmpeg: null,
  isGenerating: false,
  isTranscribing: false,
  
  // 识别语言
  recognizeLanguage: 'zh',

  // 翻译源语言和目标语言
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  
  // 初始化
  init() {
    this.bindEvents();
    this.loadStyleSettings();
    this.loadStyleTemplates();
    this.loadSubtitles();
    this.updateUI();
    this.initDragAndDrop();
    this.initKeyboardShortcuts();
    this.initWaveform();
    this.renderTrackTabs();
    this.checkFirstVisit();
  },

  // 字幕轨道定义（带位置/样式约束、自动识别规则）
  trackDefinitions: [
    {
      id: 'main', name: '主对白', icon: '💬', color: '#165dff', desc: '人物说话原文+译文',
      position: 'bottom', builtin: true, enabled: true,
      style: { fontSize: 24, primaryColor: '#FFFFFF', outlineColor: '#000000', bold: true }
    },
    {
      id: 'title', name: '人名注释', icon: '🏷️', color: '#faad14', desc: '顶部人名标注，固定【角色名】格式',
      position: 'top', builtin: true, enabled: true,
      requiredFormat: '【角色名】', enforcePrefix: true,
      style: { fontSize: 18, primaryColor: '#FFD700', outlineColor: '#000000', bold: true }
    },
    {
      id: 'annotation', name: '剧情注释', icon: '📝', color: '#52c41a', desc: '灰色小字，自动识别（音效）/【注：】注释',
      position: 'bottom', builtin: true, enabled: true, offset: 60,
      autoDetectPatterns: ['（[^）]*）', '\\([^)]*\\)', '【注：[^】]*】', '【[^】]*】', '\\[[^]]*\\]'],
      style: { fontSize: 14, primaryColor: '#AAAAAA', outlineColor: '#000000', italic: true }
    }
  ],

  // 自定义轨道（用户扩展）
  customTracks: [],

  // 获取所有轨道（内置+自定义）
  getAllTracks() {
    return [...this.trackDefinitions, ...this.customTracks];
  },

  // 获取启用状态的轨道
  getEnabledTracks() {
    return this.getAllTracks().filter(t => t.enabled !== false);
  },

  // 根据ID获取轨道定义
  getTrackDef(trackId) {
    return this.getAllTracks().find(t => t.id === trackId);
  },

  // 获取当前轨道的字幕
  getSubtitlesByTrack(trackId) {
    return this.subtitles.filter(s => (s.track || 'main') === trackId);
  },

  // 获取当前轨道的所有字幕（含全局索引）
  getSubtitlesByTrackWithIndex(trackId) {
    const result = [];
    this.subtitles.forEach((s, i) => {
      if ((s.track || 'main') === trackId) {
        result.push({ ...s, globalIndex: i });
      }
    });
    return result;
  },

  // 切换轨道
  switchTrack(trackId) {
    this.currentTrack = trackId;
    this.selectedIndices = [];
    this.renderTrackTabs();
    this.renderTimeline();
  },

  // 渲染轨道标签栏（带开关、批量操作）
  renderTrackTabs() {
    const container = document.getElementById('subtitleTrackTabs');
    if (!container) return;
    const allTracks = this.getAllTracks();

    container.innerHTML = allTracks.map(track => {
      const count = this.getSubtitlesByTrack(track.id).length;
      const active = this.currentTrack === track.id;
      const enabled = track.enabled !== false;
      const positionLabel = track.position === 'top' ? '↑顶' : '↓底';
      const formatHint = track.requiredFormat ? ` · 格式: ${track.requiredFormat}` : '';
      return `
        <div class="track-tab-wrapper ${active ? 'active' : ''}" style="--track-color: ${track.color}">
          <button class="track-tab ${active ? 'active' : ''} ${!enabled ? 'disabled' : ''}"
            onclick="VibeSubtitles.switchTrack('${track.id}')"
            title="${track.desc}${formatHint}">
            <span class="track-icon">${track.icon}</span>
            <span class="track-name">${track.name}</span>
            <span class="track-count">${count}</span>
            <span class="track-pos">${positionLabel}</span>
          </button>
          <div class="track-actions">
            <label class="track-toggle-switch" title="启用/关闭轨道">
              <input type="checkbox" ${enabled ? 'checked' : ''} onchange="VibeSubtitles.toggleTrackEnabled('${track.id}', this.checked)">
              <span class="toggle-slider"></span>
            </label>
            ${track.id === 'title' ? `<button class="track-action-btn" onclick="VibeSubtitles.batchAddCharacterPrefix()" title="批量添加【人物名】前缀">👤</button>` : ''}
            ${track.id === 'annotation' ? `<button class="track-action-btn" onclick="VibeSubtitles.autoSplitAnnotations()" title="自动拆分括号注释">✂️</button>` : ''}
            ${!track.builtin ? `<button class="track-action-btn delete" onclick="VibeSubtitles.deleteCustomTrack('${track.id}')" title="删除轨道">🗑️</button>` : ''}
          </div>
        </div>
      `;
    }).join('') + `
      <button class="track-tab add-track-btn" onclick="VibeSubtitles.addCustomTrackPrompt()" title="添加自定义轨道">
        <span class="track-icon">➕</span>
        <span class="track-name">新轨道</span>
      </button>
    `;
  },

  // 启用/关闭轨道
  toggleTrackEnabled(trackId, enabled) {
    const track = this.getTrackDef(trackId);
    if (!track) return;
    track.enabled = enabled;
    // 主对白不可关闭
    if (trackId === 'main') {
      track.enabled = true;
      VibeApp.showToast('主对白轨道不可关闭', 'info');
      this.renderTrackTabs();
      return;
    }
    if (!enabled && this.currentTrack === trackId) {
      this.currentTrack = 'main';
    }
    this.renderTrackTabs();
    this.renderTimeline();
    VibeApp.showToast(`${enabled ? '已启用' : '已关闭'}「${track.name}」轨道`, 'success');
  },

  // 添加自定义轨道弹窗
  addCustomTrackPrompt() {
    const existing = document.getElementById('addCustomTrackModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'addCustomTrackModal';
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 460px;">
        <button class="modal-close-btn" onclick="document.getElementById('addCustomTrackModal').remove()">✕</button>
        <h3 style="margin-bottom: 16px;">➕ 添加自定义轨道</h3>
        <div class="form-group">
          <label>轨道名称</label>
          <input type="text" id="newTrackName" class="form-input" placeholder="例如：歌词 / 旁白">
        </div>
        <div class="form-group">
          <label>图标</label>
          <select id="newTrackIcon" class="form-input">
            <option value="🎵">🎵 音乐</option>
            <option value="🎤">🎤 演唱</option>
            <option value="📢">📢 广播</option>
            <option value="💭">💭 内心独白</option>
            <option value="🔔">🔔 提示</option>
            <option value="📺">📺 画外音</option>
            <option value="📝">📝 备注</option>
          </select>
        </div>
        <div class="form-group">
          <label>位置</label>
          <select id="newTrackPosition" class="form-input">
            <option value="bottom">底部（默认）</option>
            <option value="top">顶部</option>
          </select>
        </div>
        <div class="form-group">
          <label>颜色</label>
          <input type="color" id="newTrackColor" value="#9333ea" class="form-input" style="height: 36px;">
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('addCustomTrackModal').remove()">取消</button>
          <button class="btn btn-primary" onclick="VibeSubtitles.confirmAddCustomTrack()">添加轨道</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  confirmAddCustomTrack() {
    const name = document.getElementById('newTrackName').value.trim();
    if (!name) {
      VibeApp.showToast('请输入轨道名称', 'error');
      return;
    }
    const icon = document.getElementById('newTrackIcon').value;
    const position = document.getElementById('newTrackPosition').value;
    const color = document.getElementById('newTrackColor').value;
    const id = 'custom_' + Date.now();
    this.customTracks.push({
      id, name, icon, color, position, builtin: false, enabled: true,
      desc: '用户自定义轨道',
      style: { fontSize: 16, primaryColor: color, outlineColor: '#000000' }
    });
    document.getElementById('addCustomTrackModal').remove();
    this.currentTrack = id;
    this.renderTrackTabs();
    this.renderTimeline();
    VibeApp.showToast(`已添加「${name}」轨道`, 'success');
  },

  deleteCustomTrack(trackId) {
    const idx = this.customTracks.findIndex(t => t.id === trackId);
    if (idx < 0) return;
    const track = this.customTracks[idx];
    const count = this.getSubtitlesByTrack(trackId).length;
    if (count > 0) {
      if (!confirm(`轨道内有 ${count} 条字幕，删除后字幕将移动到「主对白」。确认删除？`)) return;
      this.subtitles.forEach(s => { if (s.track === trackId) s.track = 'main'; });
    }
    this.customTracks.splice(idx, 1);
    if (this.currentTrack === trackId) this.currentTrack = 'main';
    this.renderTrackTabs();
    this.renderTimeline();
    this.saveSubtitles();
    VibeApp.showToast(`已删除「${track.name}」轨道`, 'success');
  },

  // 批量添加【人物名】前缀（人名注释轨道专属）
  batchAddCharacterPrefix() {
    if (this.selectedIndices.length === 0) {
      VibeApp.showToast('请先选中要添加人物名前缀的字幕', 'info');
      return;
    }
    const existing = document.getElementById('charPrefixModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'charPrefixModal';
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 420px;">
        <button class="modal-close-btn" onclick="document.getElementById('charPrefixModal').remove()">✕</button>
        <h3 style="margin-bottom: 16px;">👤 批量添加【人物名】前缀</h3>
        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">
          将为已选中的 <strong style="color: var(--primary-color);">${this.selectedIndices.length}</strong> 条字幕原文前添加【人物名】前缀。
        </p>
        <div class="form-group">
          <label>人物名（不带【】）</label>
          <input type="text" id="charPrefixName" class="form-input" placeholder="例如：张三" autofocus>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" id="charPrefixAlsoTitle" checked>
            同时复制一份到「人名注释」轨道
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('charPrefixModal').remove()">取消</button>
          <button class="btn btn-primary" onclick="VibeSubtitles.applyCharPrefix()">应用</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  applyCharPrefix() {
    const name = document.getElementById('charPrefixName').value.trim();
    if (!name) {
      VibeApp.showToast('请输入人物名', 'error');
      return;
    }
    const alsoTitle = document.getElementById('charPrefixAlsoTitle').checked;
    const prefix = `【${name}】`;
    let count = 0;
    const titleSubs = [];
    this.selectedIndices.forEach(idx => {
      const sub = this.subtitles[idx];
      if (!sub) return;
      // 仅在原文未包含该前缀时添加
      if (!sub.originalText.startsWith(prefix)) {
        sub.originalText = prefix + sub.originalText;
      }
      count++;
      if (alsoTitle) {
        titleSubs.push({
          ...sub,
          id: Date.now() + Math.random(),
          track: 'title',
          originalText: prefix,
          translatedText: '',
          charStyles: null
        });
      }
    });
    if (titleSubs.length > 0) {
      this.subtitles.push(...titleSubs);
      this.sortSubtitles();
    }
    this.saveSubtitles();
    this.renderTrackTabs();
    this.renderTimeline();
    document.getElementById('charPrefixModal').remove();
    VibeApp.showToast(`已为 ${count} 条字幕添加「${prefix}」前缀${alsoTitle ? `，并创建 ${titleSubs.length} 条人名注释` : ''}`, 'success');
  },

  // 自动拆分括号注释（剧情注释轨道专属）
  // 扫描主对白轨道所有字幕，把括号（）【注：】内的注释拆分到注释轨道
  autoSplitAnnotations() {
    const patterns = [
      /（[^）]*）/g,
      /\([^)]*\)/g,
      /【注：[^】]*】/g,
      /【[^】]*】/g,
      /\[[^]]*\]/g
    ];
    const annotationTrack = this.getTrackDef('annotation');
    const style = annotationTrack?.style || {};
    let splitCount = 0;
    let newAnnotations = [];
    this.subtitles.forEach(sub => {
      if ((sub.track || 'main') !== 'main') return;
      const text = sub.originalText || '';
      let annotations = [];
      let cleanedText = text;
      patterns.forEach(p => {
        const matches = text.match(p) || [];
        matches.forEach(m => {
          annotations.push(m);
          cleanedText = cleanedText.replace(m, '').trim();
        });
      });
      if (annotations.length > 0 && cleanedText) {
        sub.originalText = cleanedText;
        annotations.forEach(text => {
          newAnnotations.push({
            id: Date.now() + Math.random() + splitCount,
            startTime: sub.startTime,
            endTime: sub.endTime,
            originalText: text,
            translatedText: '',
            translationSource: null,
            track: 'annotation',
            style: { ...style },
            isLoading: false,
            parentSubtitleId: sub.id
          });
          splitCount++;
        });
      }
    });
    if (newAnnotations.length === 0) {
      VibeApp.showToast('未检测到可拆分的括号注释', 'info');
      return;
    }
    this.subtitles.push(...newAnnotations);
    this.sortSubtitles();
    this.saveSubtitles();
    this.renderTrackTabs();
    this.renderTimeline();
    VibeApp.showToast(`已拆分 ${splitCount} 条注释到「剧情注释」轨道`, 'success');
  },

  // 粘贴台词时的智能拆分
  // 输入：(完整文本)，返回：{ mainText, annotations: [] }
  smartSplitOnPaste(text) {
    if (!text) return { mainText: '', annotations: [] };
    const patterns = [
      /（[^）]*）/g,
      /\([^)]*\)/g,
      /【注：[^】]*】/g,
      /【[^】]*】/g,
      /\[[^]]*\]/g
    ];
    let mainText = text;
    const annotations = [];
    patterns.forEach(p => {
      const matches = text.match(p) || [];
      matches.forEach(m => {
        annotations.push(m);
        mainText = mainText.replace(m, '').trim();
      });
    });
    // 去除多余空格
    mainText = mainText.replace(/\s{2,}/g, ' ').trim();
    return { mainText, annotations };
  },

  // 给字幕设置轨道
  setSubtitleTrack(index, trackId) {
    if (!this.subtitles[index]) return;
    this.subtitles[index].track = trackId;
    this.saveSubtitles();
    this.renderTrackTabs();
    this.renderTimeline();
  },

  // 弹出轨道选择提示
  setSubtitleTrackPrompt(index) {
    const subtitle = this.subtitles[index];
    if (!subtitle) return;
    const currentTrack = subtitle.track || 'main';
    const options = this.trackDefinitions.map(t =>
      `<option value="${t.id}" ${t.id === currentTrack ? 'selected' : ''}>${t.icon} ${t.name}</option>`
    ).join('');

    const modal = document.createElement('div');
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 360px;">
        <button class="modal-close-btn" onclick="this.closest('.modal-overlay').remove()">✕</button>
        <h3 style="margin-bottom: 16px;">📂 切换字幕轨道</h3>
        <div class="form-group">
          <label>选择目标轨道</label>
          <select id="trackSelectPrompt" class="lang-select">${options}</select>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" onclick="
            VibeSubtitles.setSubtitleTrack(${index}, document.getElementById('trackSelectPrompt').value);
            this.closest('.modal-overlay').remove();
          ">确认</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  // 切换添加轨道菜单显示
  toggleAddTrackMenu() {
    const menu = document.getElementById('addTrackMenu');
    if (menu) {
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
  },

  // 添加字幕到指定轨道
  addSubtitleToTrack(trackId) {
    document.getElementById('addTrackMenu').style.display = 'none';

    // 自动切换到目标轨道
    this.currentTrack = trackId;
    this.renderTrackTabs();

    // 触发添加字幕流程
    if (this.markedStartTime !== null && this.markedEndTime !== null) {
      this.createSubtitleFromMarkers();
      // 设置最后一条字幕的轨道
      const last = this.subtitles[this.subtitles.length - 1];
      if (last) last.track = trackId;
      this.saveSubtitles();
      this.renderTimeline();
    } else {
      // 没有标记时间，打开添加字幕弹窗
      this.openAddSubtitleModal(trackId);
    }
  },

  // 打开添加字幕弹窗（带轨道）
  openAddSubtitleModal(trackId) {
    let modal = document.getElementById('addSubtitleModal');
    if (modal) {
      // 设置轨道选择器
      const trackSelect = document.getElementById('addSubtitleTrack');
      if (trackSelect) trackSelect.value = trackId;
      modal.classList.add('show');
    } else {
      // 兼容：如果没有弹窗，直接添加空字幕
      const video = document.getElementById('subtitleVideo');
      const startTime = video ? video.currentTime : 0;
      const newSubtitle = {
        id: Date.now(),
        startTime: startTime,
        endTime: startTime + 2,
        originalText: '',
        translatedText: '',
        translationSource: null,
        style: null,
        isLoading: false,
        track: trackId
      };
      this.subtitles.push(newSubtitle);
      this.saveSubtitles();
      this.renderTrackTabs();
      this.renderTimeline();
      VibeApp.showToast(`已添加到「${this.trackDefinitions.find(t => t.id === trackId)?.name}」轨道`, 'success');
    }
  },

  // 批量设置轨道
  batchSetTrack(trackId) {
    if (this.selectedIndices.length === 0) {
      VibeApp.showToast('请先选择字幕', 'info');
      return;
    }
    this.selectedIndices.forEach(idx => {
      if (this.subtitles[idx]) {
        this.subtitles[idx].track = trackId;
      }
    });
    this.saveSubtitles();
    this.renderTrackTabs();
    this.renderTimeline();
    VibeApp.showToast(`已移动 ${this.selectedIndices.length} 条字幕到「${this.trackDefinitions.find(t => t.id === trackId)?.name || trackId}」`, 'success');
  },
  
  // 初始化拖拽上传
  initDragAndDrop() {
    const overlay = document.createElement('div');
    overlay.className = 'drag-overlay';
    overlay.innerHTML = `
      <div class="drag-overlay-icon">📁</div>
      <div class="drag-overlay-text">释放文件即可导入</div>
    `;
    document.body.appendChild(overlay);

    const handleDragOver = (e) => {
      e.preventDefault();
      overlay.classList.add('active');
    };

    const handleDragLeave = (e) => {
      e.preventDefault();
      overlay.classList.remove('active');
    };

    const handleDrop = (e) => {
      e.preventDefault();
      overlay.classList.remove('active');
      
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = file.name.toLowerCase();
        
        if (name.endsWith('.mp4') || name.endsWith('.mkv') || name.endsWith('.avi') || name.endsWith('.mov') || name.endsWith('.webm')) {
          this.importVideo(file);
        } else if (name.endsWith('.srt') || name.endsWith('.vtt') || name.endsWith('.ass')) {
          this.importSubtitles(file);
        }
      }
    };

    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
  },

  // 初始化快捷键
  initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const target = e.target;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      
      if (isInput && !e.ctrlKey && !e.metaKey) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          this.togglePlay();
          break;
        case 'ArrowLeft':
          if (e.ctrlKey) {
            e.preventDefault();
            this.seek(-0.1);
          } else {
            e.preventDefault();
            this.seek(-0.5);
          }
          break;
        case 'ArrowRight':
          if (e.ctrlKey) {
            e.preventDefault();
            this.seek(0.1);
          } else {
            e.preventDefault();
            this.seek(0.5);
          }
          break;
        case 'F8':
          e.preventDefault();
          this.markStartTime();
          break;
        case 'F9':
          e.preventDefault();
          this.markEndTime();
          break;
        case 'Enter':
          if (!isInput) {
            e.preventDefault();
            this.createSubtitleFromMarkers();
          }
          break;
        case 'KeyZ':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            VibeUndo.undo();
          }
          break;
        case 'KeyY':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            VibeUndo.redo();
          }
          break;
        case 'KeyD':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this.splitCurrentSubtitle();
          }
          break;
        case 'Delete':
          if (!isInput) {
            e.preventDefault();
            this.deleteSelectedSubtitles();
          }
          break;

        // ===== 字幕对齐快捷键（Alt 组合）=====
        // 水平：左/中/右
        case 'ArrowLeft':
          if (e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.alignSubtitle('h-left');
          }
          break;
        case 'ArrowRight':
          if (e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.alignSubtitle('h-right');
          }
          break;
        case 'KeyH':
          if (e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.alignSubtitle('h-center');
          }
          break;
        // 垂直：上/中/下
        case 'ArrowUp':
          if (e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.alignSubtitle('v-top');
          }
          break;
        case 'ArrowDown':
          if (e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.alignSubtitle('v-bottom');
          }
          break;
        case 'KeyV':
          if (e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.alignSubtitle('v-middle');
          }
          break;
      }
    });
  },

  /**
   * 对齐当前选中字幕（或全局样式）
   * @param {string} type - h-left/h-center/h-right/v-top/v-middle/v-bottom
   */
  alignSubtitle(type) {
    // 水平位置映射
    const hMap = { 'h-left': 10, 'h-center': 50, 'h-right': 90 };
    // 垂直位置映射（position 是从底部算的百分比）
    const vMap = { 'v-top': 92, 'v-middle': 50, 'v-bottom': 8 };

    const labelMap = {
      'h-left': '左对齐', 'h-center': '水平居中', 'h-right': '右对齐',
      'v-top': '上对齐', 'v-middle': '垂直居中', 'v-bottom': '下对齐'
    };

    // 如果选中了字幕，则修改单条字幕样式；否则修改全局样式
    if (this.selectedSubtitleIndex >= 0 && this.subtitles[this.selectedSubtitleIndex]) {
      const subtitle = this.subtitles[this.selectedSubtitleIndex];
      if (!subtitle.style) subtitle.style = {};
      if (type.startsWith('h-')) {
        subtitle.style.horizontalPosition = hMap[type];
      } else {
        subtitle.style.position = vMap[type];
      }
      this.renderTimeline();
      this.updateSubtitleOverlay();
      this.saveSubtitles();
      VibeApp.showToast(`#${this.selectedSubtitleIndex + 1} ${labelMap[type]}`, 'info');
    } else {
      // 修改全局样式
      if (type.startsWith('h-')) {
        this.updateStyleSetting('horizontalPosition', hMap[type]);
        document.getElementById('horizontalPositionValue').textContent = hMap[type] + '%';
        const slider = document.getElementById('subtitleHorizontalPosition');
        if (slider) slider.value = hMap[type];
      } else {
        this.updateStyleSetting('position', vMap[type]);
        document.getElementById('positionValue').textContent = vMap[type] + '%';
        const slider = document.getElementById('subtitlePosition');
        if (slider) slider.value = vMap[type];
      }
      VibeApp.showToast(`全局${labelMap[type]}`, 'info');
    }
  },

  initWaveform() {
    VibeAudioManager.showWaveformPlaceholder();
  },

  onWaveformReady() {
    const ws = VibeAudioManager.wavesurfer;
    const container = document.getElementById('waveform');
    if (!ws || !container) return;
    
    container.addEventListener('click', (e) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = ws.getDuration() * (x / rect.width);
      
      if (e.button === 0) {
        this.markStartTime(time);
        this.updateWaveformMarkers();
      } else if (e.button === 2) {
        this.markEndTime(time);
        this.updateWaveformMarkers();
      }
      
      e.stopPropagation();
    });
    
    container.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    
    ws.on('timeupdate', (currentTime) => {
      if (VibeSubtitles && VibeSubtitles.videoElement) {
        const video = VibeSubtitles.videoElement;
        if (Math.abs(video.currentTime - currentTime) > 0.1) {
          video.currentTime = currentTime;
        }
      }
    });
    
    ws.on('region-created', (region) => {
      region.color = 'rgba(37, 99, 235, 0.2)';
    });
  },
  
  // 更新波形标记线
  updateWaveformMarkers() {
    const ws = VibeAudioManager.wavesurfer;
    if (!ws) return;
    
    const regions = ws.getPlugin('regions');
    if (!regions) return;
    
    regions.clearRegions();
    
    if (this.markedStartTime !== null && this.markedEndTime !== null) {
      const start = Math.min(this.markedStartTime, this.markedEndTime);
      const end = Math.max(this.markedStartTime, this.markedEndTime);
      
      regions.addRegion({
        start: start,
        end: end,
        color: 'rgba(34, 197, 94, 0.3)',
        drag: true,
        resize: true,
        onUpdate: (region) => {
          if (this.markedStartTime !== null && this.markedEndTime !== null) {
            if (region.start < region.end) {
              this.markedStartTime = region.start;
              this.markedEndTime = region.end;
            } else {
              this.markedStartTime = region.end;
              this.markedEndTime = region.start;
            }
            document.getElementById('markedStartTime').textContent = this.formatTime(this.markedStartTime);
            document.getElementById('markedEndTime').textContent = this.formatTime(this.markedEndTime);
            this.updateAddButtonState();
          }
        }
      });
    } else if (this.markedStartTime !== null) {
      regions.addRegion({
        start: this.markedStartTime,
        end: this.markedStartTime + 0.1,
        color: 'rgba(239, 68, 68, 0.4)',
        drag: true,
        resize: false,
        onUpdate: (region) => {
          this.markedStartTime = region.start;
          document.getElementById('markedStartTime').textContent = this.formatTime(this.markedStartTime);
          this.updateAddButtonState();
        }
      });
    } else if (this.markedEndTime !== null) {
      regions.addRegion({
        start: this.markedEndTime - 0.1,
        end: this.markedEndTime,
        color: 'rgba(59, 130, 246, 0.4)',
        drag: true,
        resize: false,
        onUpdate: (region) => {
          this.markedEndTime = region.end;
          document.getElementById('markedEndTime').textContent = this.formatTime(this.markedEndTime);
          this.updateAddButtonState();
        }
      });
    }
    
    this.highlightSubtitleRegion();
  },
  
  // 高亮当前选中字幕的波形区域
  highlightSubtitleRegion() {
    const ws = VibeAudioManager.wavesurfer;
    if (!ws) return;
    
    const regions = ws.getPlugin('regions');
    if (!regions) return;
    
    const regionList = regions.getRegions();
    const existingRegion = regionList.find(r => r.id !== 'subtitle-highlight');
    
    if (this.selectedSubtitleIndex >= 0 && this.selectedSubtitleIndex < this.subtitles.length) {
      const subtitle = this.subtitles[this.selectedSubtitleIndex];
      
      const highlightRegion = regionList.find(r => r.id === 'subtitle-highlight');
      if (highlightRegion) {
        highlightRegion.remove();
      }
      
      regions.addRegion({
        id: 'subtitle-highlight',
        start: subtitle.startTime,
        end: subtitle.endTime,
        color: 'rgba(22, 93, 255, 0.15)',
        drag: false,
        resize: false,
        clickable: false
      });
    }
  },

  // 绑定事件
  bindEvents() {
    // 显示模式切换（双语/原文/译文）
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = e.target.dataset.mode;
        if (mode) {
          this.setDisplayMode(mode);
        }
      });
    });
    
    // 视图模式切换（列表/对照编辑）
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const view = e.target.dataset.view;
        if (view) {
          this.switchSubtitleView(view);
        }
      });
    });
    
    // 时间轴显示模式切换（双语/源语/译语）
    document.querySelectorAll('.timeline-display-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const display = e.target.dataset.display;
        if (display) {
          this.setTimelineDisplayMode(display);
        }
      });
    });
    
    // 视频导入
    document.getElementById('videoFileInput').addEventListener('change', (e) => {
      this.importVideo(e.target.files[0]);
    });
    
    // 视频大小切换
    document.querySelectorAll('.size-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        const videoWrapper = document.getElementById('videoWrapper');
        videoWrapper.classList.remove('small', 'medium', 'large', 'full');
        videoWrapper.classList.add(e.target.dataset.size);
      });
    });

    // 视频倍速控制
    const speedSelect = document.getElementById('videoSpeedSelect');
    if (speedSelect) {
      speedSelect.addEventListener('change', (e) => {
        const video = document.getElementById('subtitleVideo');
        if (video) {
          video.playbackRate = parseFloat(e.target.value);
          if (typeof VibeAudioManager !== 'undefined' && VibeAudioManager.wavesurfer) {
            VibeAudioManager.wavesurfer.setPlaybackRate(video.playbackRate, false);
          }
        }
      });
    }
    
    // 字幕导入
    document.getElementById('subtitleFileInput').addEventListener('change', (e) => {
      this.importSubtitles(e.target.files[0]);
    });
    
    // 标记开始时间
    document.getElementById('markStart').addEventListener('click', () => {
      this.markStartTime();
    });
    
    // 标记结束时间
    document.getElementById('markEnd').addEventListener('click', () => {
      this.markEndTime();
    });
    
    // 添加字幕按钮
    document.getElementById('addSubtitleBtn').addEventListener('click', () => {
      this.openAddModal();
    });
    
    // 批量翻译
    document.getElementById('batchTranslate').addEventListener('click', () => {
      this.batchTranslate();
    });

    // 字幕列表中的批量翻译按钮
    const batchTranslateListBtn = document.getElementById('batchTranslateList');
    if (batchTranslateListBtn) {
      batchTranslateListBtn.addEventListener('click', () => {
        this.batchTranslate();
      });
    }

    // 字幕翻译语言选择
    const subtitleSourceLang = document.getElementById('subtitleSourceLang');
    if (subtitleSourceLang) {
      subtitleSourceLang.addEventListener('change', (e) => {
        this.sourceLanguage = e.target.value;
      });
    }

    const subtitleTargetLang = document.getElementById('subtitleTargetLang');
    if (subtitleTargetLang) {
      subtitleTargetLang.addEventListener('change', (e) => {
        this.targetLanguage = e.target.value;
      });
    }
    
    // 导出字幕下拉菜单
    document.getElementById('exportDropdown').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('exportDropdown').parentElement.classList.toggle('open');
    });
    
    document.addEventListener('click', () => {
      document.getElementById('exportDropdown')?.parentElement.classList.remove('open');
    });
    
    // 识别参数面板切换
    const toggleBtn = document.getElementById('toggleRecognitionParams');
    const paramsPanel = document.getElementById('recognitionParamsPanel');
    if (toggleBtn && paramsPanel) {
      // 确保初始为隐藏状态
      paramsPanel.style.display = 'none';
      toggleBtn.innerHTML = '⚙ 参数';
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = paramsPanel.style.display === 'none' ||
                         window.getComputedStyle(paramsPanel).display === 'none';
        paramsPanel.style.display = isHidden ? 'block' : 'none';
        toggleBtn.classList.toggle('active', isHidden);
        toggleBtn.innerHTML = isHidden ? '⚙ 参数 ▲' : '⚙ 参数';
      });
    }
    
    // 参数滑块值显示更新
    const temperatureSlider = document.getElementById('recognizeTemperature');
    const temperatureValue = document.getElementById('temperatureValue');
    if (temperatureSlider && temperatureValue) {
      temperatureSlider.addEventListener('input', (e) => {
        temperatureValue.textContent = e.target.value;
      });
    }
    
    const beamSlider = document.getElementById('recognizeBeamSize');
    const beamValue = document.getElementById('beamSizeValue');
    if (beamSlider && beamValue) {
      beamSlider.addEventListener('input', (e) => {
        beamValue.textContent = e.target.value;
      });
    }
    
    const penaltySlider = document.getElementById('recognizeRepetitionPenalty');
    const penaltyValue = document.getElementById('repetitionPenaltyValue');
    if (penaltySlider && penaltyValue) {
      penaltySlider.addEventListener('input', (e) => {
        penaltyValue.textContent = e.target.value;
      });
    }
    
    // 导入字幕文件
    document.getElementById('subtitleFileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.importSubtitleFile(file);
      }
    });
    
    // 导入项目文件
    document.getElementById('projectFileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.openProject(file);
      }
    });
    
    // 提取音频并渲染波形
    document.getElementById('autoGenerateBtn').addEventListener('click', () => {
      this.autoGenerateSubtitles();
    });
    
    // 识别区间语音
    document.getElementById('recognizeSegmentBtn').addEventListener('click', () => {
      this.recognizeSegment();
    });
    
    // 全局样式开关
    document.getElementById('globalStyleSwitch').addEventListener('change', (e) => {
      this.toggleGlobalStyle(e.target.checked);
    });
    
    // 视频timeupdate事件
    const video = document.getElementById('subtitleVideo');
    video.addEventListener('timeupdate', () => {
      this.onVideoTimeUpdate(video.currentTime);
    });
    
    // 样式设置事件
    this.bindStyleEvents();
  },
  
  // 绑定样式设置事件
  bindStyleEvents() {
    // 垂直位置
    document.getElementById('subtitlePosition').addEventListener('input', (e) => {
      this.updateStyleSetting('position', e.target.value);
      document.getElementById('positionValue').textContent = e.target.value + '%';
    });
    
    // 水平位置
    document.getElementById('subtitleHorizontalPosition').addEventListener('input', (e) => {
      this.updateStyleSetting('horizontalPosition', e.target.value);
      document.getElementById('horizontalPositionValue').textContent = e.target.value + '%';
    });
    
    // 原文字号
    document.getElementById('originalFontSize').addEventListener('input', (e) => {
      this.updateStyleSetting('originalFontSize', e.target.value);
      document.getElementById('originalSizeValue').textContent = e.target.value + 'px';
    });
    
    // 译文字号
    document.getElementById('translatedFontSize').addEventListener('input', (e) => {
      this.updateStyleSetting('translatedFontSize', e.target.value);
      document.getElementById('translatedSizeValue').textContent = e.target.value + 'px';
    });
    
    // 原文颜色
    document.getElementById('originalColor').addEventListener('input', (e) => {
      this.updateStyleSetting('originalColor', e.target.value);
    });
    
    // 译文颜色
    document.getElementById('translatedColor').addEventListener('input', (e) => {
      this.updateStyleSetting('translatedColor', e.target.value);
    });
    
    // 原文垂直偏移
    document.getElementById('originalVerticalOffset').addEventListener('input', (e) => {
      this.updateStyleSetting('originalVerticalOffset', e.target.value);
      document.getElementById('originalVerticalOffsetValue').textContent = e.target.value + 'px';
      const syncCheckbox = document.getElementById('syncVerticalOffset');
      if (syncCheckbox && syncCheckbox.checked) {
        this.updateStyleSetting('translatedVerticalOffset', e.target.value);
        document.getElementById('translatedVerticalOffset').value = e.target.value;
        document.getElementById('translatedVerticalOffsetValue').textContent = e.target.value + 'px';
      }
    });
    
    // 译文垂直偏移
    document.getElementById('translatedVerticalOffset').addEventListener('input', (e) => {
      this.updateStyleSetting('translatedVerticalOffset', e.target.value);
      document.getElementById('translatedVerticalOffsetValue').textContent = e.target.value + 'px';
      const syncCheckbox = document.getElementById('syncVerticalOffset');
      if (syncCheckbox && syncCheckbox.checked) {
        this.updateStyleSetting('originalVerticalOffset', e.target.value);
        document.getElementById('originalVerticalOffset').value = e.target.value;
        document.getElementById('originalVerticalOffsetValue').textContent = e.target.value + 'px';
      }
    });
    
    // 原文字体
    document.getElementById('originalFontFamily').addEventListener('change', (e) => {
      this.updateStyleSetting('originalFontFamily', e.target.value);
      const syncCheckbox = document.getElementById('syncFontFamily');
      if (syncCheckbox && syncCheckbox.checked) {
        this.updateStyleSetting('translatedFontFamily', e.target.value);
        document.getElementById('translatedFontFamily').value = e.target.value;
      }
    });
    
    // 译文字体
    document.getElementById('translatedFontFamily').addEventListener('change', (e) => {
      this.updateStyleSetting('translatedFontFamily', e.target.value);
      const syncCheckbox = document.getElementById('syncFontFamily');
      if (syncCheckbox && syncCheckbox.checked) {
        this.updateStyleSetting('originalFontFamily', e.target.value);
        document.getElementById('originalFontFamily').value = e.target.value;
      }
    });
    
    // 原文水平偏移
    const origHOffset = document.getElementById('originalHorizontalOffset');
    if (origHOffset) origHOffset.addEventListener('input', (e) => {
      this.updateStyleSetting('originalHorizontalOffset', parseInt(e.target.value));
      document.getElementById('originalHorizontalOffsetValue').textContent = e.target.value + 'px';
      const syncCheckbox = document.getElementById('syncHorizontalOffset');
      if (syncCheckbox && syncCheckbox.checked) {
        this.updateStyleSetting('translatedHorizontalOffset', parseInt(e.target.value));
        document.getElementById('translatedHorizontalOffset').value = e.target.value;
        document.getElementById('translatedHorizontalOffsetValue').textContent = e.target.value + 'px';
      }
    });
    
    // 译文水平偏移
    const transHOffset = document.getElementById('translatedHorizontalOffset');
    if (transHOffset) transHOffset.addEventListener('input', (e) => {
      this.updateStyleSetting('translatedHorizontalOffset', parseInt(e.target.value));
      document.getElementById('translatedHorizontalOffsetValue').textContent = e.target.value + 'px';
      const syncCheckbox = document.getElementById('syncHorizontalOffset');
      if (syncCheckbox && syncCheckbox.checked) {
        this.updateStyleSetting('originalHorizontalOffset', parseInt(e.target.value));
        document.getElementById('originalHorizontalOffset').value = e.target.value;
        document.getElementById('originalHorizontalOffsetValue').textContent = e.target.value + 'px';
      }
    });
    
    // 文字排版方向
    const textDir = document.getElementById('textDirection');
    if (textDir) textDir.addEventListener('change', (e) => {
      this.updateStyleSetting('textDirection', e.target.value);
    });
    
    // 字符样式设置
    const charColor = document.getElementById('charColor');
    if (charColor) charColor.addEventListener('input', () => {
      this.applyCharStyleFromSettings();
    });
    
    const charFontSize = document.getElementById('charFontSize');
    if (charFontSize) {
      charFontSize.addEventListener('input', (e) => {
        document.getElementById('charFontSizeValue').textContent = e.target.value + 'px';
        this.applyCharStyleFromSettings();
      });
    }
    
    const charBold = document.getElementById('charBold');
    if (charBold) charBold.addEventListener('change', () => {
      this.applyCharStyleFromSettings();
    });
    
    // 对照编辑字符样式设置
    const dualEditCharColor = document.getElementById('dualEditCharColor');
    if (dualEditCharColor) dualEditCharColor.addEventListener('input', () => {
      this.dualEditApplyCharStyle();
    });
    
    const dualEditCharFontSize = document.getElementById('dualEditCharFontSize');
    if (dualEditCharFontSize) {
      dualEditCharFontSize.addEventListener('input', (e) => {
        document.getElementById('dualEditCharFontSizeValue').textContent = e.target.value + 'px';
        this.dualEditApplyCharStyle();
      });
    }
    
    const dualEditCharBold = document.getElementById('dualEditCharBold');
    if (dualEditCharBold) dualEditCharBold.addEventListener('change', () => {
      this.dualEditApplyCharStyle();
    });
    
    // 字符选择标签切换
    document.querySelectorAll('.char-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.char-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const type = tab.dataset.type;
        document.getElementById('charDisplayOriginal').style.display = type === 'original' ? 'flex' : 'none';
        document.getElementById('charDisplayTranslated').style.display = type === 'translated' ? 'flex' : 'none';
        this.selectedChar.textType = type;
      });
    });
    
    // 原文字间距
    const origLetterSpacing = document.getElementById('originalLetterSpacing');
    if (origLetterSpacing) origLetterSpacing.addEventListener('input', (e) => {
      this.updateStyleSetting('originalLetterSpacing', parseInt(e.target.value));
      document.getElementById('originalLetterSpacingValue').textContent = e.target.value + 'px';
      const syncCheckbox = document.getElementById('syncLetterSpacing');
      if (syncCheckbox && syncCheckbox.checked) {
        this.updateStyleSetting('translatedLetterSpacing', parseInt(e.target.value));
        document.getElementById('translatedLetterSpacing').value = e.target.value;
        document.getElementById('translatedLetterSpacingValue').textContent = e.target.value + 'px';
      }
    });
    
    // 译文字间距
    const transLetterSpacing = document.getElementById('translatedLetterSpacing');
    if (transLetterSpacing) transLetterSpacing.addEventListener('input', (e) => {
      this.updateStyleSetting('translatedLetterSpacing', parseInt(e.target.value));
      document.getElementById('translatedLetterSpacingValue').textContent = e.target.value + 'px';
      const syncCheckbox = document.getElementById('syncLetterSpacing');
      if (syncCheckbox && syncCheckbox.checked) {
        this.updateStyleSetting('originalLetterSpacing', parseInt(e.target.value));
        document.getElementById('originalLetterSpacing').value = e.target.value;
        document.getElementById('originalLetterSpacingValue').textContent = e.target.value + 'px';
      }
    });
    
    // 全局显示模式
    document.querySelectorAll('input[name="globalDisplayMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.updateStyleSetting('globalDisplayMode', e.target.value);
      });
    });

    // 描边颜色
    const strokeColor = document.getElementById('strokeColor');
    if (strokeColor) strokeColor.addEventListener('input', (e) => {
      this.updateStyleSetting('strokeColor', e.target.value);
    });

    // 描边宽度
    const strokeWidth = document.getElementById('strokeWidth');
    if (strokeWidth) strokeWidth.addEventListener('input', (e) => {
      this.updateStyleSetting('strokeWidth', parseInt(e.target.value));
      document.getElementById('strokeWidthValue').textContent = e.target.value + 'px';
    });

    // 阴影颜色
    const shadowColor = document.getElementById('shadowColor');
    if (shadowColor) shadowColor.addEventListener('input', (e) => {
      this.updateStyleSetting('shadowColor', e.target.value);
    });

    // 阴影偏移
    const shadowOffset = document.getElementById('shadowOffset');
    if (shadowOffset) shadowOffset.addEventListener('input', (e) => {
      this.updateStyleSetting('shadowOffset', parseInt(e.target.value));
      document.getElementById('shadowOffsetValue').textContent = e.target.value + 'px';
    });

    // 阴影模糊
    const shadowBlur = document.getElementById('shadowBlur');
    if (shadowBlur) shadowBlur.addEventListener('input', (e) => {
      this.updateStyleSetting('shadowBlur', parseInt(e.target.value));
      document.getElementById('shadowBlurValue').textContent = e.target.value + 'px';
    });

    // 使用渐变
    const useGradient = document.getElementById('useGradient');
    if (useGradient) useGradient.addEventListener('change', (e) => {
      this.updateStyleSetting('useGradient', e.target.checked);
    });

    // 渐变起始色
    const gradientStart = document.getElementById('gradientStart');
    if (gradientStart) gradientStart.addEventListener('input', (e) => {
      this.updateStyleSetting('gradientStart', e.target.value);
    });

    // 渐变结束色
    const gradientEnd = document.getElementById('gradientEnd');
    if (gradientEnd) gradientEnd.addEventListener('input', (e) => {
      this.updateStyleSetting('gradientEnd', e.target.value);
    });

    // 渐变方向
    const gradientDirection = document.getElementById('gradientDirection');
    if (gradientDirection) gradientDirection.addEventListener('change', (e) => {
      this.updateStyleSetting('gradientDirection', e.target.value);
    });

    // 滚动模式
    const scrollMode = document.getElementById('scrollMode');
    if (scrollMode) scrollMode.addEventListener('change', (e) => {
      this.updateStyleSetting('scrollMode', e.target.value);
    });

    // 滚动速度
    const scrollSpeed = document.getElementById('scrollSpeed');
    if (scrollSpeed) scrollSpeed.addEventListener('input', (e) => {
      this.updateStyleSetting('scrollSpeed', parseInt(e.target.value));
      document.getElementById('scrollSpeedValue').textContent = e.target.value;
    });

    // 背景透明度
    const bgOpacity = document.getElementById('bgOpacity');
    if (bgOpacity) bgOpacity.addEventListener('input', (e) => {
      this.updateStyleSetting('bgOpacity', parseInt(e.target.value));
      document.getElementById('bgOpacityValue').textContent = e.target.value + '%';
    });

    // 背景颜色
    const bgColor = document.getElementById('bgColor');
    if (bgColor) bgColor.addEventListener('input', (e) => {
      this.updateStyleSetting('bgColor', e.target.value);
    });

    // 字间距
    const letterSpacing = document.getElementById('letterSpacing');
    if (letterSpacing) letterSpacing.addEventListener('input', (e) => {
      this.updateStyleSetting('letterSpacing', parseInt(e.target.value));
      document.getElementById('letterSpacingValue').textContent = e.target.value + 'px';
    });

    // 行间距
    const lineHeight = document.getElementById('lineHeight');
    if (lineHeight) lineHeight.addEventListener('input', (e) => {
      this.updateStyleSetting('lineHeight', parseInt(e.target.value));
      document.getElementById('lineHeightValue').textContent = e.target.value + 'px';
    });

    // 卡拉OK启用
    const karaokeEnabled = document.getElementById('karaokeEnabled');
    if (karaokeEnabled) karaokeEnabled.addEventListener('change', (e) => {
      this.updateStyleSetting('karaokeEnabled', e.target.checked);
      if (e.target.checked) {
        // 启用卡拉OK时，如果没有逐字时间轴数据，自动生成
        const hasNoData = this.subtitles.some(s => !s.karaokeData);
        if (hasNoData && this.subtitles.length > 0) {
          this.autoGenerateKaraoke();
        }
        this.applyKaraokeStyles();
      }
    });

    // 卡拉OK高亮色
    const karaokeColor = document.getElementById('karaokeColor');
    if (karaokeColor) karaokeColor.addEventListener('input', (e) => {
      this.updateStyleSetting('karaokeColor', e.target.value);
      this.applyKaraokeStyles();
    });

    // 卡拉OK未高亮色
    const karaokeDimColor = document.getElementById('karaokeDimColor');
    if (karaokeDimColor) karaokeDimColor.addEventListener('input', (e) => {
      this.updateStyleSetting('karaokeDimColor', e.target.value);
      this.applyKaraokeStyles();
    });

    // 卡拉OK动画类型
    const karaokeAnimation = document.getElementById('karaokeAnimation');
    if (karaokeAnimation) karaokeAnimation.addEventListener('change', (e) => {
      this.updateStyleSetting('karaokeAnimation', e.target.value);
      this.applyKaraokeStyles();
    });

    // 卡拉OK动画速度
    const karaokeSpeed = document.getElementById('karaokeSpeed');
    if (karaokeSpeed) karaokeSpeed.addEventListener('input', (e) => {
      this.updateStyleSetting('karaokeSpeed', parseInt(e.target.value));
      document.getElementById('karaokeSpeedValue').textContent = e.target.value;
    });
  },
  
  // 切换全局/单条样式模式
  toggleGlobalStyle(isGlobal) {
    this.isGlobalStyle = isGlobal;
    
    const modeText = document.getElementById('styleModeText');
    const editHint = document.getElementById('styleEditHint');
    const icons = document.querySelectorAll('.style-icon');
    
    if (isGlobal) {
      modeText.textContent = '🌐 全局统一样式';
      editHint.style.display = 'none';
      icons.forEach(icon => icon.textContent = '🌐');
      
      // 更新面板显示全局样式值
      this.applyStyleSettingsToPanel(this.globalStyleSettings);
    } else {
      modeText.textContent = '📝 单条样式编辑';
      icons.forEach(icon => icon.textContent = '📝');
      
      // 检查是否有选中的字幕
      if (this.selectedSubtitleIndex >= 0 && this.selectedSubtitleIndex < this.subtitles.length) {
        editHint.style.display = 'block';
        document.getElementById('editingSubtitleIndex').textContent = this.selectedSubtitleIndex + 1;
        
        // 显示选中字幕的样式（如果有的话）
        const subtitle = this.subtitles[this.selectedSubtitleIndex];
        const style = subtitle.style || this.globalStyleSettings;
        this.applyStyleSettingsToPanel(style);
      } else {
        editHint.style.display = 'block';
        document.getElementById('editingSubtitleIndex').textContent = '-';
        VibeApp.showToast('请先在时间轴中点击选择一条字幕', 'info');
      }
    }
    
    this.saveStyleSettings();
  },
  
  // 更新样式设置
  updateStyleSetting(key, value) {
    if (this.isGlobalStyle) {
      // 更新全局样式
      this.globalStyleSettings[key] = value;
      this.saveStyleSettings();
      
      // 更新叠加层（使用全局样式）
      if (this.currentSubtitleIndex >= 0) {
        this.showOverlay(this.subtitles[this.currentSubtitleIndex]);
      }
    } else {
      // 更新单条字幕样式
      if (this.selectedSubtitleIndex >= 0 && this.selectedSubtitleIndex < this.subtitles.length) {
        const subtitle = this.subtitles[this.selectedSubtitleIndex];
        
        // 如果字幕还没有独立样式，从当前全局样式复制一份
        if (!subtitle.style) {
          subtitle.style = { ...this.globalStyleSettings };
        }
        
        subtitle.style[key] = value;
        
        // 如果当前播放的是这条字幕，立即更新叠加层
        if (this.currentSubtitleIndex === this.selectedSubtitleIndex) {
          this.showOverlay(subtitle);
        }
        
        // 更新时间轴显示
        this.renderTimeline();
      }
    }
  },
  
  // 将样式设置应用到面板
  applyStyleSettingsToPanel(style) {
    document.getElementById('subtitlePosition').value = style.position;
    document.getElementById('positionValue').textContent = style.position + '%';
    
    document.getElementById('subtitleHorizontalPosition').value = style.horizontalPosition;
    document.getElementById('horizontalPositionValue').textContent = style.horizontalPosition + '%';
    
    document.getElementById('originalFontSize').value = style.originalFontSize;
    document.getElementById('originalSizeValue').textContent = style.originalFontSize + 'px';
    
    document.getElementById('translatedFontSize').value = style.translatedFontSize;
    document.getElementById('translatedSizeValue').textContent = style.translatedFontSize + 'px';
    
    document.getElementById('originalColor').value = style.originalColor;
    document.getElementById('translatedColor').value = style.translatedColor;
    
    document.getElementById('originalFontFamily').value = style.originalFontFamily || style.fontFamily;
    document.getElementById('translatedFontFamily').value = style.translatedFontFamily || style.fontFamily;
    
    const origHOffsetEl = document.getElementById('originalHorizontalOffset');
    if (origHOffsetEl) {
      origHOffsetEl.value = style.originalHorizontalOffset || 0;
      const origHOffsetVal = document.getElementById('originalHorizontalOffsetValue');
      if (origHOffsetVal) origHOffsetVal.textContent = (style.originalHorizontalOffset || 0) + 'px';
    }
    const transHOffsetEl = document.getElementById('translatedHorizontalOffset');
    if (transHOffsetEl) {
      transHOffsetEl.value = style.translatedHorizontalOffset || 0;
      const transHOffsetVal = document.getElementById('translatedHorizontalOffsetValue');
      if (transHOffsetVal) transHOffsetVal.textContent = (style.translatedHorizontalOffset || 0) + 'px';
    }
    
    const origLetterSpacingEl = document.getElementById('originalLetterSpacing');
    if (origLetterSpacingEl) {
      origLetterSpacingEl.value = style.originalLetterSpacing || 0;
      const origLetterSpacingVal = document.getElementById('originalLetterSpacingValue');
      if (origLetterSpacingVal) origLetterSpacingVal.textContent = (style.originalLetterSpacing || 0) + 'px';
    }
    const transLetterSpacingEl = document.getElementById('translatedLetterSpacing');
    if (transLetterSpacingEl) {
      transLetterSpacingEl.value = style.translatedLetterSpacing || 0;
      const transLetterSpacingVal = document.getElementById('translatedLetterSpacingValue');
      if (transLetterSpacingVal) transLetterSpacingVal.textContent = (style.translatedLetterSpacing || 0) + 'px';
    }
    
    const textDirEl = document.getElementById('textDirection');
    if (textDirEl) textDirEl.value = style.textDirection || 'horizontal';

    // 高级美化设置
    const strokeColor = document.getElementById('strokeColor');
    if (strokeColor) strokeColor.value = style.strokeColor || '#000000';
    const strokeWidth = document.getElementById('strokeWidth');
    if (strokeWidth) {
      strokeWidth.value = style.strokeWidth || 0;
      document.getElementById('strokeWidthValue').textContent = (style.strokeWidth || 0) + 'px';
    }

    const shadowColor = document.getElementById('shadowColor');
    if (shadowColor) shadowColor.value = style.shadowColor || '#000000';
    const shadowOffset = document.getElementById('shadowOffset');
    if (shadowOffset) {
      shadowOffset.value = style.shadowOffset || 2;
      document.getElementById('shadowOffsetValue').textContent = (style.shadowOffset || 2) + 'px';
    }
    const shadowBlur = document.getElementById('shadowBlur');
    if (shadowBlur) {
      shadowBlur.value = style.shadowBlur || 4;
      document.getElementById('shadowBlurValue').textContent = (style.shadowBlur || 4) + 'px';
    }

    const useGradient = document.getElementById('useGradient');
    if (useGradient) useGradient.checked = style.useGradient || false;
    const gradientStart = document.getElementById('gradientStart');
    if (gradientStart) gradientStart.value = style.gradientStart || '#ffffff';
    const gradientEnd = document.getElementById('gradientEnd');
    if (gradientEnd) gradientEnd.value = style.gradientEnd || '#a0a0ff';
    const gradientDirection = document.getElementById('gradientDirection');
    if (gradientDirection) gradientDirection.value = style.gradientDirection || 'horizontal';

    const scrollMode = document.getElementById('scrollMode');
    if (scrollMode) scrollMode.value = style.scrollMode || 'none';
    const scrollSpeed = document.getElementById('scrollSpeed');
    if (scrollSpeed) {
      scrollSpeed.value = style.scrollSpeed || 5;
      document.getElementById('scrollSpeedValue').textContent = style.scrollSpeed || 5;
    }

    const bgOpacity = document.getElementById('bgOpacity');
    if (bgOpacity) {
      bgOpacity.value = style.bgOpacity || 0;
      document.getElementById('bgOpacityValue').textContent = (style.bgOpacity || 0) + '%';
    }
    const bgColor = document.getElementById('bgColor');
    if (bgColor) bgColor.value = style.bgColor || '#000000';

    const letterSpacing = document.getElementById('letterSpacing');
    if (letterSpacing) {
      letterSpacing.value = style.letterSpacing || 0;
      document.getElementById('letterSpacingValue').textContent = (style.letterSpacing || 0) + 'px';
    }
    const lineHeight = document.getElementById('lineHeight');
    if (lineHeight) {
      lineHeight.value = style.lineHeight || 16;
      document.getElementById('lineHeightValue').textContent = (style.lineHeight || 16) + 'px';
    }

    // 卡拉OK设置
    const karaokeEnabled = document.getElementById('karaokeEnabled');
    if (karaokeEnabled) karaokeEnabled.checked = style.karaokeEnabled || false;
    const karaokeColor = document.getElementById('karaokeColor');
    if (karaokeColor) karaokeColor.value = style.karaokeColor || '#00ff00';
    const karaokeDimColor = document.getElementById('karaokeDimColor');
    if (karaokeDimColor) karaokeDimColor.value = style.karaokeDimColor || '#888888';
    const karaokeAnimation = document.getElementById('karaokeAnimation');
    if (karaokeAnimation) karaokeAnimation.value = style.karaokeAnimation || 'gradient';
    const karaokeSpeed = document.getElementById('karaokeSpeed');
    if (karaokeSpeed) {
      karaokeSpeed.value = style.karaokeSpeed || 5;
      document.getElementById('karaokeSpeedValue').textContent = style.karaokeSpeed || 5;
    }
  },
  
  // 加载样式设置
  loadStyleSettings() {
    const saved = VibeStorage.get('vibetrans_subtitle_style', null);
    if (saved) {
      this.globalStyleSettings = saved.globalStyle || saved;
      this.isGlobalStyle = saved.isGlobal !== false;
    }
    
    this.applyStyleSettingsToPanel(this.globalStyleSettings);
    
    // 设置开关状态
    document.getElementById('globalStyleSwitch').checked = this.isGlobalStyle;
    this.toggleGlobalStyle(this.isGlobalStyle);
  },
  
  // 保存样式设置
  saveStyleSettings() {
    VibeStorage.set('vibetrans_subtitle_style', {
      globalStyle: this.globalStyleSettings,
      isGlobal: this.isGlobalStyle
    });
  },
  
  // 加载样式模板
  loadStyleTemplates() {
    const saved = VibeStorage.get('vibetrans_style_templates', []);
    this.styleTemplates = saved;
    this.renderStyleTemplates();
  },
  
  // 保存样式模板
  saveStyleTemplates() {
    VibeStorage.set('vibetrans_style_templates', this.styleTemplates);
  },
  
  // 创建样式模板
  createStyleTemplate(name) {
    if (!name || !name.trim()) {
      VibeApp.showToast('请输入模板名称', 'info');
      return;
    }
    
    const template = {
      id: Date.now(),
      name: name.trim(),
      style: { ...this.globalStyleSettings }
    };
    
    this.styleTemplates.push(template);
    this.saveStyleTemplates();
    this.renderStyleTemplates();
    VibeApp.showToast(`样式模板 "${name}" 已创建`, 'success');
  },
  
  // 应用样式模板
  applyStyleTemplate(templateId, applyToAll = false) {
    const template = this.styleTemplates.find(t => t.id === templateId);
    if (!template) {
      VibeApp.showToast('模板不存在', 'error');
      return;
    }
    
    this.globalStyleSettings = { ...template.style };
    this.saveStyleSettings();
    this.applyStyleSettingsToPanel(this.globalStyleSettings);
    
    if (applyToAll) {
      this.subtitles.forEach(subtitle => {
        subtitle.style = { ...template.style };
      });
      VibeApp.showToast(`模板 "${template.name}" 已应用到全部字幕`, 'success');
    } else {
      VibeApp.showToast(`模板 "${template.name}" 已应用`, 'success');
    }
    
    if (this.currentSubtitleIndex >= 0) {
      this.showOverlay(this.subtitles[this.currentSubtitleIndex]);
    }
    this.renderTimeline();
  },
  
  // 删除样式模板
  deleteStyleTemplate(templateId) {
    const index = this.styleTemplates.findIndex(t => t.id === templateId);
    if (index === -1) {
      VibeApp.showToast('模板不存在', 'error');
      return;
    }
    
    const name = this.styleTemplates[index].name;
    this.styleTemplates.splice(index, 1);
    this.saveStyleTemplates();
    this.renderStyleTemplates();
    VibeApp.showToast(`模板 "${name}" 已删除`, 'success');
  },
  
  // 渲染带逐字样式的文本
  renderTextWithCharStyles(text, charStyles, defaultStyle) {
    if (!text) return '';
    
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const style = charStyles[i];
      
      if (style) {
        const styleStr = `font-size: ${style.fontSize || defaultStyle.fontSize}px; ` +
                         `color: ${style.color || defaultStyle.color}; ` +
                         `font-family: ${defaultStyle.fontFamily}; ` +
                         `font-weight: ${style.bold ? 'bold' : 'normal'}; ` +
                         `letter-spacing: ${defaultStyle.letterSpacing}px;`;
        result += `<span style="${styleStr}">${char}</span>`;
      } else {
        const styleStr = `font-size: ${defaultStyle.fontSize}px; ` +
                         `color: ${defaultStyle.color}; ` +
                         `font-family: ${defaultStyle.fontFamily}; ` +
                         `letter-spacing: ${defaultStyle.letterSpacing}px;`;
        result += `<span style="${styleStr}">${char}</span>`;
      }
    }
    
    return result;
  },
  
  // 设置选中字符的样式
  setCharStyle(textType, charIndex, style) {
    if (this.currentSubtitleIndex < 0) {
      VibeApp.showToast('请先选择字幕', 'info');
      return;
    }
    
    const subtitle = this.subtitles[this.currentSubtitleIndex];
    if (!subtitle.charStyles) {
      subtitle.charStyles = { original: {}, translated: {} };
    }
    
    if (!subtitle.charStyles[textType]) {
      subtitle.charStyles[textType] = {};
    }
    
    subtitle.charStyles[textType][charIndex] = { ...style };
    this.saveSubtitles();
    
    if (this.currentSubtitleIndex >= 0) {
      this.showOverlay(this.subtitles[this.currentSubtitleIndex]);
    }
    
    VibeApp.showToast('字符样式已设置', 'success');
  },
  
  // 清除字符样式
  clearCharStyles() {
    if (this.currentSubtitleIndex < 0) {
      VibeApp.showToast('请先选择字幕', 'info');
      return;
    }
    
    const subtitle = this.subtitles[this.currentSubtitleIndex];
    subtitle.charStyles = { original: {}, translated: {} };
    this.saveSubtitles();
    
    if (this.currentSubtitleIndex >= 0) {
      this.showOverlay(this.subtitles[this.currentSubtitleIndex]);
    }
    
    this.renderCharDisplay();
    VibeApp.showToast('字符样式已清除', 'success');
  },
  
  // 渲染字符选择区域
  renderCharDisplay() {
    if (this.currentSubtitleIndex < 0) {
      document.getElementById('charDisplayOriginal').innerHTML = '<p class="text-gray-500 text-sm">选择字幕查看原文字符</p>';
      document.getElementById('charDisplayTranslated').innerHTML = '<p class="text-gray-500 text-sm">选择字幕查看译文字符</p>';
      return;
    }
    
    const subtitle = this.subtitles[this.currentSubtitleIndex];
    const charStyles = subtitle.charStyles || { original: {}, translated: {} };
    
    this.renderCharRow('charDisplayOriginal', subtitle.originalText, charStyles.original, 'original');
    this.renderCharRow('charDisplayTranslated', subtitle.translatedText || '', charStyles.translated, 'translated');
  },
  
  // 渲染单行字符
  renderCharRow(containerId, text, styles, textType) {
    const container = document.getElementById(containerId);
    if (!text) {
      container.innerHTML = '<p class="text-gray-500 text-sm">暂无文字</p>';
      return;
    }
    
    container.innerHTML = text.split('').map((char, index) => {
      const style = styles[index];
      const isSelected = this.selectedChar.textType === textType && this.selectedChar.index === index;
      const charStyle = style ? 
        `color: ${style.color || '#fff'}; font-size: ${style.fontSize || 12}px; font-weight: ${style.bold ? 'bold' : 'normal'};` : 
        '';
      return `<span class="char-item ${isSelected ? 'selected' : ''}" style="${charStyle}" 
        onclick="VibeSubtitles.selectChar('${textType}', ${index})">${char}</span>`;
    }).join('');
  },
  
  // 选择字符
  selectChar(textType, index) {
    this.selectedChar = { textType, index };
    this.renderCharDisplay();
    this.applyCharStyleFromSettings();
  },
  
  // 从设置面板应用字符样式
  applyCharStyleFromSettings() {
    if (this.selectedChar.index < 0) return;
    
    const color = document.getElementById('charColor').value;
    const fontSize = parseInt(document.getElementById('charFontSize').value);
    const bold = document.getElementById('charBold').checked;
    
    this.setCharStyle(this.selectedChar.textType, this.selectedChar.index, {
      color,
      fontSize,
      bold
    });
    
    this.renderCharDisplay();
  },
  
  // 渲染样式模板列表
  renderStyleTemplates() {
    const container = document.getElementById('styleTemplatesContainer');
    if (!container) return;
    
    if (this.styleTemplates.length === 0) {
      container.innerHTML = '<p class="text-center text-gray-500 py-4">暂无样式模板，点击上方按钮创建</p>';
      return;
    }
    
    container.innerHTML = this.styleTemplates.map(template => `
      <div class="style-template-item">
        <div class="style-template-name">${template.name}</div>
        <div class="style-template-actions">
          <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.applyStyleTemplate(${template.id}, false)">应用</button>
          <button class="btn btn-primary btn-sm" onclick="VibeSubtitles.applyStyleTemplate(${template.id}, true)">应用到全部</button>
          <button class="btn btn-danger btn-sm" onclick="VibeSubtitles.deleteStyleTemplate(${template.id})">删除</button>
        </div>
      </div>
    `).join('');
  },
  
  // 应用样式到全部字幕
  applyStyleToAll() {
    if (this.subtitles.length === 0) {
      VibeApp.showToast('暂无字幕可应用', 'info');
      return;
    }
    this.subtitles.forEach(subtitle => {
      subtitle.style = { ...this.globalStyleSettings };
    });
    this.renderTimeline();
    if (this.currentSubtitleIndex >= 0) {
      this.showOverlay(this.subtitles[this.currentSubtitleIndex]);
    }
    // 创建快照
    if (typeof VibeSnapshot !== 'undefined') {
      VibeSnapshot.createSnapshot('apply_global_style', VibeSnapshot.generateDescription('apply_global_style'));
    }
    VibeApp.showToast('样式已应用到全部字幕', 'success');
  },
  
  resetPosition() {
    const defaultPosition = 10;
    const defaultHorizontalPosition = 50;
    
    document.getElementById('subtitlePosition').value = defaultPosition;
    document.getElementById('positionValue').textContent = defaultPosition + '%';
    this.updateStyleSetting('position', defaultPosition);
    
    document.getElementById('subtitleHorizontalPosition').value = defaultHorizontalPosition;
    document.getElementById('horizontalPositionValue').textContent = defaultHorizontalPosition + '%';
    this.updateStyleSetting('horizontalPosition', defaultHorizontalPosition);
    
    VibeApp.showToast('位置已重置', 'success');
  },
  
  // ===== 双栏对照编辑视图 =====
  dualEditIndex: -1,
  dualEditMode: 'sentence',
  
  dualEditPrev() {
    if (this.subtitles.length === 0) return;
    if (this.dualEditIndex <= 0) {
      this.dualEditIndex = 0;
    } else {
      this.dualEditIndex--;
    }
    this.dualEditLoad();
  },
  
  dualEditNext() {
    if (this.subtitles.length === 0) return;
    if (this.dualEditIndex >= this.subtitles.length - 1) {
      this.dualEditIndex = this.subtitles.length - 1;
    } else {
      this.dualEditIndex++;
    }
    this.dualEditLoad();
  },
  
  dualEditLoad() {
    if (this.dualEditIndex < 0 || this.dualEditIndex >= this.subtitles.length) {
      document.getElementById('dualEditOriginal').value = '';
      document.getElementById('dualEditTranslated').value = '';
      document.getElementById('dualEditInfo').textContent = '未选择字幕';
      document.getElementById('dualEditTime').textContent = '--:-- --:--';
      document.getElementById('dualEditOriginalStats').textContent = '0 字';
      document.getElementById('dualEditTranslatedStats').textContent = '0 字';
      // 清空字符面板
      const origChars = document.getElementById('dualEditOriginalChars');
      const tgtChars = document.getElementById('dualEditTranslatedChars');
      if (origChars) origChars.innerHTML = '<p class="text-gray-500 text-sm" style="padding: 20px; text-align: center; width: 100%;">请先选择字幕条目</p>';
      if (tgtChars) tgtChars.innerHTML = '<p class="text-gray-500 text-sm" style="padding: 20px; text-align: center; width: 100%;">请先选择字幕条目</p>';
      this.selectedChar = { textType: null, index: -1 };
      this.updateCharStyleHint();
      return;
    }
    const subtitle = this.subtitles[this.dualEditIndex];
    document.getElementById('dualEditOriginal').value = subtitle.originalText || '';
    document.getElementById('dualEditTranslated').value = subtitle.translatedText || '';
    document.getElementById('dualEditInfo').textContent = `第 ${this.dualEditIndex + 1} / ${this.subtitles.length} 条`;

    const startTime = this.formatTime(subtitle.startTime);
    const endTime = this.formatTime(subtitle.endTime);
    document.getElementById('dualEditTime').textContent = `${startTime} → ${endTime}`;

    this.dualEditUpdateStats();
    this.dualEditRenderChars();
  },

  setDualEditMode(mode) {
    console.log('[Subtitles] setDualEditMode:', mode, 'dualEditIndex:', this.dualEditIndex);
    this.dualEditMode = mode;

    document.getElementById('dualEditSentenceMode').classList.toggle('active', mode === 'sentence');
    document.getElementById('dualEditCharMode').classList.toggle('active', mode === 'char');

    // 句子模式：显示可编辑 textarea；单字模式：隐藏 textarea，让字符面板占满空间
    const originalTextarea = document.getElementById('dualEditOriginal');
    const translatedTextarea = document.getElementById('dualEditTranslated');
    if (originalTextarea) {
      originalTextarea.style.display = mode === 'sentence' ? 'block' : 'none';
    }
    if (translatedTextarea) {
      translatedTextarea.style.display = mode === 'sentence' ? 'block' : 'none';
    }

    document.getElementById('dualEditOriginalChars').classList.toggle('show', mode === 'char');
    document.getElementById('dualEditTranslatedChars').classList.toggle('show', mode === 'char');
    document.getElementById('dualEditCharStyles').classList.toggle('show', mode === 'char');

    // 重置已选字符
    this.selectedChar = { textType: null, index: -1 };
    this.updateCharStyleHint();

    this.dualEditRenderChars();
  },

  /**
   * 更新字符样式提示文本
   */
  updateCharStyleHint() {
    const hint = document.getElementById('dualEditCharHint');
    if (!hint) return;
    if (this.selectedChar.index < 0 || !this.selectedChar.textType) {
      hint.textContent = '💡 点击下方任意字符即可单独设置颜色、字号、加粗等样式';
      hint.style.borderLeftColor = 'var(--primary-color)';
    } else {
      const label = this.selectedChar.textType === 'original' ? '原文' : '译文';
      hint.textContent = `✏️ 已选中 ${label} 第 ${this.selectedChar.index + 1} 个字符，调整下方样式即可应用`;
      hint.style.borderLeftColor = 'var(--success-color)';
    }
  },
  
  dualEditRenderChars() {
    console.log('[Subtitles] dualEditRenderChars:', 'mode:', this.dualEditMode, 'index:', this.dualEditIndex, 'subtitles.length:', this.subtitles.length);
    
    if (this.dualEditMode !== 'char') {
      console.log('[Subtitles] Not char mode, returning');
      return;
    }
    if (this.dualEditIndex < 0 || this.dualEditIndex >= this.subtitles.length) {
      console.log('[Subtitles] Invalid index, returning');
      return;
    }
    
    const subtitle = this.subtitles[this.dualEditIndex];
    console.log('[Subtitles] subtitle:', subtitle);
    
    const charStyles = subtitle.charStyles || { original: {}, translated: {} };
    
    this.renderDualEditCharRow('dualEditOriginalChars', subtitle.originalText, charStyles.original, 'original');
    this.renderDualEditCharRow('dualEditTranslatedChars', subtitle.translatedText || '', charStyles.translated, 'translated');
  },
  
  renderDualEditCharRow(containerId, text, styles, textType) {
    const container = document.getElementById(containerId);
    console.log('[Subtitles] renderDualEditCharRow:', 'containerId:', containerId, 'container:', !!container, 'text:', text ? text.length : 0);
    
    if (!container) {
      console.error('[Subtitles] Container not found:', containerId);
      return;
    }
    
    if (!text) {
      container.innerHTML = '<p class="text-gray-500 text-sm">暂无文字</p>';
      return;
    }
    
    const chars = text.split('');
    console.log('[Subtitles] chars:', chars);
    
    container.innerHTML = chars.map((char, index) => {
      const style = styles[index];
      const charStyle = style ? 
        `color: ${style.color || '#333'}; font-size: ${style.fontSize || 14}px; font-weight: ${style.bold ? 'bold' : 'normal'};` : 
        '';
      return `<span class="dual-edit-char-item" style="${charStyle}" 
        onclick="VibeSubtitles.dualEditSelectChar('${textType}', ${index})">${char}</span>`;
    }).join('');
  },
  
  dualEditSelectChar(textType, index) {
    this.selectedChar = { textType, index };

    document.querySelectorAll('.dual-edit-char-item').forEach(el => el.classList.remove('selected'));
    const containerId = textType === 'original' ? 'dualEditOriginalChars' : 'dualEditTranslatedChars';
    const items = document.querySelectorAll(`#${containerId} .dual-edit-char-item`);
    if (items[index]) {
      items[index].classList.add('selected');
      // 滚动到选中字符可见位置
      items[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }

    this.updateCharStyleHint();

    // 若该字符已有样式，加载到控制面板
    if (this.dualEditIndex >= 0 && this.dualEditIndex < this.subtitles.length) {
      const subtitle = this.subtitles[this.dualEditIndex];
      const charStyles = subtitle.charStyles || { original: {}, translated: {} };
      const existing = (charStyles[textType] || {})[index];
      if (existing) {
        if (existing.color) document.getElementById('dualEditCharColor').value = existing.color;
        if (existing.fontSize) {
          document.getElementById('dualEditCharFontSize').value = existing.fontSize;
          document.getElementById('dualEditCharFontSizeValue').textContent = existing.fontSize + 'px';
        }
        document.getElementById('dualEditCharBold').checked = !!existing.bold;
      }
    }
  },
  
  dualEditApplyCharStyle() {
    if (this.selectedChar.index < 0) return;
    
    const color = document.getElementById('dualEditCharColor').value;
    const fontSize = parseInt(document.getElementById('dualEditCharFontSize').value);
    const bold = document.getElementById('dualEditCharBold').checked;
    
    this.setCharStyle(this.selectedChar.textType, this.selectedChar.index, {
      color,
      fontSize,
      bold
    });
    
    this.dualEditRenderChars();
  },
  
  clearDualEditCharStyles() {
    if (this.dualEditIndex < 0) {
      VibeApp.showToast('请先选择字幕', 'info');
      return;
    }
    
    const subtitle = this.subtitles[this.dualEditIndex];
    subtitle.charStyles = { original: {}, translated: {} };
    this.saveSubtitles();
    
    if (this.currentSubtitleIndex === this.dualEditIndex) {
      this.showOverlay(subtitle);
    }
    
    this.dualEditRenderChars();
    VibeApp.showToast('字符样式已清除', 'success');
  },

  dualEditJump() {
    if (this.dualEditIndex < 0 || this.dualEditIndex >= this.subtitles.length) {
      VibeApp.showToast('请先选择字幕条目', 'info');
      return;
    }
    const subtitle = this.subtitles[this.dualEditIndex];
    const video = document.getElementById('subtitleVideo');
    if (video) {
      video.currentTime = subtitle.startTime;
      video.pause();
    }
    if (VibeAudioManager.wavesurfer) {
      VibeAudioManager.syncTime(subtitle.startTime);
    }
    VibeApp.showToast(`已跳转到 ${this.formatTime(subtitle.startTime)}`, 'success');
  },

  dualEditPlay() {
    if (this.dualEditIndex < 0 || this.dualEditIndex >= this.subtitles.length) {
      VibeApp.showToast('请先选择字幕条目', 'info');
      return;
    }
    const subtitle = this.subtitles[this.dualEditIndex];
    const video = document.getElementById('subtitleVideo');
    
    if (video) {
      video.currentTime = subtitle.startTime;
      video.play().then(() => {
        const playUntilEnd = () => {
          if (video.currentTime >= subtitle.endTime || video.paused) {
            video.removeEventListener('timeupdate', playUntilEnd);
            video.pause();
          }
        };
        video.addEventListener('timeupdate', playUntilEnd);
      }).catch(() => {
        VibeApp.showToast('无法播放视频', 'error');
      });
    }
    
    if (VibeAudioManager.wavesurfer) {
      VibeAudioManager.syncTime(subtitle.startTime);
      VibeAudioManager.play();
    }
  },

  dualEditUpdateStats() {
    const original = document.getElementById('dualEditOriginal').value || '';
    const translated = document.getElementById('dualEditTranslated').value || '';
    document.getElementById('dualEditOriginalStats').textContent = `${original.length} 字`;
    document.getElementById('dualEditTranslatedStats').textContent = `${translated.length} 字`;
  },
  
  dualEditApply() {
    if (this.dualEditIndex < 0 || this.dualEditIndex >= this.subtitles.length) {
      VibeApp.showToast('请先选择字幕条目', 'info');
      return;
    }
    const subtitle = this.subtitles[this.dualEditIndex];
    subtitle.originalText = document.getElementById('dualEditOriginal').value;
    subtitle.translatedText = document.getElementById('dualEditTranslated').value;
    this.renderTimeline();
    if (this.currentSubtitleIndex === this.dualEditIndex) {
      this.showOverlay(subtitle);
    }
    // 创建快照
    if (typeof VibeSnapshot !== 'undefined') {
      VibeSnapshot.createSnapshot('update_original', VibeSnapshot.generateDescription('update_original', this.dualEditIndex), (subtitle.originalText || '').substring(0, 20));
    }
    VibeApp.showToast('修改已应用', 'success');
  },
  
  // 获取字幕的有效样式
  getEffectiveStyle(subtitle) {
    if (subtitle.style) {
      // 合并全局样式和字幕独立样式，确保全局新增属性（如卡拉OK）也能生效
      return { ...this.globalStyleSettings, ...subtitle.style };
    }
    // 使用全局默认样式
    return this.globalStyleSettings;
  },
  
  // 加载字幕数据
  loadSubtitles() {
    const saved = VibeStorage.get('vibetrans_subtitles', []);
    if (saved.length > 0) {
      this.subtitles = saved;
      this.renderTimeline();
    }
  },
  
  // 保存字幕数据
  saveSubtitles() {
    VibeStorage.set('vibetrans_subtitles', this.subtitles);
  },
  
  // 导入视频
  importVideo(file) {
    if (!file) return;

    console.log('[Video] ========== 导入视频 ==========');
    console.log('[Video] 文件名:', file.name);
    console.log('[Video] 文件类型:', file.type);
    console.log('[Video] 文件大小:', (file.size / 1024 / 1024).toFixed(2), 'MB');

    // 验证文件类型 - 只接受 MP4/WebM/OGV
    const validVideoTypes = ['video/mp4', 'video/webm', 'video/ogg'];
    const validExtensions = /\.(mp4|webm|ogv|ogg)$/i;
    const isValidType = validVideoTypes.includes(file.type) || validExtensions.test(file.name);

    if (!isValidType) {
      console.error('[Video] 不支持的视频格式:', file.type);
      VibeApp.showToast('不支持的视频格式，请选择 MP4、WebM 或 OGV 格式', 'error');
      return;
    }

    // 如果有旧的 blob URL，先释放
    if (this.videoUrl) {
      console.log('[Video] 释放旧的 Blob URL');
      URL.revokeObjectURL(this.videoUrl);
    }

    try {
      // 创建新的 Blob URL
      this.videoUrl = URL.createObjectURL(file);
      this.videoFile = file;

      console.log('[Video] Blob URL 已创建:', this.videoUrl.substring(0, 50) + '...');

      const video = document.getElementById('subtitleVideo');
      const source = document.getElementById('videoSource');
      const placeholder = document.getElementById('videoPlaceholder');

      if (!video) {
        console.error('[Video] 找不到 video 元素');
        return;
      }

      this.videoElement = video;

      // 清除之前的事件监听
      if (this._videoLoadedHandler) video.removeEventListener('loadedmetadata', this._videoLoadedHandler);
      if (this._videoErrorHandler) video.removeEventListener('error', this._videoErrorHandler);
      if (this._videoCanPlayHandler) video.removeEventListener('canplay', this._videoCanPlayHandler);

      // 超时计时器：5秒内未触发 loadedmetadata 则提示失败
      let loadTimeout = null;
      const timeoutMs = 5000;

      const clearVideoTimeout = () => {
        if (loadTimeout) {
          clearTimeout(loadTimeout);
          loadTimeout = null;
        }
      };

      // 成功加载元数据
      this._videoLoadedHandler = () => {
        clearVideoTimeout();
        console.log('[Video] 视频元数据加载成功');
        console.log('[Video] 时长:', video.duration.toFixed(2), '秒');
        console.log('[Video] 尺寸:', video.videoWidth, 'x', video.videoHeight);
      };

      // 可以播放
      this._videoCanPlayHandler = () => {
        console.log('[Video] 视频可以播放');
        VibeApp.showToast('视频加载成功', 'success');
      };

      // 错误处理
      this._videoErrorHandler = (e) => {
        clearVideoTimeout();
        const error = video.error;
        let errorMsg = '未知错误';
        if (error) {
          switch (error.code) {
            case 1: errorMsg = '视频加载被中止'; break;
            case 2: errorMsg = '网络错误，视频无法加载'; break;
            case 3: errorMsg = '视频解码失败，文件可能已损坏'; break;
            case 4: errorMsg = '视频格式不支持'; break;
          }
        }
        console.error('[Video] 视频加载错误:', error?.code, errorMsg);
        console.error('[Video] 详细错误:', e);
        VibeApp.showToast('视频加载失败：' + errorMsg, 'error');
      };

      // 设置视频源
      source.src = this.videoUrl;
      source.type = file.type || 'video/mp4';
      video.load();
      placeholder.style.display = 'none';

      // 添加事件监听
      video.addEventListener('loadedmetadata', this._videoLoadedHandler);
      video.addEventListener('canplay', this._videoCanPlayHandler);
      video.addEventListener('error', this._videoErrorHandler);

      // 设置超时
      loadTimeout = setTimeout(() => {
        console.warn('[Video] 视频加载超时（5秒）');
        // 检查是否已经加载
        if (video.readyState < 1) {
          VibeApp.showToast('视频加载超时，请检查文件格式是否正确', 'error');
        }
      }, timeoutMs);

    } catch (error) {
      console.error('[Video] 视频导入异常:', error);
      VibeApp.showToast('视频导入失败: ' + error.message, 'error');
    }
  },
  
  async extractAudioWithFFmpeg(videoFile) {
    console.log('[FFmpeg] Starting audio extraction via VibeAudioManager...');
    
    try {
      const audioBlob = await VibeAudioManager.extractAudio(videoFile, (progress, message) => {
        console.log(`[Audio] Progress: ${progress}% - ${message}`);
      });
      
      this.audioBlob = audioBlob;
      
      console.log('[FFmpeg] Audio extracted successfully, size:', this.audioBlob.size);
      VibeApp.showToast('音频提取成功', 'success');
      
    } catch (error) {
      console.error('[FFmpeg] Audio extraction error:', error);
      VibeApp.showToast('音频提取失败，请刷新页面重试', 'error');
      this.audioBlob = null;
    }
  },
  
  // 标记开始时间
  markStartTime(time = null) {
    if (time === null) {
      const video = document.getElementById('subtitleVideo');
      this.markedStartTime = video.currentTime;
    } else {
      this.markedStartTime = time;
      const video = document.getElementById('subtitleVideo');
      video.currentTime = time;
    }
    document.getElementById('markedStartTime').textContent = this.formatTime(this.markedStartTime);
    this.updateAddButtonState();
    
    if (VibeAudioManager.wavesurfer) {
      VibeAudioManager.syncTime(this.markedStartTime);
    }
    
    this.updateWaveformMarkers();
  },
  
  // 标记结束时间
  markEndTime(time = null) {
    if (time === null) {
      const video = document.getElementById('subtitleVideo');
      this.markedEndTime = video.currentTime;
    } else {
      this.markedEndTime = time;
      const video = document.getElementById('subtitleVideo');
      video.currentTime = time;
    }
    document.getElementById('markedEndTime').textContent = this.formatTime(this.markedEndTime);
    this.updateAddButtonState();
    
    if (VibeAudioManager.wavesurfer) {
      VibeAudioManager.syncTime(this.markedEndTime);
    }
    
    this.updateWaveformMarkers();
  },

  // 播放/暂停
  togglePlay() {
    const video = document.getElementById('subtitleVideo');
    if (video.paused) {
      video.play();
      VibeAudioManager.play();
    } else {
      video.pause();
      VibeAudioManager.pause();
    }
  },

  // 跳转
  seek(seconds) {
    const video = document.getElementById('subtitleVideo');
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
    if (VibeAudioManager.wavesurfer) {
      VibeAudioManager.syncTime(video.currentTime);
    }
  },

  // 根据标记创建字幕
  createSubtitleFromMarkers() {
    if (this.markedStartTime == null || this.markedEndTime == null) {
      VibeApp.showToast('请先标记开始和结束时间', 'info');
      return;
    }
    if (this.markedEndTime <= this.markedStartTime) {
      VibeApp.showToast('结束时间必须大于开始时间', 'error');
      return;
    }

    const newSubtitle = {
      id: Date.now(),
      startTime: this.markedStartTime,
      endTime: this.markedEndTime,
      originalText: '',
      translatedText: '',
      translationSource: null,
      style: null,
      isLoading: false,
      charStyles: { original: {}, translated: {} }
    };

    this.subtitles.push(newSubtitle);
    this.sortSubtitles();
    this.renderTimeline();
    this.updateUI();
    this.saveSubtitles();

    this.markedStartTime = this.markedEndTime;
    document.getElementById('markedStartTime').textContent = this.formatTime(this.markedStartTime);
    this.markedEndTime = null;
    document.getElementById('markedEndTime').textContent = '--:--.--';
    this.updateAddButtonState();

    VibeApp.showToast('字幕已创建', 'success');
  },

  // 拆分当前字幕
  splitCurrentSubtitle() {
    if (this.selectedSubtitleIndex === -1) return;
    
    const video = document.getElementById('subtitleVideo');
    const currentTime = video.currentTime;
    const subtitle = this.subtitles[this.selectedSubtitleIndex];
    
    if (currentTime <= subtitle.start || currentTime >= subtitle.end) {
      VibeApp.showToast('请在字幕时间范围内拆分', 'error');
      return;
    }

    const oldData = { ...subtitle };
    
    subtitle.end = currentTime;
    
    const newSubtitle = {
      id: 'subtitle-' + Date.now(),
      start: currentTime,
      end: oldData.end,
      text: '',
      translatedText: '',
      displayMode: 'global'
    };

    this.subtitles.splice(this.selectedSubtitleIndex + 1, 0, newSubtitle);
    this.sortSubtitles();
    
    const action = VibeUndo.createUpdateAction(subtitle.id, oldData, { end: currentTime });
    VibeUndo.push(action);
    
    this.renderTimeline();
    this.updateUI();
    
    VibeApp.showToast('字幕已拆分', 'success');
  },

  // 删除选中字幕
  deleteSelectedSubtitles() {
    if (this.selectedIndices.length === 0) {
      if (this.selectedSubtitleIndex !== -1) {
        this.selectedIndices = [this.selectedSubtitleIndex];
      } else {
        VibeApp.showToast('请先选中要删除的字幕', 'error');
        return;
      }
    }

    const deletedSubtitles = [];
    this.selectedIndices.sort((a, b) => b - a);
    
    this.selectedIndices.forEach(idx => {
      deletedSubtitles.push({ ...this.subtitles[idx] });
    });

    const action = VibeUndo.createDeleteAction(deletedSubtitles, [...this.selectedIndices].sort((a, b) => a - b));
    VibeUndo.push(action);
    
    this.selectedIndices.forEach(idx => {
      this.subtitles.splice(idx, 1);
    });
    
    this.selectedIndices = [];
    this.selectedSubtitleIndex = -1;
    
    this.renderTimeline();
    this.updateUI();
    
    VibeApp.showToast(`已删除 ${deletedSubtitles.length} 条字幕`, 'success');
  },
  
  // 更新添加按钮状态
  updateAddButtonState() {
    const btn = document.getElementById('addSubtitleBtn');
    const recognizeBtn = document.getElementById('recognizeSegmentBtn');
    const canAdd = this.markedStartTime !== null && 
                   this.markedEndTime !== null && 
                   this.markedEndTime > this.markedStartTime;
    btn.disabled = !canAdd;
    recognizeBtn.disabled = !canAdd;
  },
  
  // 打开添加字幕模态框
  openAddModal() {
    if (this.markedStartTime == null || this.markedEndTime == null) return;
    
    const timeRange = document.getElementById('modalTimeRange');
    timeRange.textContent = `${this.formatTime(this.markedStartTime)} → ${this.formatTime(this.markedEndTime)}`;
    
    // 初始化轨道选择器为当前轨道
    const trackSelect = document.getElementById('addSubtitleTrack');
    if (trackSelect) {
      trackSelect.value = this.currentTrack || 'main';
    }

    document.getElementById('modalOriginalText').value = '';
    document.getElementById('addSubtitleModal').classList.add('show');
    // 遮罩点击关闭
    const modal = document.getElementById('addSubtitleModal');
    modal.onclick = (e) => {
      if (e.target === modal) this.closeAddModal();
    };
  },

  // 添加字幕弹窗中轨道选择变化
  onAddTrackChange(trackId) {
    // 根据轨道类型更新占位提示
    const textarea = document.getElementById('modalOriginalText');
    if (!textarea) return;
    const trackDef = this.trackDefinitions.find(t => t.id === trackId);
    if (trackDef) {
      if (trackId === 'title') {
        textarea.placeholder = '输入人名注释，如：【角色名】';
      } else if (trackId === 'annotation') {
        textarea.placeholder = '输入剧情注释，如：（叹气）或【注：背景说明】';
      } else {
        textarea.placeholder = '输入字幕原文...';
      }
    }
  },
  
  // 关闭添加字幕模态框
  closeAddModal() {
    document.getElementById('addSubtitleModal').classList.remove('show');
    this.markedStartTime = null;
    this.markedEndTime = null;
    document.getElementById('markedStartTime').textContent = '--:--.--';
    document.getElementById('markedEndTime').textContent = '--:--.--';
    this.updateAddButtonState();
  },
  
  // 确认添加字幕
  confirmAddSubtitle() {
    const originalText = document.getElementById('modalOriginalText').value.trim();
    const trackSelect = document.getElementById('addSubtitleTrack');
    const targetTrack = trackSelect?.value || this.currentTrack || 'main';

    if (!originalText) {
      VibeApp.showToast('请输入字幕内容', 'info');
      return;
    }

    if (this.markedEndTime <= this.markedStartTime) {
      VibeApp.showToast('结束时间必须大于开始时间', 'error');
      return;
    }

    // 智能拆分：若文本包含括号注释，则主对白保留纯台词，注释拆分到剧情注释轨道
    const split = this.smartSplitOnPaste(originalText);
    const useSplit = split.annotations.length > 0 && split.mainText && targetTrack === 'main';

    const mainText = useSplit ? split.mainText : originalText;
    const newSubtitle = {
      id: Date.now(),
      startTime: this.markedStartTime,
      endTime: this.markedEndTime,
      originalText: mainText,
      translatedText: '',
      translationSource: null,
      style: null,
      isLoading: false,
      track: targetTrack
    };

    this.subtitles.push(newSubtitle);

    // 创建快照
    if (typeof VibeSnapshot !== 'undefined') {
      VibeSnapshot.createSnapshot('add', VibeSnapshot.generateDescription('add', this.subtitles.length - 1), VibeSnapshot.getPreviewText(newSubtitle));
    }

    // 若发生拆分，自动创建注释轨道条目
    if (useSplit) {
      const annotationTrack = this.getTrackDef('annotation');
      const style = annotationTrack?.style || {};
      split.annotations.forEach((text, i) => {
        this.subtitles.push({
          id: Date.now() + Math.random() + i,
          startTime: this.markedStartTime,
          endTime: this.markedEndTime,
          originalText: text,
          translatedText: '',
          translationSource: null,
          style: { ...style },
          isLoading: false,
          track: 'annotation',
          parentSubtitleId: newSubtitle.id
        });
      });
      VibeApp.showToast(`已自动拆分：主对白 + ${split.annotations.length} 条注释`, 'success');
    } else {
      VibeApp.showToast('字幕添加成功', 'success');
    }

    this.sortSubtitles();
    this.saveSubtitles();
    this.renderTrackTabs();
    this.renderTimeline();
    this.updateUI();
    this.closeAddModal();
  },
  
  // 导入字幕文件
  async importSubtitles(file) {
    if (!file) return;
    
    try {
      const content = await this.readFile(file);
      const extension = file.name.split('.').pop().toLowerCase();
      
      let parsedSubtitles = [];
      if (extension === 'srt') {
        parsedSubtitles = this.parseSrt(content);
      } else if (extension === 'vtt') {
        parsedSubtitles = this.parseVtt(content);
      }
      
      if (parsedSubtitles.length > 0) {
        // 合并去重
        this.subtitles = this.mergeSubtitles(this.subtitles, parsedSubtitles);
        this.sortSubtitles();
        this.renderTimeline();
        this.updateUI();
        VibeApp.showToast(`成功导入 ${parsedSubtitles.length} 条字幕`, 'success');
      } else {
        VibeApp.showToast('未解析到字幕内容', 'info');
      }
    } catch (error) {
      console.error('Subtitle import error:', error);
      VibeApp.showToast('字幕导入失败', 'error');
    }
  },
  
  // 读取文件
  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file, 'UTF-8');
    });
  },
  
  // 解析SRT文件
  parseSrt(content) {
    const subtitles = [];
    const blocks = content.split(/\r?\n\r?\n/).filter(block => block.trim());
    
    for (const block of blocks) {
      const lines = block.split(/\r?\n/).filter(line => line.trim());
      if (lines.length < 3) continue;
      
      let index = 0;
      const id = parseInt(lines[index]) || Date.now() + subtitles.length;
      index++;
      
      const timeLine = lines[index];
      index++;
      
      const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
      if (!timeMatch) continue;
      
      const startTime = this.parseTime(timeMatch[1]);
      const endTime = this.parseTime(timeMatch[2]);
      
      const text = lines.slice(index).join('\n');
      
      subtitles.push({
        id,
        startTime,
        endTime,
        originalText: text,
        translatedText: '',
        translationSource: null,
        style: null,
        isLoading: false
      });
    }
    
    return subtitles;
  },
  
  // 解析VTT文件
  parseVtt(content) {
    const subtitles = [];
    const lines = content.split(/\r?\n/);
    let i = 0;
    
    // 跳过头部
    while (i < lines.length && lines[i].trim() !== '') {
      i++;
    }
    i++;
    
    while (i < lines.length) {
      if (!lines[i].trim()) {
        i++;
        continue;
      }
      
      const timeLine = lines[i];
      i++;
      
      const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2}(?:\.\d{3})?) --> (\d{2}:\d{2}:\d{2}(?:\.\d{3})?)/);
      if (!timeMatch) {
        i++;
        continue;
      }
      
      const startTime = this.parseTime(timeMatch[1]);
      const endTime = this.parseTime(timeMatch[2]);
      
      const textParts = [];
      while (i < lines.length && lines[i].trim()) {
        textParts.push(lines[i]);
        i++;
      }
      
      const text = textParts.join('\n');
      
      subtitles.push({
        id: Date.now() + subtitles.length,
        startTime,
        endTime,
        originalText: text,
        translatedText: '',
        translationSource: null,
        style: null,
        isLoading: false
      });
    }
    
    return subtitles;
  },
  
  // 解析时间字符串为秒
  parseTime(timeStr) {
    const parts = timeStr.replace(',', '.').split(':');
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    
    return hours * 3600 + minutes * 60 + seconds;
  },
  
  // 格式化时间（秒转 mm:ss.ms）
  formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    
    const mStr = m.toString().padStart(2, '0');
    const sStr = s.toString().padStart(2, '0');
    const msStr = ms.toString().padStart(2, '0');
    
    return `${mStr}:${sStr}.${msStr}`;
  },
  
  // 合并字幕（去重）
  mergeSubtitles(existing, newSubtitles) {
    const existingSet = new Set(existing.map(s => `${s.startTime}-${s.endTime}-${s.originalText}`));
    
    for (const sub of newSubtitles) {
      const key = `${sub.startTime}-${sub.endTime}-${sub.originalText}`;
      if (!existingSet.has(key)) {
        existing.push(sub);
      }
    }
    
    return existing;
  },
  
  // 按时间排序
  sortSubtitles() {
    this.subtitles.sort((a, b) => a.startTime - b.startTime);
  },
  
  // 获取字幕状态类名
  getSubtitleStatusClass(subtitle) {
    if (subtitle.isLoading) return 'loading';
    if (subtitle.isAiGenerated) return 'ai-generated';
    if (!subtitle.translatedText) return 'untranslated';
    if (subtitle.translationSource === 'memory') return 'memory-match';
    return 'translated';
  },
  
  // 选择字幕（用于单条样式编辑）
  selectSubtitle(index) {
    this.selectedSubtitleIndex = index;

    // 如果当前是单条编辑模式，更新面板
    if (!this.isGlobalStyle) {
      const editHint = document.getElementById('styleEditHint');
      editHint.style.display = 'block';
      document.getElementById('editingSubtitleIndex').textContent = index + 1;

      const subtitle = this.subtitles[index];
      const style = subtitle.style || this.globalStyleSettings;
      this.applyStyleSettingsToPanel(style);
    }

    // 如果正在编辑，不要重新渲染表格
    if (this.editingCell) return;

    // 只更新行的高亮状态，不重新渲染整个表格
    document.querySelectorAll('#timelineListBody tr').forEach(tr => {
      tr.classList.remove('selected');
    });
    const targetRow = document.querySelector(`#timelineListBody tr[onclick*="selectSubtitle(${index})"]`);
    if (targetRow) {
      targetRow.classList.add('selected');
    }
    this.highlightSubtitleRegion();
  },
  
  // 渲染时间轴列表
  // 渲染单条字幕项HTML
  renderSubtitleItem(subtitle, index) {
    const isActive = index === this.currentSubtitleIndex;
    const isSelected = this.selectedIndices.includes(index);
    const displayMode = subtitle.displayMode || 'global';
    const isCustomized = displayMode !== 'global';
    
    const duration = subtitle.endTime - subtitle.startTime;
    const sourceChars = subtitle.originalText.replace(/\s/g, '').length;
    const charsPerSecond = duration > 0 ? (sourceChars / duration).toFixed(1) : '-';
    const isOverLimit = duration > 0 && sourceChars / duration > 5;
    
    const highlightedOriginal = this.highlightTerms(subtitle.originalText);
    const highlightedTranslated = this.highlightTerms(subtitle.translatedText);
    
    return `
      <div class="subtitle-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${this.getSubtitleStatusClass(subtitle)}" 
           data-index="${index}"
           onclick="VibeSubtitles.handleSubtitleClick(${index}, event)">
        ${isCustomized ? '<span class="customized-indicator"></span>' : ''}
        <input type="checkbox" class="subtitle-checkbox" 
          ${isSelected ? 'checked' : ''}
          onchange="VibeSubtitles.toggleSelect(${index}, this.checked)">
        <span class="subtitle-index">${index + 1}</span>
        <div class="display-mode-cell">
          <select class="display-mode-select" onchange="VibeSubtitles.updateSubtitleDisplayMode(${index}, this.value)">
            <option value="global" ${displayMode === 'global' ? 'selected' : ''}>跟随全局</option>
            <option value="sourceOnly" ${displayMode === 'sourceOnly' ? 'selected' : ''}>仅原文</option>
            <option value="targetOnly" ${displayMode === 'targetOnly' ? 'selected' : ''}>仅译文</option>
            <option value="bilingual" ${displayMode === 'bilingual' ? 'selected' : ''}>双语显示</option>
          </select>
        </div>
        <div class="subtitle-time-row">
          <input type="text" class="time-input" value="${this.formatTime(subtitle.startTime)}" 
            onfocus="VibeSubtitles.onEditFocus()" onblur="VibeSubtitles.onEditBlur()"
            onchange="VibeSubtitles.updateStartTime(${index}, this.value)" />
          <span class="time-separator">→</span>
          <input type="text" class="time-input" value="${this.formatTime(subtitle.endTime)}" 
            onfocus="VibeSubtitles.onEditFocus()" onblur="VibeSubtitles.onEditBlur()"
            onchange="VibeSubtitles.updateEndTime(${index}, this.value)" />
          <span class="chars-per-second ${isOverLimit ? 'over-limit' : ''}" title="字/秒（>5字/秒标红）">${charsPerSecond}</span>
        </div>
        <div class="subtitle-text-row">
          <div class="subtitle-label">原文 ${subtitle.isAiGenerated ? '<span class="translation-source ai">AI生成</span>' : ''}</div>
          <div class="subtitle-text-preview">${highlightedOriginal || '<span class="empty-text">空</span>'}</div>
          <textarea class="subtitle-textarea" rows="2" 
            onfocus="VibeSubtitles.onEditFocus(${index}, 'original')" onblur="VibeSubtitles.onEditBlur()"
            oninput="VibeSubtitles.updateOriginalText(${index}, this.value)">${this.escapeHtml(subtitle.originalText)}</textarea>
        </div>
        <div class="subtitle-text-row">
          <div class="subtitle-label">译文 ${subtitle.translationSource ? `<span class="translation-source ${subtitle.translationSource}">${subtitle.translationSource === 'memory' ? '记忆库' : '机器翻译'}</span>` : ''}</div>
          <div class="subtitle-text-preview">${highlightedTranslated || '<span class="empty-text">空</span>'}</div>
          <textarea class="subtitle-textarea translation" rows="2" 
            onfocus="VibeSubtitles.onEditFocus(${index}, 'target')" onblur="VibeSubtitles.onEditBlur()"
            oninput="VibeSubtitles.updateTranslatedText(${index}, this.value)">${this.escapeHtml(subtitle.translatedText)}</textarea>
        </div>
        <div class="subtitle-actions">
          <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.jumpToSubtitle(${index})" title="跳转">⏩</button>
          <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.splitSubtitle(${index})" title="拆分">✂️</button>
          <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.addCulturalAnnotation(${index})" title="添加背景注释">📝</button>
          ${subtitle.isLoading 
            ? '<span class="loading-spinner-sm"></span>' 
            : `<button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.translateSingle(${index})">翻译</button>`
          }
          <button class="btn btn-danger btn-sm" onclick="VibeSubtitles.deleteSubtitle(${index})">删除</button>
        </div>
      </div>
    `;
  },
  
  highlightTerms(text) {
    if (!text || !window.VibeCorpus || !VibeCorpus.findTermsInText) return this.escapeHtml(text);
    
    const terms = VibeCorpus.findTermsInText(text);
    if (terms.length === 0) return this.escapeHtml(text);
    
    let result = text;
    terms.forEach(term => {
      result = VibeCorpus.highlightTerm(result, term.term, 'term-highlight');
    });
    
    return result;
  },
  
  renderTimeline() {
    // 始终渲染独立时间轴面板
    this.renderTimelinePanel();
    // 渲染列表工具栏（排序/筛选/批量操作）
    this.renderTimelineListToolbar();

    const container = document.getElementById('timelineList');
    const tbody = document.getElementById('timelineListBody');

    if (this.subtitles.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-cell">
            <div class="empty-state-sm">
              <span>📝</span>
              <span>暂无字幕数据</span>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    // 按当前轨道过滤字幕（保留全局索引用于编辑）
    let filteredSubtitles = [];
    this.subtitles.forEach((subtitle, index) => {
      if ((subtitle.track || 'main') === this.currentTrack) {
        filteredSubtitles.push({ subtitle, index });
      }
    });

    // 应用搜索筛选
    if (this.timelineSearchQuery && this.timelineSearchQuery.trim()) {
      const q = this.timelineSearchQuery.toLowerCase().trim();
      filteredSubtitles = filteredSubtitles.filter(({ subtitle }) =>
        (subtitle.originalText || '').toLowerCase().includes(q) ||
        (subtitle.translatedText || '').toLowerCase().includes(q)
      );
    }

    // 应用译文状态筛选
    if (this.timelineFilterTranslated !== 'all') {
      filteredSubtitles = filteredSubtitles.filter(({ subtitle }) => {
        const has = subtitle.translatedText && subtitle.translatedText.trim();
        return this.timelineFilterTranslated === 'translated' ? has : !has;
      });
    }

    if (filteredSubtitles.length === 0) {
      const trackName = this.trackDefinitions.find(t => t.id === this.currentTrack)?.name || '当前轨道';
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-cell">
            <div class="empty-state-sm">
              <span>📝</span>
              <span>「${trackName}」轨道暂无符合筛选条件的字幕</span>
              <span style="font-size: 11px; color: var(--text-tertiary); margin-top: 4px;">尝试调整搜索关键词或筛选条件</span>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    // 应用排序（基于过滤后的副本，不修改原数组）
    const sorted = [...filteredSubtitles];
    switch (this.timelineSortBy) {
      case 'timeDesc':
        sorted.sort((a, b) => b.subtitle.startTime - a.subtitle.startTime);
        break;
      case 'durationDesc':
        sorted.sort((a, b) => (b.subtitle.endTime - b.subtitle.startTime) - (a.subtitle.endTime - a.subtitle.startTime));
        break;
      case 'durationAsc':
        sorted.sort((a, b) => (a.subtitle.endTime - a.subtitle.startTime) - (b.subtitle.endTime - b.subtitle.startTime));
        break;
      case 'textLenDesc':
        sorted.sort((a, b) => (b.subtitle.originalText || '').length - (a.subtitle.originalText || '').length);
        break;
      case 'translationStatus':
        // 未翻译优先
        sorted.sort((a, b) => {
          const aHas = a.subtitle.translatedText && a.subtitle.translatedText.trim() ? 1 : 0;
          const bHas = b.subtitle.translatedText && b.subtitle.translatedText.trim() ? 1 : 0;
          return aHas - bHas;
        });
        break;
      case 'timeAsc':
      default:
        sorted.sort((a, b) => a.subtitle.startTime - b.subtitle.startTime);
        break;
    }

    // 时间轴视图不再在列表中渲染
    if (this.viewMode === 'timeline') {
      this.viewMode = 'table';
    }

    const hasSelection = this.selectedIndices.length > 0;

    tbody.innerHTML = `
      ${sorted.map(({ subtitle, index }) => {
        const isSelected = this.selectedIndices.includes(index);
        const hasTranslation = subtitle.translatedText && subtitle.translatedText.trim();
        const duration = (subtitle.endTime - subtitle.startTime).toFixed(2);
        return `
          <tr ${isSelected ? 'class="selected"' : ''} onclick="VibeSubtitles.selectSubtitle(${index})">
            <td class="col-index">
              <input type="checkbox" ${isSelected ? 'checked' : ''}
                onchange="event.stopPropagation(); VibeSubtitles.toggleSelect(${index}, this.checked)">
            </td>
            <td class="col-time-start">${this.formatTime(subtitle.startTime)}</td>
            <td class="col-time-end">${this.formatTime(subtitle.endTime)}</td>
            <td class="col-duration">${duration}s</td>
            <td class="col-original" title="${this.escapeHtml(subtitle.originalText)}"
                ondblclick="event.stopPropagation(); VibeSubtitles.startInlineEdit(${index}, 'originalText', event)">${this.escapeHtml(subtitle.originalText)}</td>
            <td class="col-translated ${hasTranslation ? 'has-translation' : ''}"
                ondblclick="event.stopPropagation(); VibeSubtitles.startInlineEdit(${index}, 'translatedText', event)"
                title="${this.escapeHtml(subtitle.translatedText || '')}">${this.escapeHtml(subtitle.translatedText || '')}</td>
            <td class="col-actions">
              <button class="action-btn" onclick="event.stopPropagation(); VibeSubtitles.jumpToSubtitle(${index})" title="跳转">⏱️</button>
              <button class="action-btn" onclick="event.stopPropagation(); VibeSubtitles.playSubtitle(${index})" title="播放">▶️</button>
              <button class="action-btn" onclick="event.stopPropagation(); VibeSubtitles.dualEditGo(${index})" title="编辑">✏️</button>
              <button class="action-btn" onclick="event.stopPropagation(); VibeSubtitles.setSubtitleTrackPrompt(${index})" title="切换轨道" style="font-size: 11px;">📂</button>
              <button class="action-btn" onclick="event.stopPropagation(); VibeSubtitles.deleteSubtitle(${index})" title="删除">🗑️</button>
            </td>
          </tr>
        `;
      }).join('')}
    `;
  },

  /**
   * 渲染时间轴列表的工具栏（排序/搜索/筛选/批量操作）
   */
  renderTimelineListToolbar() {
    let toolbar = document.getElementById('timelineListToolbar');
    if (!toolbar) {
      // 在表格 thead 上方插入工具栏
      const listContainer = document.getElementById('timelineList');
      if (!listContainer) return;
      toolbar = document.createElement('div');
      toolbar.id = 'timelineListToolbar';
      toolbar.className = 'timeline-list-toolbar';
      listContainer.insertBefore(toolbar, listContainer.firstChild);
    }

    const sortOptions = [
      { value: 'timeAsc', label: '时间↑' },
      { value: 'timeDesc', label: '时间↓' },
      { value: 'durationDesc', label: '时长↓' },
      { value: 'durationAsc', label: '时长↑' },
      { value: 'textLenDesc', label: '字数↓' },
      { value: 'translationStatus', label: '未译优先' }
    ];
    const filterOptions = [
      { value: 'all', label: '全部' },
      { value: 'translated', label: '已翻译' },
      { value: 'untranslated', label: '未翻译' }
    ];

    const selectedCount = this.selectedIndices.length;
    const batchBar = selectedCount > 0 ? `
      <div class="timeline-batch-bar">
        <span class="batch-info">已选 <strong>${selectedCount}</strong> 条</span>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.toggleSelectAll(true)">全选</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.toggleSelectAll(false)">取消</button>
        <button class="btn btn-danger btn-sm" onclick="VibeSubtitles.batchDelete()">🗑️ 批量删除</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.batchTimeOffset()">⏱️ 时间偏移</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.batchFindReplace()">🔍 查找替换</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.batchCleanup()">🧹 清理</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.batchMerge()">🔗 合并</button>
        <button class="btn btn-primary btn-sm" onclick="VibeSubtitles.batchAddToMemory()">📚 入记忆库</button>
        <button class="btn btn-primary btn-sm" onclick="VibeSubtitles.batchAddToCorpus()">📁 入语料库</button>
      </div>
    ` : '';

    toolbar.innerHTML = `
      <div class="timeline-toolbar-row">
        <input type="text" class="timeline-search-input" placeholder="🔍 搜索原文/译文..."
               value="${this.escapeHtml(this.timelineSearchQuery)}"
               oninput="VibeSubtitles.applyTimelineSearch(this.value)">
        <select class="timeline-sort-select" onchange="VibeSubtitles.applyTimelineSort(this.value)" title="排序方式">
          ${sortOptions.map(o => `<option value="${o.value}" ${this.timelineSortBy === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        <select class="timeline-filter-select" onchange="VibeSubtitles.applyTimelineFilter(this.value)" title="按翻译状态筛选">
          ${filterOptions.map(o => `<option value="${o.value}" ${this.timelineFilterTranslated === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.resetTimelineFilters()" title="重置筛选">🔄 重置</button>
      </div>
      ${batchBar}
    `;
  },

  applyTimelineSearch(value) {
    this.timelineSearchQuery = value;
    // 仅更新表格内容，不重渲染工具栏，避免输入框失焦
    this.renderTimelineBody();
    this.updateBatchBarOnly();
  },

  applyTimelineSort(value) {
    this.timelineSortBy = value;
    this.renderTimeline();
  },

  applyTimelineFilter(value) {
    this.timelineFilterTranslated = value;
    this.renderTimeline();
  },

  /**
   * 仅更新批量操作条（不重建搜索框）
   */
  updateBatchBarOnly() {
    const toolbar = document.getElementById('timelineListToolbar');
    if (!toolbar) return;
    let batchBar = toolbar.querySelector('.timeline-batch-bar');
    const selectedCount = this.selectedIndices.length;
    if (selectedCount > 0) {
      const html = `
        <span class="batch-info">已选 <strong>${selectedCount}</strong> 条</span>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.toggleSelectAll(true)">全选</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.toggleSelectAll(false)">取消</button>
        <button class="btn btn-danger btn-sm" onclick="VibeSubtitles.batchDelete()">🗑️ 批量删除</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.batchTimeOffset()">⏱️ 时间偏移</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.batchFindReplace()">🔍 查找替换</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.batchCleanup()">🧹 清理</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.batchMerge()">🔗 合并</button>
        <button class="btn btn-primary btn-sm" onclick="VibeSubtitles.batchAddToMemory()">📚 入记忆库</button>
        <button class="btn btn-primary btn-sm" onclick="VibeSubtitles.batchAddToCorpus()">📁 入语料库</button>
      `;
      if (batchBar) {
        batchBar.innerHTML = html;
      } else {
        batchBar = document.createElement('div');
        batchBar.className = 'timeline-batch-bar';
        batchBar.innerHTML = html;
        toolbar.appendChild(batchBar);
      }
    } else if (batchBar) {
      batchBar.remove();
    }
  },

  /**
   * 仅渲染表格主体（保留工具栏状态）
   */
  renderTimelineBody() {
    // 调用 renderTimeline 的表格渲染部分（不重置工具栏）
    const tbody = document.getElementById('timelineListBody');
    if (!tbody) return;

    if (this.subtitles.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell"><div class="empty-state-sm"><span>📝</span><span>暂无字幕数据</span></div></td></tr>`;
      return;
    }

    let filteredSubtitles = [];
    this.subtitles.forEach((subtitle, index) => {
      if ((subtitle.track || 'main') === this.currentTrack) {
        filteredSubtitles.push({ subtitle, index });
      }
    });

    if (this.timelineSearchQuery && this.timelineSearchQuery.trim()) {
      const q = this.timelineSearchQuery.toLowerCase().trim();
      filteredSubtitles = filteredSubtitles.filter(({ subtitle }) =>
        (subtitle.originalText || '').toLowerCase().includes(q) ||
        (subtitle.translatedText || '').toLowerCase().includes(q)
      );
    }

    if (this.timelineFilterTranslated !== 'all') {
      filteredSubtitles = filteredSubtitles.filter(({ subtitle }) => {
        const has = subtitle.translatedText && subtitle.translatedText.trim();
        return this.timelineFilterTranslated === 'translated' ? has : !has;
      });
    }

    if (filteredSubtitles.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell"><div class="empty-state-sm"><span>📝</span><span>暂无符合筛选条件的字幕</span></div></td></tr>`;
      return;
    }

    const sorted = [...filteredSubtitles];
    switch (this.timelineSortBy) {
      case 'timeDesc':
        sorted.sort((a, b) => b.subtitle.startTime - a.subtitle.startTime);
        break;
      case 'durationDesc':
        sorted.sort((a, b) => (b.subtitle.endTime - b.subtitle.startTime) - (a.subtitle.endTime - a.subtitle.startTime));
        break;
      case 'durationAsc':
        sorted.sort((a, b) => (a.subtitle.endTime - a.subtitle.startTime) - (b.subtitle.endTime - b.subtitle.startTime));
        break;
      case 'textLenDesc':
        sorted.sort((a, b) => (b.subtitle.originalText || '').length - (a.subtitle.originalText || '').length);
        break;
      case 'translationStatus':
        sorted.sort((a, b) => {
          const aHas = a.subtitle.translatedText && a.subtitle.translatedText.trim() ? 1 : 0;
          const bHas = b.subtitle.translatedText && b.subtitle.translatedText.trim() ? 1 : 0;
          return aHas - bHas;
        });
        break;
      case 'timeAsc':
      default:
        sorted.sort((a, b) => a.subtitle.startTime - b.subtitle.startTime);
        break;
    }

    tbody.innerHTML = sorted.map(({ subtitle, index }) => {
      const isSelected = this.selectedIndices.includes(index);
      const hasTranslation = subtitle.translatedText && subtitle.translatedText.trim();
      const duration = (subtitle.endTime - subtitle.startTime).toFixed(2);
      return `
        <tr ${isSelected ? 'class="selected"' : ''} onclick="VibeSubtitles.selectSubtitle(${index})">
          <td class="col-index">
            <input type="checkbox" ${isSelected ? 'checked' : ''}
              onchange="event.stopPropagation(); VibeSubtitles.toggleSelect(${index}, this.checked)">
          </td>
          <td class="col-time-start">${this.formatTime(subtitle.startTime)}</td>
          <td class="col-time-end">${this.formatTime(subtitle.endTime)}</td>
          <td class="col-duration">${duration}s</td>
          <td class="col-original" title="${this.escapeHtml(subtitle.originalText)}"
              ondblclick="event.stopPropagation(); VibeSubtitles.startInlineEdit(${index}, 'originalText', event)">${this.escapeHtml(subtitle.originalText)}</td>
          <td class="col-translated ${hasTranslation ? 'has-translation' : ''}"
              ondblclick="event.stopPropagation(); VibeSubtitles.startInlineEdit(${index}, 'translatedText', event)"
              title="${this.escapeHtml(subtitle.translatedText || '')}">${this.escapeHtml(subtitle.translatedText || '')}</td>
          <td class="col-actions">
            <button class="action-btn" onclick="event.stopPropagation(); VibeSubtitles.jumpToSubtitle(${index})" title="跳转">⏱️</button>
            <button class="action-btn" onclick="event.stopPropagation(); VibeSubtitles.playSubtitle(${index})" title="播放">▶️</button>
            <button class="action-btn" onclick="event.stopPropagation(); VibeSubtitles.dualEditGo(${index})" title="编辑">✏️</button>
            <button class="action-btn" onclick="event.stopPropagation(); VibeSubtitles.setSubtitleTrackPrompt(${index})" title="切换轨道" style="font-size: 11px;">📂</button>
            <button class="action-btn" onclick="event.stopPropagation(); VibeSubtitles.deleteSubtitle(${index})" title="删除">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  resetTimelineFilters() {
    this.timelineSearchQuery = '';
    this.timelineFilterTranslated = 'all';
    this.timelineSortBy = 'timeAsc';
    this.renderTimeline();
    VibeApp.showToast('已重置筛选', 'info');
  },
  
  renderBatchActions() {
    return `
      <div class="batch-actions-bar">
        <span>已选择 ${this.selectedIndices.length} 条字幕</span>
        <button class="btn btn-danger btn-sm" onclick="VibeSubtitles.batchDelete()">批量删除</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.batchTimeOffset()">时间偏移</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.batchFindReplace()">查找替换</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.batchCleanup()">批量清理</button>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.batchMerge()">合并短字幕</button>
        <button class="btn btn-primary btn-sm" onclick="VibeSubtitles.batchAddToCorpus()">添加到语料库</button>
        <button class="btn btn-primary btn-sm" onclick="VibeSubtitles.batchAddToMemory()">添加到记忆库</button>
      </div>
    `;
  },

  // 在独立面板中渲染时间轴
  renderTimelinePanel() {
    const panel = document.getElementById('timelinePanel');
    if (!panel) return;

    if (this.subtitles.length === 0) {
      panel.innerHTML = `
        <div class="timeline-panel-empty">
          <p>导入视频并添加字幕后，时间轴将在此显示</p>
        </div>
      `;
      return;
    }

    const video = document.getElementById('subtitleVideo');
    const duration = (video && video.duration) ? video.duration : (this.subtitles.length > 0 ? this.subtitles[this.subtitles.length - 1].endTime : 60);

    const zoom = this.timelineZoom || 1;
    const pixelsPerSecond = 50 * zoom;
    const totalWidth = duration * pixelsPerSecond;

    const timeToPixel = (t) => t * pixelsPerSecond;

    const displayMode = this.timelineDisplayMode || 'both';

    // 按轨道分组字幕
    const tracks = this.trackDefinitions.filter(t => t.enabled !== false);
    const trackLanes = tracks.map(track => {
      const trackSubtitles = this.subtitles
        .map((subtitle, index) => ({ subtitle, index }))
        .filter(({ subtitle }) => (subtitle.track || 'main') === track.id);
      return { track, items: trackSubtitles };
    });

    // 渲染每个轨道的字幕条
    const renderTrackItems = (trackItems, track) => {
      if (trackItems.length === 0) return '';
      return trackItems.map(({ subtitle, index }) => {
        const left = timeToPixel(subtitle.startTime);
        const width = Math.max(40, timeToPixel(subtitle.endTime) - timeToPixel(subtitle.startTime));
        const isSelected = this.selectedSubtitleIndex === index;
        const hasTranslation = subtitle.translatedText && subtitle.translatedText.trim();
        const trackColor = track.color || 'var(--primary-color)';

        let textContent = '';
        if (displayMode === 'translated') {
          textContent = `<span class="timeline-item-text">${this.escapeHtml((subtitle.translatedText || subtitle.originalText).substring(0, 20))}</span>`;
        } else if (displayMode === 'original') {
          textContent = `<span class="timeline-item-text">${this.escapeHtml(subtitle.originalText.substring(0, 20))}</span>`;
        } else {
          const origText = subtitle.originalText.substring(0, 20);
          const transText = subtitle.translatedText ? subtitle.translatedText.substring(0, 20) : '';
          if (transText) {
            textContent = `
              <div class="timeline-item-bilingual">
                <span class="timeline-item-original">${this.escapeHtml(origText)}</span>
                <span class="timeline-item-translated">${this.escapeHtml(transText)}</span>
              </div>
            `;
          } else {
            textContent = `<span class="timeline-item-text">${this.escapeHtml(origText)}</span>`;
          }
        }

        return `
          <div class="timeline-item ${isSelected ? 'selected' : ''} ${hasTranslation ? 'translated' : ''} track-${track.id}"
               style="left: ${left}px; width: ${width}px; background-color: ${trackColor};"
               onclick="VibeSubtitles.selectSubtitle(${index})"
               title="${this.escapeHtml(subtitle.originalText.substring(0, 50))}">
            <span class="timeline-item-index">${index + 1}</span>
            ${textContent}
          </div>
        `;
      }).join('');
    };

    // 生成轨道车道
    const trackLanesHtml = trackLanes.map(({ track, items }) => {
      const trackColor = track.color || 'var(--primary-color)';
      return `
        <div class="timeline-lane" data-track="${track.id}">
          <div class="timeline-lane-label" style="color: ${trackColor}; border-left-color: ${trackColor};">
            <span class="lane-icon">${track.icon || '💬'}</span>
            <span class="lane-name">${track.name}</span>
            <span class="lane-count">${items.length}</span>
          </div>
          <div class="timeline-lane-track" style="width: ${totalWidth}px">
            ${renderTrackItems(items, track)}
          </div>
        </div>
      `;
    }).join('');

    // 根据缩放级别调整刻度间隔
    let stepSeconds;
    if (pixelsPerSecond > 200) stepSeconds = 1;
    else if (pixelsPerSecond > 100) stepSeconds = 2;
    else if (pixelsPerSecond > 50) stepSeconds = 5;
    else if (pixelsPerSecond > 20) stepSeconds = 10;
    else stepSeconds = 30;

    let marks = '';
    for (let t = 0; t <= duration; t += stepSeconds) {
      const left = t * pixelsPerSecond;
      marks += `<div class="ruler-mark" style="left: ${left}px"><span>${this.formatTime(t)}</span></div>`;
    }

    panel.innerHTML = `
      <div class="timeline-scroll-area multi-track">
        <div class="timeline-ruler" style="width: ${totalWidth}px">${marks}</div>
        <div class="timeline-lanes-container">
          <div id="timelinePlayhead" class="timeline-playhead"></div>
          ${trackLanesHtml}
        </div>
      </div>
    `;

    // 更新缩放标签
    const zoomLabel = document.querySelector('.timeline-zoom-label');
    if (zoomLabel) zoomLabel.textContent = `缩放: ${Math.round(zoom * 100)}%`;
    
    // 重新更新播放进度竖线
    const video2 = document.getElementById('subtitleVideo');
    if (video2 && !isNaN(video2.duration)) {
      this.updateTimelinePlayhead(video2.currentTime);
    }
  },

  // 时间轴视图渲染（保留旧方法，不再直接使用）
  renderTimelineView(container) {
    const video = document.getElementById('subtitleVideo');
    const duration = (video && video.duration) ? video.duration : (this.subtitles.length > 0 ? this.subtitles[this.subtitles.length - 1].endTime : 60);

    // 获取当前缩放级别
    const zoom = this.timelineZoom || 1;
    // 计算可见时间范围（缩放越大，可见范围越小）
    const visibleDuration = duration / zoom;
    
    // 使用像素而非百分比来定位，支持横向滚动
    const pixelsPerSecond = 50 * zoom; // 基础每秒50px
    const totalWidth = duration * pixelsPerSecond;

    const timeToPixel = (t) => t * pixelsPerSecond;

    const items = this.subtitles.map((subtitle, index) => {
      const left = timeToPixel(subtitle.startTime);
      const width = Math.max(40, timeToPixel(subtitle.endTime) - timeToPixel(subtitle.startTime));
      const isSelected = this.selectedSubtitleIndex === index;
      const hasTranslation = subtitle.translatedText && subtitle.translatedText.trim();

      return `
        <div class="timeline-item ${isSelected ? 'selected' : ''} ${hasTranslation ? 'translated' : ''}"
             style="left: ${left}px; width: ${width}px"
             onclick="VibeSubtitles.selectSubtitle(${index})"
             title="${this.escapeHtml(subtitle.originalText.substring(0, 50))}">
          <span class="timeline-item-index">${index + 1}</span>
          <span class="timeline-item-text">${this.escapeHtml(subtitle.originalText.substring(0, 30))}</span>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="timeline-view-container">
        <div class="timeline-toolbar-row">
          <div class="timeline-zoom-controls">
            <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.timelineZoomIn()" title="放大时间轴">🔍➕ 放大</button>
            <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.timelineZoomOut()" title="缩小时间轴">🔍➖ 缩小</button>
            <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.timelineZoomReset()" title="还原时间轴">🔄 还原</button>
            <span class="timeline-zoom-label">缩放: ${Math.round(zoom * 100)}%</span>
          </div>
        </div>
        <div class="timeline-scroll-area">
          <div class="timeline-ruler" id="timelineRuler" style="width: ${totalWidth}px"></div>
          <div class="timeline-track" id="timelineTrack" style="width: ${totalWidth}px">
            ${items}
          </div>
        </div>
        <div class="timeline-details" id="timelineDetails">
          ${this.selectedSubtitleIndex >= 0 ? this.renderTimelineDetails() : '<p class="timeline-hint">点击字幕块查看详情</p>'}
        </div>
      </div>
    `;

    this.renderTimelineRuler(duration, pixelsPerSecond);
  },

  renderTimelineRuler(duration, pixelsPerSecond) {
    const ruler = document.getElementById('timelineRuler');
    if (!ruler) return;

    // 根据缩放级别调整刻度间隔
    let stepSeconds;
    if (pixelsPerSecond > 200) stepSeconds = 1;
    else if (pixelsPerSecond > 100) stepSeconds = 2;
    else if (pixelsPerSecond > 50) stepSeconds = 5;
    else if (pixelsPerSecond > 20) stepSeconds = 10;
    else stepSeconds = 30;

    let marks = '';
    for (let t = 0; t <= duration; t += stepSeconds) {
      const left = t * pixelsPerSecond;
      marks += `<div class="ruler-mark" style="left: ${left}px"><span>${this.formatTime(t)}</span></div>`;
    }
    ruler.innerHTML = marks;
  },

  timelineZoomIn() {
    this.timelineZoom = Math.min(10, (this.timelineZoom || 1) * 1.5);
    this.renderTimeline();
  },

  timelineZoomOut() {
    this.timelineZoom = Math.max(0.2, (this.timelineZoom || 1) / 1.5);
    this.renderTimeline();
  },

  timelineZoomReset() {
    this.timelineZoom = 1;
    this.renderTimeline();
  },

  renderTimelineDetails() {
    const subtitle = this.subtitles[this.selectedSubtitleIndex];
    if (!subtitle) return '';

    return `
      <div class="timeline-detail-card">
        <div class="timeline-detail-header">
          <span class="timeline-detail-index">#${this.selectedSubtitleIndex + 1}</span>
          <span class="timeline-detail-time">${this.formatTime(subtitle.startTime)} → ${this.formatTime(subtitle.endTime)}</span>
          <div class="timeline-detail-actions">
            <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.seekToSubtitle(${this.selectedSubtitleIndex})">▶️ 跳转</button>
            <button class="btn btn-primary btn-sm" onclick="VibeSubtitles.translateSingle(${this.selectedSubtitleIndex})">🌐 翻译</button>
          </div>
        </div>
        <div class="timeline-detail-body">
          <div class="timeline-detail-row">
            <label>原文</label>
            <textarea rows="2" onclick="event.stopPropagation()" oninput="VibeSubtitles.updateSubtitleField(${this.selectedSubtitleIndex}, 'originalText', this.value)">${this.escapeHtml(subtitle.originalText)}</textarea>
          </div>
          <div class="timeline-detail-row">
            <label>译文</label>
            <textarea rows="2" onclick="event.stopPropagation()" oninput="VibeSubtitles.updateSubtitleField(${this.selectedSubtitleIndex}, 'translatedText', this.value)" placeholder="点击翻译按钮生成译文...">${this.escapeHtml(subtitle.translatedText || '')}</textarea>
          </div>
        </div>
      </div>
    `;
  },

  seekToSubtitle(index) {
    const subtitle = this.subtitles[index];
    if (!subtitle) return;
    const video = document.getElementById('subtitleVideo');
    if (video) {
      video.currentTime = subtitle.startTime;
      video.play();
    }
  },

  updateSubtitleField(index, field, value) {
    if (this.subtitles[index]) {
      this.subtitles[index][field] = value;
    }
  },

  handleSubtitleClick(index, event) {
    if (event.target.classList.contains('subtitle-checkbox') || 
        event.target.tagName === 'SELECT' || 
        event.target.tagName === 'OPTION' ||
        event.target.tagName === 'TEXTAREA' ||
        event.target.tagName === 'INPUT') {
      event.stopPropagation();
      return;
    }
    
    this.selectSubtitle(index);
  },
  
  toggleSelect(index, checked) {
    if (checked) {
      if (!this.selectedIndices.includes(index)) {
        this.selectedIndices.push(index);
      }
    } else {
      this.selectedIndices = this.selectedIndices.filter(i => i !== index);
    }
    // 仅更新表格选中状态和批量条，不重建工具栏（避免搜索框失焦）
    this.renderTimelineBody();
    this.updateBatchBarOnly();
  },

  toggleSelectAll(checked) {
    if (checked) {
      // 仅选中当前过滤后的字幕
      const visibleIndices = [];
      this.subtitles.forEach((subtitle, index) => {
        if ((subtitle.track || 'main') !== this.currentTrack) return;
        if (this.timelineSearchQuery && this.timelineSearchQuery.trim()) {
          const q = this.timelineSearchQuery.toLowerCase().trim();
          if (!(subtitle.originalText || '').toLowerCase().includes(q) &&
              !(subtitle.translatedText || '').toLowerCase().includes(q)) return;
        }
        if (this.timelineFilterTranslated !== 'all') {
          const has = subtitle.translatedText && subtitle.translatedText.trim();
          if (this.timelineFilterTranslated === 'translated' ? !has : has) return;
        }
        visibleIndices.push(index);
      });
      this.selectedIndices = visibleIndices;
    } else {
      this.selectedIndices = [];
    }
    this.renderTimelineBody();
    this.updateBatchBarOnly();
  },
  
  jumpToSubtitle(index) {
    const subtitle = this.subtitles[index];
    if (subtitle) {
      const video = document.getElementById('subtitleVideo');
      video.currentTime = subtitle.startTime;
      video.play();
    }
  },
  
  // 添加文化背景注释（选中字幕，弹出输入框，存入注释轨道）
  addCulturalAnnotation(index) {
    const subtitle = this.subtitles[index];
    if (!subtitle) return;
    const existing = document.getElementById('culturalAnnotationModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'culturalAnnotationModal';
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 500px;">
        <button class="modal-close-btn" onclick="document.getElementById('culturalAnnotationModal').remove()">✕</button>
        <h3 style="margin-bottom: 8px;">📝 添加背景注释</h3>
        <p style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 12px;">
          选中字幕时间：${this.formatTime(subtitle.startTime)} → ${this.formatTime(subtitle.endTime)}
        </p>
        <div class="form-group">
          <label>注释内容</label>
          <textarea id="culturalAnnotationText" class="form-input" rows="4" placeholder="例如：此处的「老铁」是东北方言，意为「好朋友」" autofocus></textarea>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" id="culturalAnnotationUseSelection" ${window.getSelection()?.toString() ? 'checked' : ''}>
            使用当前选中的文本作为注释来源
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('culturalAnnotationModal').remove()">取消</button>
          <button class="btn btn-primary" onclick="VibeSubtitles.confirmCulturalAnnotation(${index})">添加到注释轨道</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    // 若有选中文本，预填
    const sel = window.getSelection()?.toString();
    if (sel) document.getElementById('culturalAnnotationText').value = sel;
  },

  confirmCulturalAnnotation(index) {
    const text = document.getElementById('culturalAnnotationText').value.trim();
    if (!text) {
      VibeApp.showToast('请输入注释内容', 'error');
      return;
    }
    const subtitle = this.subtitles[index];
    if (!subtitle) return;
    const annotationTrack = this.getTrackDef('annotation');
    const style = annotationTrack?.style || {};
    const newAnnotation = {
      id: Date.now() + Math.random(),
      startTime: subtitle.startTime,
      endTime: subtitle.endTime,
      originalText: text,
      translatedText: '',
      translationSource: null,
      track: 'annotation',
      style: { ...style },
      isLoading: false,
      parentSubtitleId: subtitle.id,
      isCultural: true
    };
    this.subtitles.push(newAnnotation);
    this.sortSubtitles();
    this.saveSubtitles();
    this.renderTrackTabs();
    this.renderTimeline();
    document.getElementById('culturalAnnotationModal').remove();
    VibeApp.showToast('已添加背景注释到剧情注释轨道', 'success');
  },

  splitSubtitle(index) {
    const subtitle = this.subtitles[index];
    if (!subtitle) return;
    
    let textarea;
    if (this.currentEditingIndex === index) {
      textarea = document.querySelector(`.subtitle-item[data-index="${index}"] .subtitle-textarea`);
    } else {
      const originalTextarea = document.querySelector(`.subtitle-item[data-index="${index}"] .subtitle-textarea:not(.translation)`);
      const translationTextarea = document.querySelector(`.subtitle-item[data-index="${index}"] .subtitle-textarea.translation`);
      textarea = originalTextarea || translationTextarea;
    }
    
    const cursorPos = textarea ? textarea.selectionStart : subtitle.originalText.length / 2;
    const splitPos = Math.floor(cursorPos);
    
    if (splitPos <= 0 || splitPos >= subtitle.originalText.length) {
      VibeApp.showToast('请在字幕文本中设置光标位置进行拆分', 'info');
      return;
    }
    
    const midTime = subtitle.startTime + (subtitle.endTime - subtitle.startTime) / 2;
    
    const newSubtitle1 = {
      ...subtitle,
      endTime: midTime,
      originalText: subtitle.originalText.substring(0, splitPos),
      translatedText: subtitle.translatedText ? subtitle.translatedText.substring(0, Math.floor(subtitle.translatedText.length * splitPos / subtitle.originalText.length)) : ''
    };
    
    const newSubtitle2 = {
      ...subtitle,
      startTime: midTime,
      originalText: subtitle.originalText.substring(splitPos),
      translatedText: subtitle.translatedText ? subtitle.translatedText.substring(Math.floor(subtitle.translatedText.length * splitPos / subtitle.originalText.length)) : ''
    };
    
    this.subtitles.splice(index, 1, newSubtitle1, newSubtitle2);
    this.sortSubtitles();
    this.renderTimeline();
    VibeApp.showToast('字幕已拆分', 'success');
  },
  
  batchDelete() {
    if (this.selectedIndices.length === 0) return;
    
    const deletedSubtitles = [];
    const indices = [...this.selectedIndices].sort((a, b) => a - b);
    
    indices.forEach(idx => {
      deletedSubtitles.push({ ...this.subtitles[idx] });
    });
    
    const action = VibeUndo.createDeleteAction(deletedSubtitles, indices);
    VibeUndo.push(action);
    
    this.subtitles = this.subtitles.filter((_, i) => !this.selectedIndices.includes(i));
    this.selectedIndices = [];
    this.renderTimeline();
    VibeApp.showToast(`已删除 ${deletedSubtitles.length} 条字幕`, 'success');
  },
  
  batchTimeOffset() {
    const targetIndices = this.selectedIndices.length > 0 ? this.selectedIndices : this.subtitles.map((_, i) => i);
    
    if (targetIndices.length === 0) return;
    
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-modal">
        <h3>批量时间偏移</h3>
        <p>将影响 ${targetIndices.length} 条字幕</p>
        <div class="form-group">
          <label>偏移量（毫秒）</label>
          <input type="number" class="form-input" id="batchOffsetValue" placeholder="例如：1000 或 -500">
          <p class="form-hint">正数 = 延后，负数 = 提前</p>
        </div>
        <div class="confirm-options">
          <button class="btn btn-secondary" onclick="VibeSubtitles.closeBatchModal()">取消</button>
          <button class="btn btn-primary" onclick="VibeSubtitles.executeBatchTimeOffset()">执行</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  },
  
  executeBatchTimeOffset() {
    const offsetMs = parseFloat(document.getElementById('batchOffsetValue').value);
    if (isNaN(offsetMs)) {
      VibeApp.showToast('请输入有效的偏移量', 'error');
      return;
    }
    
    const targetIndices = this.selectedIndices.length > 0 ? this.selectedIndices : this.subtitles.map((_, i) => i);
    const offsetSeconds = offsetMs / 1000;
    
    const originals = [];
    targetIndices.forEach(idx => {
      originals.push({
        id: this.subtitles[idx].id,
        originalStart: this.subtitles[idx].startTime,
        originalEnd: this.subtitles[idx].endTime
      });
    });
    
    const action = {
      type: 'batch_time_offset',
      originals,
      offsetSeconds,
      undo: () => {
        originals.forEach(item => {
          const idx = this.subtitles.findIndex(s => s.id === item.id);
          if (idx !== -1) {
            this.subtitles[idx].startTime = item.originalStart;
            this.subtitles[idx].endTime = item.originalEnd;
          }
        });
        this.sortSubtitles();
        this.renderTimeline();
        this.updateUI();
      },
      redo: () => {
        originals.forEach(item => {
          const idx = this.subtitles.findIndex(s => s.id === item.id);
          if (idx !== -1) {
            this.subtitles[idx].startTime = item.originalStart + offsetSeconds;
            this.subtitles[idx].endTime = item.originalEnd + offsetSeconds;
          }
        });
        this.sortSubtitles();
        this.renderTimeline();
        this.updateUI();
      }
    };
    VibeUndo.push(action);
    
    targetIndices.forEach(idx => {
      this.subtitles[idx].startTime += offsetSeconds;
      this.subtitles[idx].endTime += offsetSeconds;
    });
    
    this.sortSubtitles();
    this.renderTimeline();
    this.closeBatchModal();
    
    VibeApp.showToast(`已偏移 ${offsetMs > 0 ? '延后' : '提前'} ${Math.abs(offsetMs)} 毫秒`, 'success');
  },
  
  batchFindReplace() {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-modal">
        <h3>批量查找替换</h3>
        <div class="form-group">
          <label>查找内容</label>
          <input type="text" class="form-input" id="findText" placeholder="输入要查找的文本">
        </div>
        <div class="form-group">
          <label>替换为</label>
          <input type="text" class="form-input" id="replaceText" placeholder="输入替换后的文本">
        </div>
        <div class="form-group">
          <label>作用范围</label>
          <div>
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="radio" name="replaceScope" value="source" checked>
              <span>仅原文</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="radio" name="replaceScope" value="target">
              <span>仅译文</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="radio" name="replaceScope" value="both">
              <span>原文和译文</span>
            </label>
          </div>
        </div>
        <div class="form-group">
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="caseSensitive">
            <span>区分大小写</span>
          </label>
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="wholeWord">
            <span>全字匹配</span>
          </label>
        </div>
        <div class="form-group">
          <label>应用范围</label>
          <div>
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="radio" name="applyScope" value="all" checked>
              <span>全部字幕</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="radio" name="applyScope" value="selected">
              <span>仅选中字幕（${this.selectedIndices.length}条）</span>
            </label>
          </div>
        </div>
        <div class="confirm-options">
          <button class="btn btn-secondary" onclick="VibeSubtitles.closeBatchModal()">取消</button>
          <button class="btn btn-primary" onclick="VibeSubtitles.executeFindReplace()">执行</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  },
  
  executeFindReplace() {
    const findText = document.getElementById('findText').value;
    const replaceText = document.getElementById('replaceText').value;
    const scope = document.querySelector('input[name="replaceScope"]:checked').value;
    const applyScope = document.querySelector('input[name="applyScope"]:checked').value;
    const caseSensitive = document.getElementById('caseSensitive').checked;
    const wholeWord = document.getElementById('wholeWord').checked;
    
    if (!findText) {
      VibeApp.showToast('请输入查找内容', 'error');
      return;
    }
    
    const targetIndices = applyScope === 'selected' && this.selectedIndices.length > 0 
      ? this.selectedIndices 
      : this.subtitles.map((_, i) => i);
    
    const flags = caseSensitive ? 'g' : 'gi';
    const pattern = wholeWord ? new RegExp(`\\b${findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, flags) 
      : new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    
    const changes = [];
    let count = 0;
    
    targetIndices.forEach(idx => {
      const subtitle = this.subtitles[idx];
      const oldSource = subtitle.originalText;
      const oldTarget = subtitle.translatedText;
      
      if (scope === 'source' || scope === 'both') {
        subtitle.originalText = subtitle.originalText.replace(pattern, replaceText);
        if (subtitle.originalText !== oldSource) count++;
      }
      
      if (scope === 'target' || scope === 'both') {
        subtitle.translatedText = subtitle.translatedText.replace(pattern, replaceText);
        if (subtitle.translatedText !== oldTarget) count++;
      }
      
      if (subtitle.originalText !== oldSource || subtitle.translatedText !== oldTarget) {
        changes.push({ idx, oldSource, oldTarget });
      }
    });
    
    if (changes.length > 0) {
      const action = {
        type: 'find_replace',
        changes,
        undo: () => {
          changes.forEach(item => {
            this.subtitles[item.idx].originalText = item.oldSource;
            this.subtitles[item.idx].translatedText = item.oldTarget;
          });
          this.renderTimeline();
          this.updateUI();
        },
        redo: () => {
          this.executeFindReplace();
        }
      };
      VibeUndo.push(action);
    }
    
    this.renderTimeline();
    this.closeBatchModal();
    VibeApp.showToast(`已替换 ${count} 处文本`, 'success');
  },
  
  batchCleanup() {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-modal">
        <h3>批量清理</h3>
        <div class="form-group">
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="cleanEmpty" checked>
            <span>删除空行（原文译文均为空）</span>
          </label>
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="cleanDuplicate">
            <span>删除完全重复的字幕</span>
          </label>
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="cleanShort">
            <span>删除短字幕（时长 < 0.3秒）</span>
          </label>
        </div>
        <div class="confirm-options">
          <button class="btn btn-secondary" onclick="VibeSubtitles.closeBatchModal()">取消</button>
          <button class="btn btn-danger" onclick="VibeSubtitles.executeCleanup()">执行清理</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  },
  
  executeCleanup() {
    const cleanEmpty = document.getElementById('cleanEmpty').checked;
    const cleanDuplicate = document.getElementById('cleanDuplicate').checked;
    const cleanShort = document.getElementById('cleanShort').checked;
    
    if (!cleanEmpty && !cleanDuplicate && !cleanShort) {
      VibeApp.showToast('请至少选择一项清理选项', 'error');
      return;
    }
    
    const beforeCount = this.subtitles.length;
    const deleted = [];
    const seen = new Set();
    
    this.subtitles = this.subtitles.filter((subtitle, idx) => {
      const textKey = `${subtitle.originalText}-${subtitle.translatedText}`;
      
      if (cleanEmpty && !subtitle.originalText.trim() && !subtitle.translatedText.trim()) {
        deleted.push({ ...subtitle, originalIndex: idx });
        return false;
      }
      
      if (cleanDuplicate && seen.has(textKey)) {
        deleted.push({ ...subtitle, originalIndex: idx });
        return false;
      }
      seen.add(textKey);
      
      if (cleanShort && (subtitle.endTime - subtitle.startTime) < 0.3) {
        deleted.push({ ...subtitle, originalIndex: idx });
        return false;
      }
      
      return true;
    });
    
    if (deleted.length > 0) {
      const action = {
        type: 'cleanup',
        deleted,
        undo: () => {
          deleted.forEach(item => {
            this.subtitles.splice(item.originalIndex, 0, item);
          });
          this.sortSubtitles();
          this.renderTimeline();
          this.updateUI();
        },
        redo: () => {
          this.executeCleanup();
        }
      };
      VibeUndo.push(action);
    }
    
    this.renderTimeline();
    this.closeBatchModal();
    VibeApp.showToast(`清理完成，删除 ${deleted.length} 条字幕`, 'success');
  },
  
  batchMerge() {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-modal">
        <h3>批量合并短字幕</h3>
        <div class="form-group">
          <label>时长阈值（秒）</label>
          <input type="number" class="form-input" id="mergeThreshold" value="1" min="0.1" step="0.1">
          <p class="form-hint">时长小于此值的相邻字幕将被合并</p>
        </div>
        <div class="form-group">
          <label>应用范围</label>
          <div>
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="radio" name="mergeScope" value="all" checked>
              <span>全部字幕</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="radio" name="mergeScope" value="selected">
              <span>仅选中字幕（${this.selectedIndices.length}条）</span>
            </label>
          </div>
        </div>
        <div class="confirm-options">
          <button class="btn btn-secondary" onclick="VibeSubtitles.closeBatchModal()">取消</button>
          <button class="btn btn-primary" onclick="VibeSubtitles.executeMerge()">执行合并</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  },
  
  executeMerge() {
    const threshold = parseFloat(document.getElementById('mergeThreshold').value);
    if (isNaN(threshold) || threshold <= 0) {
      VibeApp.showToast('请输入有效的阈值', 'error');
      return;
    }
    
    const mergeScope = document.querySelector('input[name="mergeScope"]:checked').value;
    
    let targetSubtitles;
    let baseIndex = 0;
    
    if (mergeScope === 'selected' && this.selectedIndices.length > 0) {
      targetSubtitles = this.selectedIndices.map(i => ({ ...this.subtitles[i], originalIndex: i })).sort((a, b) => a.startTime - b.startTime);
      baseIndex = targetSubtitles[0]?.originalIndex || 0;
    } else {
      targetSubtitles = this.subtitles.map((s, i) => ({ ...s, originalIndex: i }));
    }
    
    if (targetSubtitles.length < 2) {
      VibeApp.showToast('至少需要2条字幕才能合并', 'info');
      this.closeBatchModal();
      return;
    }
    
    const mergedPairs = [];
    const result = [];
    let i = 0;
    
    while (i < targetSubtitles.length) {
      let current = targetSubtitles[i];
      let merged = false;
      
      while (i + 1 < targetSubtitles.length && 
             (targetSubtitles[i + 1].startTime - current.endTime < 0.5) && 
             (current.endTime - current.startTime < threshold)) {
        
        const next = targetSubtitles[i + 1];
        mergedPairs.push([{ ...current }, { ...next }]);
        
        current = {
          ...current,
          endTime: next.endTime,
          originalText: current.originalText + ' ' + next.originalText,
          translatedText: current.translatedText + ' ' + next.translatedText
        };
        
        i++;
        merged = true;
      }
      
      result.push(current);
      i++;
    }
    
    if (!merged) {
      VibeApp.showToast('没有符合条件的短字幕可合并', 'info');
      this.closeBatchModal();
      return;
    }
    
    const oldSubtitles = [...this.subtitles];
    
    if (mergeScope === 'selected') {
      const selectedIds = new Set(this.selectedIndices.map(i => this.subtitles[i].id));
      const nonSelected = this.subtitles.filter(s => !selectedIds.has(s.id));
      this.subtitles = [...nonSelected, ...result.map(r => ({ id: r.id, startTime: r.startTime, endTime: r.endTime, originalText: r.originalText, translatedText: r.translatedText }))];
    } else {
      this.subtitles = result.map(r => ({ id: r.id, startTime: r.startTime, endTime: r.endTime, originalText: r.originalText, translatedText: r.translatedText }));
    }
    
    this.sortSubtitles();
    
    const action = {
      type: 'merge',
      oldSubtitles,
      newSubtitles: [...this.subtitles],
      undo: () => {
        this.subtitles = oldSubtitles;
        this.renderTimeline();
        this.updateUI();
      },
      redo: () => {
        this.subtitles = [...this.newSubtitles];
        this.sortSubtitles();
        this.renderTimeline();
        this.updateUI();
      }
    };
    VibeUndo.push(action);
    
    this.renderTimeline();
    this.closeBatchModal();
    VibeApp.showToast(`合并完成，共合并 ${mergedPairs.length} 组字幕`, 'success');
  },
  
  closeBatchModal() {
    const overlay = document.querySelector('.confirm-overlay');
    if (overlay) overlay.remove();
  },
  
  validateSubtitles() {
    const issues = [];
    
    this.subtitles.forEach((subtitle, index) => {
      const duration = subtitle.endTime - subtitle.startTime;
      const sourceChars = subtitle.originalText.replace(/\s/g, '').length;
      const targetChars = subtitle.translatedText.replace(/\s/g, '').length;
      
      if (!subtitle.originalText.trim()) {
        issues.push({
          type: 'error',
          index,
          message: `第 ${index + 1} 条：原文为空`
        });
      }
      
      if (!subtitle.translatedText.trim()) {
        issues.push({
          type: 'warning',
          index,
          message: `第 ${index + 1} 条：译文为空`
        });
      }
      
      if (duration < 0.3) {
        issues.push({
          type: 'warning',
          index,
          message: `第 ${index + 1} 条：时长过短（${duration.toFixed(2)}秒）`
        });
      }
      
      if (sourceChars > 0 && duration > 0) {
        const charsPerSecond = sourceChars / duration;
        if (charsPerSecond > 5) {
          issues.push({
            type: 'warning',
            index,
            message: `第 ${index + 1} 条：语速超标（${charsPerSecond.toFixed(1)}字/秒）`
          });
        }
      }
      
      if (sourceChars > 0 && targetChars > 0) {
        const ratio = Math.max(sourceChars, targetChars) / Math.min(sourceChars, targetChars);
        if (ratio > 3) {
          issues.push({
            type: 'warning',
            index,
            message: `第 ${index + 1} 条：原文译文长度差异过大`
          });
        }
      }
    });
    
    const sourceMap = {};
    this.subtitles.forEach((subtitle, index) => {
      const text = subtitle.originalText.trim();
      if (text) {
        if (!sourceMap[text]) sourceMap[text] = [];
        sourceMap[text].push(index);
      }
    });
    
    Object.values(sourceMap).forEach(indices => {
      if (indices.length > 1) {
        const translations = new Set(indices.map(i => this.subtitles[i].translatedText.trim()));
        if (translations.size > 1) {
          issues.push({
            type: 'warning',
            index: indices[0],
            message: `第 ${indices.map(i => i + 1).join(', ')} 条：相同原文但译文不一致`
          });
        }
      }
    });
    
    if (issues.length === 0) {
      VibeApp.showToast('✓ 所有字幕校验通过', 'success');
      return;
    }
    
    const errorCount = issues.filter(i => i.type === 'error').length;
    const warningCount = issues.filter(i => i.type === 'warning').length;
    
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-modal" style="max-width: 500px; max-height: 70vh;">
        <h3>字幕校验结果</h3>
        <p>共发现 <span style="color: #ff4d4f;">${errorCount} 个错误</span> 和 <span style="color: #faad14;">${warningCount} 个警告</span></p>
        <div class="validation-results" style="max-height: 400px; overflow-y: auto; margin-top: 12px;">
          ${issues.map((issue, idx) => `
            <div class="validation-item ${issue.type}" style="display: flex; align-items: center; gap: 8px; padding: 8px; margin-bottom: 4px; background-color: ${issue.type === 'error' ? 'rgba(255,77,79,0.08)' : 'rgba(250,173,20,0.08)'};">
              <span style="font-size: 14px;">${issue.type === 'error' ? '❌' : '⚠️'}</span>
              <span style="flex: 1; font-size: 13px;">${issue.message}</span>
              <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.jumpToSubtitle(${issue.index}); VibeSubtitles.closeValidationModal();">定位</button>
            </div>
          `).join('')}
        </div>
        <div class="confirm-options" style="margin-top: 16px;">
          <button class="btn btn-secondary" onclick="VibeSubtitles.closeValidationModal()">关闭</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  },
  
  closeValidationModal() {
    const overlay = document.querySelector('.confirm-overlay');
    if (overlay) overlay.remove();
  },
  
  batchAddToCorpus() {
    if (this.selectedIndices.length === 0) return;
    
    const selectedSubtitles = this.selectedIndices.map(i => this.subtitles[i]).filter(s => s.translatedText);
    
    if (selectedSubtitles.length === 0) {
      VibeApp.showToast('请选择有译文的字幕', 'info');
      return;
    }
    
    const items = selectedSubtitles.map(subtitle => ({
      sourceText: subtitle.originalText,
      targetText: subtitle.translatedText,
      sourceLang: this.sourceLanguage,
      targetLang: this.targetLanguage
    }));
    
    VibeCorpus.addWithConfirmation(items, 'subtitle', '影视');
  },
  
  batchAddToMemory() {
    if (this.selectedIndices.length === 0) return;
    
    const selectedSubtitles = this.selectedIndices.map(i => this.subtitles[i]).filter(s => s.translatedText);
    
    if (selectedSubtitles.length === 0) {
      VibeApp.showToast('请选择有译文的字幕', 'info');
      return;
    }
    
    const tag = prompt('请输入记忆库标签（可选）');

    selectedSubtitles.forEach(subtitle => {
      if (subtitle.translatedText) {
        // 使用标准 add 方法，自动生成时间戳
        VibeMemory.add(subtitle.originalText, subtitle.translatedText, 'auto', 'auto');
      }
    });
    
    VibeApp.showToast(`已添加 ${selectedSubtitles.length} 条记忆`, 'success');
  },
  
  // 更新开始时间
  updateStartTime(index, value) {
    const time = this.parseTimeFromInput(value);
    if (!isNaN(time) && time >= 0) {
      this.subtitles[index].startTime = time;
      this.sortSubtitles();
      this.renderTimeline();
    }
  },
  
  // 更新结束时间
  updateEndTime(index, value) {
    const time = this.parseTimeFromInput(value);
    if (!isNaN(time) && time >= 0) {
      this.subtitles[index].endTime = time;
      this.sortSubtitles();
      this.renderTimeline();
    }
  },
  
  // 从输入框解析时间（mm:ss.ms格式）
  parseTimeFromInput(value) {
    const match = value.match(/(\d+):(\d+)\.(\d+)/);
    if (match) {
      const m = parseInt(match[1]) || 0;
      const s = parseInt(match[2]) || 0;
      const ms = parseInt(match[3]) || 0;
      return m * 60 + s + ms / 100;
    }
    return NaN;
  },
  
  // 更新原文
  updateOriginalText(index, value) {
    this.subtitles[index].originalText = value;
  },
  
  // 更新译文
  updateTranslatedText(index, value) {
    this.subtitles[index].translatedText = value;
    if (value) {
      this.subtitles[index].translationSource = 'manual';
    } else {
      this.subtitles[index].translationSource = null;
    }
    this.renderTimeline();
  },
  
  // 删除字幕
  deleteSubtitle(index) {
    if (confirm('确定要删除这条字幕吗？')) {
      const deletedSubtitle = this.subtitles[index];
      const previewText = deletedSubtitle ? (deletedSubtitle.originalText || '').substring(0, 20) : '';

      this.subtitles.splice(index, 1);

      // 创建快照
      if (typeof VibeSnapshot !== 'undefined') {
        VibeSnapshot.createSnapshot('delete', VibeSnapshot.generateDescription('delete', index), previewText);
      }

      // 如果删除的是选中的字幕，清除选中状态
      if (this.selectedSubtitleIndex === index) {
        this.selectedSubtitleIndex = -1;
        if (!this.isGlobalStyle) {
          document.getElementById('editingSubtitleIndex').textContent = '-';
        }
      } else if (this.selectedSubtitleIndex > index) {
        this.selectedSubtitleIndex--;
      }

      this.renderTimeline();
      this.updateUI();
      VibeApp.showToast('删除成功', 'success');
    }
  },
  
  // 视频时间更新时
  onVideoTimeUpdate(currentTime) {
    // 更新当前时间显示（元素可能不存在，需检查）
    const timeDisplay = document.getElementById('currentTimeDisplay');
    if (timeDisplay) {
      timeDisplay.textContent = '当前: ' + this.formatTime(currentTime);
    }
    
    // 更新时间轴播放进度指示竖线
    this.updateTimelinePlayhead(currentTime);
    
    // 更新卡拉OK进度
    this.updateKaraokeProgress(currentTime);
    
    // 找到当前时间对应的字幕
    const subtitle = this.subtitles.find(s => 
      currentTime >= s.startTime && currentTime <= s.endTime
    );
    
    if (subtitle) {
      const index = this.subtitles.indexOf(subtitle);
      if (index !== this.currentSubtitleIndex) {
        this.currentSubtitleIndex = index;
        this.renderTimeline();
      }
      this.showOverlay(subtitle);
      this.renderCharDisplay();
    } else {
      this.currentSubtitleIndex = -1;
      this.hideOverlay();
      this.renderTimeline();
      this.renderCharDisplay();
    }
  },
  
  // 更新时间轴播放进度指示竖线位置
  updateTimelinePlayhead(currentTime) {
    const playhead = document.getElementById('timelinePlayhead');
    const video = document.getElementById('subtitleVideo');
    
    if (!playhead || !video || isNaN(video.duration) || video.duration <= 0) {
      if (playhead) playhead.style.display = 'none';
      return;
    }
    
    if (this.subtitles.length === 0) {
      playhead.style.display = 'none';
      return;
    }
    
    const zoom = this.timelineZoom || 1;
    const pixelsPerSecond = 50 * zoom;
    const leftPx = currentTime * pixelsPerSecond;
    
    playhead.style.left = leftPx + 'px';
    playhead.style.display = 'block';
  },
  
  // 显示字幕叠加层
  showOverlay(subtitle) {
    const overlay = document.getElementById('subtitleOverlay');
    const originalEl = document.getElementById('overlayOriginal') || document.getElementById('subtitleOriginal');
    const translatedEl = document.getElementById('overlayTranslated') || document.getElementById('subtitleTranslated');
    
    if (!overlay || !originalEl || !translatedEl) return;
    
    const style = this.getEffectiveStyle(subtitle);
    
    const position = parseInt(style.position) || 10;
    const horizontalPosition = parseInt(style.horizontalPosition) || 50;
    const origHOffset = parseInt(style.originalHorizontalOffset) || 0;
    const transHOffset = parseInt(style.translatedHorizontalOffset) || 0;
    const textDirection = style.textDirection || 'horizontal';
    
    overlay.style.bottom = position + '%';
    overlay.style.left = horizontalPosition + '%';
    overlay.style.transform = 'translateX(-50%)';
    
    const strokeColor = style.strokeColor || '#000000';
    const strokeWidth = parseInt(style.strokeWidth) || 0;
    const shadowColor = style.shadowColor || '#000000';
    const shadowOffset = parseInt(style.shadowOffset) || 2;
    const shadowBlur = parseInt(style.shadowBlur) || 4;
    const useGradient = style.useGradient || false;
    const gradientStart = style.gradientStart || '#ffffff';
    const gradientEnd = style.gradientEnd || '#a0a0ff';
    const gradientDirection = style.gradientDirection || 'horizontal';
    const scrollMode = style.scrollMode || 'none';
    const scrollSpeed = parseInt(style.scrollSpeed) || 5;
    const bgOpacity = parseInt(style.bgOpacity) || 0;
    const bgColor = style.bgColor || '#000000';
    const letterSpacing = parseInt(style.letterSpacing) || 0;
    const lineHeight = parseInt(style.lineHeight) || 16;
    const karaokeEnabled = style.karaokeEnabled || false;
    const karaokeColor = style.karaokeColor || '#00ff00';
    const karaokeDimColor = style.karaokeDimColor || '#888888';
    const karaokeAnimation = style.karaokeAnimation || 'gradient';
    
    const textShadow = `${shadowOffset}px ${shadowOffset}px ${shadowBlur}px ${shadowColor}`;
    const webkitTextStroke = strokeWidth > 0 ? `${strokeWidth}px ${strokeColor}` : 'none';
    
    const getGradientStyle = (color) => {
      if (!useGradient) return color;
      if (gradientDirection === 'vertical') {
        return `linear-gradient(to bottom, ${gradientStart}, ${gradientEnd})`;
      } else if (gradientDirection === 'diagonal') {
        return `linear-gradient(to bottom right, ${gradientStart}, ${gradientEnd})`;
      }
      return `linear-gradient(to right, ${gradientStart}, ${gradientEnd})`;
    };
    
    const overlayBgOpacity = bgOpacity / 100;
    overlay.style.backgroundColor = overlayBgOpacity > 0 ? `${bgColor}${Math.round(overlayBgOpacity * 255).toString(16).padStart(2, '0')}` : 'transparent';
    overlay.style.padding = overlayBgOpacity > 0 ? '8px 16px' : '0';
    overlay.style.borderRadius = overlayBgOpacity > 0 ? '8px' : '0';
    
    const scrollAnimation = scrollMode === 'scrollLeft' 
      ? `scroll-left ${10 / scrollSpeed}s linear infinite`
      : scrollMode === 'scrollRight'
        ? `scroll-right ${10 / scrollSpeed}s linear infinite`
        : scrollMode === 'scrollUp'
          ? `scroll-up ${10 / scrollSpeed}s linear infinite`
          : 'none';
    
    const isScrolling = scrollMode !== 'none';
    overlay.classList.toggle('scrolling', isScrolling);
    overlay.style.animation = isScrolling ? scrollAnimation : 'none';
    
    const applyTextStyles = (element, text, charStyles, baseStyle) => {
      const effectiveColor = getGradientStyle(baseStyle.color);
      element.style.fontSize = baseStyle.fontSize + 'px';
      element.style.fontFamily = baseStyle.fontFamily || style.fontFamily;
      element.style.letterSpacing = (baseStyle.letterSpacing || letterSpacing) + 'px';
      element.style.lineHeight = lineHeight + 'px';
      element.style.textShadow = textShadow;
      element.style.webkitTextStroke = webkitTextStroke;
      element.style.webkitBackgroundClip = useGradient ? 'text' : 'border-box';
      element.style.webkitTextFillColor = useGradient ? 'transparent' : 'initial';
      element.style.background = useGradient ? effectiveColor : 'none';
      
      if (karaokeEnabled && text && subtitle.karaokeData) {
        element.innerHTML = this.renderKaraokeText(text, subtitle.karaokeData, style);
      } else {
        element.innerHTML = this.renderTextWithCharStyles(text, charStyles, {
          fontSize: baseStyle.fontSize,
          color: baseStyle.color,
          fontFamily: baseStyle.fontFamily || style.fontFamily,
          letterSpacing: baseStyle.letterSpacing || letterSpacing
        });
      }
    };
    
    const charStyles = subtitle.charStyles || { original: {}, translated: {} };
    
    applyTextStyles(originalEl, subtitle.originalText, charStyles.original, {
      fontSize: style.originalFontSize,
      color: style.originalColor,
      fontFamily: style.originalFontFamily || style.fontFamily,
      letterSpacing: style.originalLetterSpacing || 0
    });
    originalEl.style.marginBottom = style.originalVerticalOffset + 'px';
    originalEl.style.marginLeft = origHOffset + 'px';
    
    if (textDirection === 'vertical') {
      originalEl.classList.add('vertical');
    } else {
      originalEl.classList.remove('vertical');
    }
    
    applyTextStyles(translatedEl, subtitle.translatedText || '', charStyles.translated, {
      fontSize: style.translatedFontSize,
      color: style.translatedColor,
      fontFamily: style.translatedFontFamily || style.fontFamily,
      letterSpacing: style.translatedLetterSpacing || 0
    });
    translatedEl.style.marginTop = style.translatedVerticalOffset + 'px';
    translatedEl.style.marginLeft = transHOffset + 'px';
    
    if (textDirection === 'vertical') {
      translatedEl.classList.add('vertical');
    } else {
      translatedEl.classList.remove('vertical');
    }
    
    const displayMode = subtitle.displayMode || style.globalDisplayMode || 'bilingual';
    
    if (displayMode === 'sourceOnly' || displayMode === 'original') {
      originalEl.style.display = 'block';
      translatedEl.style.display = 'none';
    } else if (displayMode === 'targetOnly' || displayMode === 'translated') {
      originalEl.style.display = 'none';
      translatedEl.style.display = 'block';
    } else {
      originalEl.style.display = 'block';
      translatedEl.style.display = 'block';
    }
    
    overlay.classList.remove('hidden');
    
    // 渲染卡拉OK后立即更新进度
    if (karaokeEnabled && subtitle.karaokeData) {
      const video = document.getElementById('subtitleVideo');
      if (video && !isNaN(video.currentTime)) {
        this.updateKaraokeProgress(video.currentTime);
      }
    }
  },
  
  // 渲染卡拉OK文本（双层结构）
  renderKaraokeText(text, karaokeData, style) {
    if (!text || !karaokeData) return this.escapeHtml(text);
    
    const karaokeColor = style.karaokeColor || '#00ff00';
    const karaokeDimColor = style.karaokeDimColor || '#888888';
    
    const chars = text.split('');
    let dimChars = '';
    let highlightChars = '';
    
    chars.forEach((char, index) => {
      const charData = karaokeData[index];
      if (charData) {
        dimChars += `<span class="karaoke-char" data-index="${index}">${this.escapeHtml(char)}</span>`;
        highlightChars += `<span class="karaoke-highlight-char" data-index="${index}" 
          data-start="${charData.start}" data-end="${charData.end}"
          style="opacity: 0;">${this.escapeHtml(char)}</span>`;
      } else {
        dimChars += `<span class="karaoke-char">${this.escapeHtml(char)}</span>`;
        highlightChars += `<span class="karaoke-highlight-char" style="opacity: 0;">${this.escapeHtml(char)}</span>`;
      }
    });
    
    return `<div class="karaoke-container">
      <div class="karaoke-dim" style="color: ${karaokeDimColor}">${dimChars}</div>
      <div class="karaoke-highlight" style="color: ${karaokeColor}">${highlightChars}</div>
    </div>`;
  },
  
  // 自动生成逐字时间轴
  autoGenerateKaraoke() {
    if (this.subtitles.length === 0) {
      VibeApp.showToast('暂无字幕可处理', 'info');
      return;
    }
    
    VibeApp.showToast('正在生成逐字时间轴...', 'info');
    
    this.subtitles.forEach(subtitle => {
      const text = subtitle.originalText;
      if (!text || text.trim() === '') return;
      
      const duration = subtitle.endTime - subtitle.startTime;
      const chars = text.split('');
      const charDuration = duration / chars.length;
      
      subtitle.karaokeData = {};
      let currentTime = subtitle.startTime;
      
      chars.forEach((char, index) => {
        subtitle.karaokeData[index] = {
          start: currentTime,
          end: currentTime + charDuration
        };
        currentTime += charDuration;
      });
    });
    
    this.saveSubtitles();
    VibeApp.showToast(`已为 ${this.subtitles.length} 条字幕生成逐字时间轴`, 'success');
  },
  
  // 清除卡拉OK数据
  clearKaraoke() {
    if (this.subtitles.length === 0) {
      VibeApp.showToast('暂无字幕可处理', 'info');
      return;
    }
    
    this.subtitles.forEach(subtitle => {
      delete subtitle.karaokeData;
    });
    
    this.saveSubtitles();
    VibeApp.showToast('已清除所有卡拉OK数据', 'success');
  },
  
  // 应用卡拉OK样式
  applyKaraokeStyles() {
    if (this.currentSubtitleIndex >= 0) {
      this.showOverlay(this.subtitles[this.currentSubtitleIndex]);
    }
  },
  
  // 更新卡拉OK进度
  updateKaraokeProgress(currentTime) {
    const style = this.globalStyleSettings;
    if (!style.karaokeEnabled) return;
    
    const highlightChars = document.querySelectorAll('.karaoke-highlight-char');
    if (highlightChars.length === 0) return;
    
    const karaokeAnimation = style.karaokeAnimation || 'gradient';
    
    highlightChars.forEach(char => {
      const start = parseFloat(char.dataset.start);
      const end = parseFloat(char.dataset.end);
      
      if (!isNaN(start) && !isNaN(end)) {
        if (currentTime >= end) {
          // 已唱完的字符：完全高亮
          char.style.opacity = '1';
          char.style.transform = 'scale(1)';
          char.style.filter = 'none';
        } else if (currentTime >= start && currentTime <= end) {
          // 正在唱的字符：根据进度显示
          const progress = (currentTime - start) / (end - start);
          char.style.opacity = '1';
          
          if (karaokeAnimation === 'scale') {
            char.style.transform = `scale(${1 + progress * 0.15})`;
          } else if (karaokeAnimation === 'glow') {
            char.style.filter = `brightness(${1 + progress * 0.5}) drop-shadow(0 0 ${5 + progress * 10}px currentColor)`;
          } else {
            char.style.transform = 'scale(1)';
            char.style.filter = 'none';
          }
        } else {
          // 未唱的字符：隐藏高亮层
          char.style.opacity = '0';
          char.style.transform = 'scale(1)';
          char.style.filter = 'none';
        }
      } else {
        char.style.opacity = '0';
      }
    });
  },
  
  // 设置显示模式
  setDisplayMode(mode) {
    this.displayMode = mode;
    
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`.mode-btn[data-mode="${mode}"]`).classList.add('active');
    
    if (this.currentSubtitleIndex >= 0 && this.currentSubtitleIndex < this.subtitles.length) {
      this.showOverlay(this.subtitles[this.currentSubtitleIndex]);
    }
  },
  
  // 切换字幕视图模式（列表/对照编辑）
  switchSubtitleView(view) {
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`.view-mode-btn[data-view="${view}"]`).classList.add('active');
    
    const timelineScroll = document.querySelector('.timeline-scroll');
    const dualEditView = document.getElementById('dualEditView');
    
    if (view === 'table') {
      timelineScroll.style.display = 'block';
      dualEditView.classList.remove('active');
    } else if (view === 'dual') {
      timelineScroll.style.display = 'none';
      dualEditView.classList.add('active');
      if (this.subtitles.length > 0 && this.dualEditIndex < 0) {
        this.dualEditIndex = 0;
        this.dualEditLoad();
      }
    }
  },
  
  // 从列表跳转到对照编辑指定条目
  dualEditGo(index) {
    this.dualEditIndex = index;
    this.switchSubtitleView('dual');
    this.dualEditLoad();
  },
  
  // 双击单元格开始内联编辑
  startInlineEdit(index, field, event) {
    event.stopPropagation();
    event.preventDefault();

    if (this.editingCell) {
      this.finishInlineEdit();
    }

    const subtitle = this.subtitles[index];
    if (!subtitle) return;

    const td = event.target.closest('td') || event.target;
    const currentValue = subtitle[field] || '';

    // 使用textarea支持多行编辑
    const input = document.createElement('textarea');
    input.value = currentValue;
    input.className = 'inline-edit-input';
    input.style.width = '100%';
    input.style.minHeight = '60px';
    input.style.boxSizing = 'border-box';
    input.style.padding = '4px 6px';
    input.style.fontSize = '13px';
    input.style.border = '2px solid var(--primary-color)';
    input.style.borderRadius = '4px';
    input.style.backgroundColor = 'var(--bg-card)';
    input.style.color = 'var(--text-primary)';
    input.style.resize = 'vertical';
    input.style.fontFamily = 'inherit';

    td.innerHTML = '';
    td.appendChild(input);

    this.editingCell = {
      td: td,
      index: index,
      field: field,
      originalValue: currentValue
    };

    input.focus();
    input.select();

    // 自适应高度
    const autoResize = () => {
      input.style.height = 'auto';
      input.style.height = Math.max(60, input.scrollHeight + 8) + 'px';
    };
    autoResize();
    input.addEventListener('input', autoResize);

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.finishInlineEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelInlineEdit();
      }
    });

    input.addEventListener('blur', () => {
      if (this.editingCell && this.editingCell.td === td) {
        setTimeout(() => {
          if (this.editingCell && this.editingCell.td === td) {
            this.finishInlineEdit();
          }
        }, 200);
      }
    });
  },
  
  // 完成内联编辑
  finishInlineEdit() {
    if (!this.editingCell) return;

    const { td, index, field, originalValue } = this.editingCell;
    const input = td.querySelector('textarea') || td.querySelector('input');
    const newValue = input ? input.value.trim() : '';

    this.editingCell = null;

    if (newValue !== originalValue) {
      this.subtitles[index][field] = newValue;
      this.saveSubtitles();

      // 重新渲染表格以更新显示
      this.renderTimeline();

      if (this.currentSubtitleIndex === index) {
        this.showOverlay(this.subtitles[index]);
      }
    } else {
      // 没有修改，恢复显示
      this.renderTimeline();
    }
  },
  
  // 取消内联编辑
  cancelInlineEdit() {
    if (!this.editingCell) return;
    
    const { td, originalValue } = this.editingCell;
    td.innerHTML = this.escapeHtml(originalValue);
    this.editingCell = null;
  },
  
  // 设置时间轴显示模式
  setTimelineDisplayMode(mode) {
    this.timelineDisplayMode = mode;
    
    document.querySelectorAll('.timeline-display-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`.timeline-display-btn[data-display="${mode}"]`).classList.add('active');
    
    this.renderTimeline();
  },
  
  // 应用显示模式到全部字幕
  applyDisplayModeToAll() {
    const mode = this.globalStyleSettings.globalDisplayMode;
    const count = this.subtitles.length;
    
    const confirmOverlay = document.createElement('div');
    confirmOverlay.className = 'confirm-overlay';
    confirmOverlay.innerHTML = `
      <div class="confirm-modal">
        <h3>应用显示模式到全部字幕</h3>
        <p>本次将影响 ${count} 条字幕</p>
        <div class="confirm-options">
          <button class="btn btn-danger" onclick="VibeSubtitles.confirmApplyMode('override')">覆盖所有单句设置</button>
          <button class="btn btn-secondary" onclick="VibeSubtitles.confirmApplyMode('globalOnly')">仅应用到未自定义的字幕</button>
          <button class="btn btn-secondary" onclick="VibeSubtitles.closeConfirmModal()">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(confirmOverlay);
  },
  
  confirmApplyMode(mode) {
    const globalMode = this.globalStyleSettings.globalDisplayMode;
    let count = 0;
    
    if (mode === 'override') {
      this.subtitles.forEach(sub => {
        sub.displayMode = 'global';
        count++;
      });
    } else {
      this.subtitles.forEach(sub => {
        if (!sub.displayMode || sub.displayMode === 'global') {
          sub.displayMode = 'global';
          count++;
        }
      });
    }
    
    this.closeConfirmModal();
    this.renderTimeline();
    VibeApp.showToast(`已更新 ${count} 条字幕的显示模式`, 'success');
  },
  
  closeConfirmModal() {
    const overlay = document.querySelector('.confirm-overlay');
    if (overlay) overlay.remove();
  },
  
  // 更新单条字幕的显示模式
  updateSubtitleDisplayMode(index, mode) {
    this.subtitles[index].displayMode = mode;
    this.renderTimeline();
    
    if (this.currentSubtitleIndex === index) {
      this.showOverlay(this.subtitles[index]);
    }
  },
  
  // 隐藏字幕叠加层
  hideOverlay() {
    const overlay = document.getElementById('subtitleOverlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  },
  
  // 翻译单条字幕（优先匹配记忆库和语料库）
  async translateSingle(index) {
    const subtitle = this.subtitles[index];
    if (!subtitle.originalText.trim() || subtitle.isLoading) return;
    
    subtitle.isLoading = true;
    this.renderTimeline();
    
    try {
      // 优先使用字幕模块的语言选择器
      const subtitleTargetLang = document.getElementById('subtitleTargetLang')?.value;
      const subtitleSourceLang = document.getElementById('subtitleSourceLang')?.value;
      const targetLang = subtitleTargetLang || this.targetLanguage || 'en';
      const sourceLang = subtitleSourceLang || this.sourceLanguage || 'zh';
      // 如果源语言和目标语言相同，自动切换目标语言
      const finalTargetLang = (sourceLang === targetLang) ? (sourceLang === 'zh' ? 'en' : 'zh') : targetLang;
      const result = await this.translateWithMemoryMatch(subtitle.originalText, sourceLang, finalTargetLang);
      
      if (!result) {
        throw new Error('Translation result is null');
      }
      
      subtitle.translatedText = result.text || '';
      subtitle.translationSource = result.source || 'api';
      
      if (VibeApp && VibeApp.showToast) {
        VibeApp.showToast(result.source === 'memory' ? '记忆库匹配成功' : '翻译完成', 'success');
      }
    } catch (error) {
      console.error('Translation error:', error);
      console.error('Error stack:', error.stack);
      if (VibeApp && VibeApp.showToast) {
        VibeApp.showToast('翻译失败: ' + error.message, 'error');
      }
    } finally {
      subtitle.isLoading = false;
      this.renderTimeline();
      this.updateOverlay();
    }
  },
  
  // 翻译（优先匹配记忆库和语料库）
  async translateWithMemoryMatch(text, sourceLang, targetLang) {
    // 1. 先尝试语料库精确匹配
    const corpusMatch = VibeCorpus.exactMatch(text, sourceLang, targetLang);
    if (corpusMatch) {
      return { text: corpusMatch.targetText, source: 'memory' };
    }
    
    // 2. 再尝试记忆库模糊匹配
    const memoryMatch = VibeMemory.fuzzyMatch(text, sourceLang, targetLang, 70);
    if (memoryMatch) {
      return { text: memoryMatch.targetText, source: 'memory' };
    }
    
    // 3. 提取原文的标点符号和格式标记
    const formatInfo = this.extractTextFormat(text);
    
    // 4. 调用翻译API（翻译纯文本内容）
    const textToTranslate = formatInfo.cleanText || text;
    const translatedText = await this.callTranslationAPI(textToTranslate, sourceLang, targetLang);
    
    // 5. 将原文的标点符号和格式应用到译文
    const finalText = this.applyTextFormat(translatedText, formatInfo);
    
    // 将结果添加到记忆库和语料库
    if (finalText && finalText !== text) {
      VibeMemory.add(text, finalText, sourceLang, targetLang);
      VibeCorpus.addFromTranslator(text, finalText, sourceLang, targetLang);
    }
    
    return { text: finalText, source: 'api' };
  },

  // 提取原文中的标点符号和格式标记（包括 HTML 富文本）
  extractTextFormat(text) {
    const format = {
      cleanText: text,
      prefix: '',
      suffix: '',
      brackets: [],
      hasQuotes: false,
      quoteType: null,
      htmlTags: [] // 存储提取的 HTML 标签信息
    };

    // 1. 先提取 HTML 富文本标签（颜色、字体、下划线、链接、加粗、斜体等）
    // 匹配常见的 HTML 标签及其内容
    const htmlTagPattern = /<(span|font|b|strong|i|em|u|s|del|a|mark|sub|sup|small|big|code)\b[^>]*>.*?<\/\1>/gi;
    let tagMatch;
    let tagIndex = 0;
    let workingText = text;

    while ((tagMatch = htmlTagPattern.exec(workingText)) !== null) {
      const placeholder = `\x00TAG${tagIndex}\x00`;
      format.htmlTags.push({
        placeholder: placeholder,
        fullTag: tagMatch[0],
        tagName: tagMatch[1].toLowerCase(),
        startIndex: tagMatch.index,
        endIndex: tagMatch.index + tagMatch[0].length
      });
      // 用占位符替换 HTML 标签
      workingText = workingText.substring(0, tagMatch.index) + placeholder + workingText.substring(tagMatch.index + tagMatch[0].length);
      // 重置 regex 的 lastIndex，因为字符串长度变了
      htmlTagPattern.lastIndex = tagMatch.index + placeholder.length;
      tagIndex++;
    }

    // 更新 cleanText 为去除 HTML 后的文本
    format.cleanText = workingText;

    // 2. 提取前缀标点（如【角色名】）
    const prefixMatch = format.cleanText.match(/^【[^】]*】/);
    if (prefixMatch) {
      format.prefix = prefixMatch[0];
      format.cleanText = format.cleanText.substring(prefixMatch[0].length);
    }

    // 3. 提取后缀标点
    const suffixMatch = format.cleanText.match(/[。！？…]+$/);
    if (suffixMatch) {
      format.suffix = suffixMatch[0];
      format.cleanText = format.cleanText.substring(0, suffixMatch.index);
    }

    // 4. 提取括号注释（如（叹气））
    const bracketPattern = /[（(][^）)]*[）)]/g;
    let match;
    while ((match = bracketPattern.exec(format.cleanText)) !== null) {
      format.brackets.push({
        text: match[0],
        index: match.index,
        end: match.index + match[0].length
      });
    }

    // 5. 检测引号
    if (/[「」""''']/.test(format.cleanText)) {
      format.hasQuotes = true;
      if (/「」/.test(format.cleanText)) format.quoteType = 'corner';
      else if (/""/.test(format.cleanText)) format.quoteType = 'double';
      else if (/''/.test(format.cleanText)) format.quoteType = 'single';
    }

    // 6. 移除括号注释，保留纯文本用于翻译
    if (format.brackets.length > 0) {
      let cleanText = format.cleanText;
      format.brackets.reverse().forEach(b => {
        cleanText = cleanText.substring(0, b.index) + cleanText.substring(b.end);
      });
      format.cleanText = cleanText.trim();
    }

    return format;
  },

  // 将原文的标点符号和格式应用到译文（包括 HTML 富文本）
  applyTextFormat(translatedText, format) {
    let result = translatedText;

    // 1. 恢复括号注释
    if (format.brackets.length > 0) {
      const bracketText = format.brackets.map(b => b.text).join('') + ' ';
      result = bracketText + result;
    }

    // 2. 恢复后缀标点（根据目标语言转换为对应标点）
    if (format.suffix) {
      const suffixMap = {
        '。': '.',
        '！': '!',
        '？': '?',
        '…': '...'
      };
      const translatedSuffix = format.suffix.split('').map(p => suffixMap[p] || p).join('');
      result = result + translatedSuffix;
    }

    // 3. 恢复前缀（如【角色名】）
    if (format.prefix) {
      result = format.prefix + result;
    }

    // 4. 恢复 HTML 富文本标签
    if (format.htmlTags.length > 0) {
      format.htmlTags.forEach(tagInfo => {
        // 提取标签内的原始文本
        const innerContentMatch = tagInfo.fullTag.match(new RegExp(`>(.*)<\\/${tagInfo.tagName}>$`, 'is'));
        if (innerContentMatch) {
          const innerText = innerContentMatch[1];
          // 尝试在译文中找到对应的占位符并替换
          // 如果占位符存在，直接替换为完整标签
          result = result.split(tagInfo.placeholder).join(tagInfo.fullTag);

          // 如果占位符不存在（可能被翻译API删除了），尝试通过标签属性重新构建
          if (!result.includes(tagInfo.fullTag)) {
            // 尝试在译文末尾恢复
            const tagMatch = tagInfo.fullTag.match(new RegExp(`<(${tagInfo.tagName})\\b([^>]*)>(.*?)<\\/\\1>`, 'is'));
            if (tagMatch) {
              const tagAttrs = tagMatch[2] || '';
              // 用译文内容重建标签
              const rebuiltTag = `<${tagInfo.tagName}${tagAttrs}>${innerText}</${tagInfo.tagName}>`;
              // 将重建的标签插入到结果中
              if (!result.includes(rebuiltTag)) {
                result = result + ' ' + rebuiltTag;
              }
            }
          }
        }
      });
    }

    return result;
  },
  
  // 批量翻译
  async batchTranslate() {
    const untranslated = this.subtitles.filter(s => !s.translatedText.trim());
    
    if (untranslated.length === 0) {
      VibeApp.showToast('所有字幕都已翻译', 'info');
      return;
    }
    
    // 优先使用字幕模块的语言选择器
    const subtitleTargetLang = document.getElementById('subtitleTargetLang')?.value;
    const subtitleSourceLang = document.getElementById('subtitleSourceLang')?.value;
    const targetLang = subtitleTargetLang || this.targetLanguage || 'en';
    const sourceLang = subtitleSourceLang || this.sourceLanguage || 'zh';
    // 如果源语言和目标语言相同，自动切换目标语言
    const finalTargetLang = (sourceLang === targetLang) ? (sourceLang === 'zh' ? 'en' : 'zh') : targetLang;
    VibeApp.showToast(`开始翻译 ${untranslated.length} 条字幕（${sourceLang} → ${finalTargetLang}）...`, 'info');
    
    let completed = 0;
    let memoryHits = 0;
    const queue = [...untranslated];
    
    // 并发控制
    const processNext = async () => {
      if (queue.length === 0 || this.activeRequests >= this.maxConcurrent) return;
      
      const subtitle = queue.shift();
      const index = this.subtitles.indexOf(subtitle);
      
      if (index === -1) {
        await processNext();
        return;
      }
      
      subtitle.isLoading = true;
      this.activeRequests++;
      this.renderTimeline();
      
      try {
        const result = await this.translateWithMemoryMatch(subtitle.originalText, sourceLang, finalTargetLang);
        subtitle.translatedText = result.text;
        subtitle.translationSource = result.source;
        completed++;
        if (result.source === 'memory') memoryHits++;
      } catch (error) {
        console.error('Batch translation error:', error);
      } finally {
        subtitle.isLoading = false;
        this.activeRequests--;
        this.renderTimeline();
        this.updateOverlay();
        
        if (completed === untranslated.length) {
          VibeApp.showToast(`翻译完成！成功 ${completed} 条，记忆库命中 ${memoryHits} 条`, 'success');
          // 创建快照
          if (typeof VibeSnapshot !== 'undefined') {
            VibeSnapshot.createSnapshot('batch_translate', VibeSnapshot.generateDescription('batch_translate'));
          }
        }
        
        await processNext();
      }
    };
    
    // 启动多个并发请求
    for (let i = 0; i < this.maxConcurrent; i++) {
      processNext();
    }
  },
  
  // 调用翻译API
  async callTranslationAPI(text, sourceLang, targetLang) {
    const settings = VibeStorage.get(VibeStorage.KEYS.SETTINGS, {
      service: 'free',
      apiKey: '',
      apiSecret: ''
    });
    
    try {
      if (settings.service === 'free') {
        // 使用MyMemory免费翻译服务
        const langPair = `${sourceLang}|${targetLang}`;
        const response = await fetch(
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`
        );
        
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }
        
        const data = await response.json();
        return data.responseData?.translatedText || text;
      } else {
        // 简单字典回退
        const dict = {
          '你好': 'Hello',
          '谢谢': 'Thank you',
          '再见': 'Goodbye',
          '是的': 'Yes',
          '不是': 'No',
          '请': 'Please',
          '对不起': 'Sorry',
          '我爱你': 'I love you',
          '早上好': 'Good morning',
          '晚上好': 'Good evening',
          '你好吗': 'How are you',
          '我很好': 'I am fine'
        };
        
        return dict[text] || `[${text}]`;
      }
    } catch (error) {
      console.error('Translation API error:', error);
      return text;
    }
  },
  
  // 更新叠加层显示
  updateOverlay() {
    if (this.currentSubtitleIndex >= 0) {
      const subtitle = this.subtitles[this.currentSubtitleIndex];
      this.showOverlay(subtitle);
    }
  },
  
  // 导出SRT文件
  // ========== 导出对话框 ==========

  /**
   * 显示导出对话框（带过滤选项）
   */
  showExportDialog(format) {
    if (this.subtitles.length === 0) {
      VibeApp.showToast('没有字幕可导出', 'info');
      return;
    }

    const formatNames = {
      srt: 'SRT 纯字幕', vtt: 'VTT 字幕', ass: 'ASS 特效字幕',
      lrc: 'LRC 双语歌词', word: 'Word 双语文档', excel: 'Excel 对照稿',
      csv: 'CSV 对照稿', tmx: 'TMX 记忆库', youtube: 'YouTube 字幕',
      douyin: '抖音适配字幕', project: '项目文件', text: '纯文本'
    };

    // 移除已有弹窗
    const existing = document.getElementById('exportDialogModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'exportDialogModal';
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 480px;">
        <button class="modal-close-btn" onclick="document.getElementById('exportDialogModal').remove()">✕</button>
        <h3 style="margin-bottom: 16px;">📤 导出 ${formatNames[format] || format}</h3>
        <div class="form-group">
          <label>导出内容</label>
          <select id="exportFilterMode" class="lang-select">
            <option value="both">双语（原文+译文）</option>
            <option value="original">只导出原文</option>
            <option value="translated">只导出译文</option>
            <option value="bilingual-line">双语同行分行</option>
          </select>
        </div>
        <div class="form-group">
          <label>字幕轨道</label>
          <select id="exportTrackMode" class="lang-select">
            <option value="current">仅当前轨道（${this.trackDefinitions.find(t => t.id === this.currentTrack)?.name || '主对白'}）</option>
            <option value="all">所有轨道</option>
            <option value="main">仅主对白</option>
            <option value="annotation">仅注释字幕</option>
            <option value="title">仅人名注释</option>
          </select>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('exportDialogModal').remove()">取消</button>
          <button class="btn btn-primary" onclick="VibeSubtitles.executeExport('${format}')">导出</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  /**
   * 执行导出
   */
  executeExport(format) {
    const mode = document.getElementById('exportFilterMode').value;
    const trackMode = document.getElementById('exportTrackMode').value;

    // 获取要导出的字幕
    let subtitles = [];
    if (trackMode === 'current') {
      subtitles = this.subtitles.map((s, i) => ({ ...s, _index: i }))
        .filter(s => (s.track || 'main') === this.currentTrack);
    } else if (trackMode === 'all') {
      subtitles = this.subtitles.map((s, i) => ({ ...s, _index: i }));
    } else {
      subtitles = this.subtitles.map((s, i) => ({ ...s, _index: i }))
        .filter(s => (s.track || 'main') === trackMode);
    }

    if (subtitles.length === 0) {
      VibeApp.showToast('选定轨道没有字幕', 'info');
      return;
    }

    document.getElementById('exportDialogModal').remove();

    switch (format) {
      case 'srt': this.exportSrt(mode, subtitles); break;
      case 'vtt': this.exportVtt(mode, subtitles); break;
      case 'ass': this.exportAss(subtitles); break;
      case 'lrc': this.exportLrc(mode, subtitles); break;
      case 'word': this.exportWord(mode, subtitles); break;
      case 'excel': this.exportExcel(mode, subtitles); break;
      case 'csv': this.exportCsv(mode, subtitles); break;
      case 'tmx': this.exportTmx(subtitles); break;
      case 'youtube': this.exportYoutube(mode, subtitles); break;
      case 'douyin': this.exportDouyin(mode, subtitles); break;
      case 'project': this.exportProject(); break;
      case 'text': this.exportText(mode, subtitles); break;
      default: VibeApp.showToast('不支持的导出格式', 'error');
    }
  },

  /**
   * 获取导出文本（按mode过滤）
   */
  getExportTexts(subtitle, mode) {
    const texts = [];
    if (mode === 'original') {
      if (subtitle.originalText) texts.push(subtitle.originalText);
    } else if (mode === 'translated') {
      if (subtitle.translatedText) texts.push(subtitle.translatedText);
    } else if (mode === 'bilingual-line') {
      if (subtitle.originalText) texts.push(subtitle.originalText);
      if (subtitle.translatedText) texts.push(subtitle.translatedText);
    } else { // both
      if (subtitle.originalText && subtitle.translatedText) {
        texts.push(subtitle.originalText + '\n' + subtitle.translatedText);
      } else if (subtitle.originalText) {
        texts.push(subtitle.originalText);
      } else if (subtitle.translatedText) {
        texts.push(subtitle.translatedText);
      }
    }
    return texts;
  },

  // ========== LRC 歌词导出 ==========

  exportLrc(mode = 'both', subtitles = null) {
    const items = subtitles || this.subtitles;
    let content = '[ti:字幕歌词]\n[ar:]\n[al:]\n[by:VibeTrans]\n';

    items.forEach(subtitle => {
      const min = Math.floor(subtitle.startTime / 60);
      const sec = (subtitle.startTime % 60).toFixed(2).padStart(5, '0');
      const timeStr = `${min.toString().padStart(2, '0')}:${sec}`;

      if (mode === 'original' || mode === 'both') {
        if (subtitle.originalText) {
          content += `[${timeStr}]${subtitle.originalText}\n`;
        }
      }
      if (mode === 'translated' || mode === 'both') {
        if (subtitle.translatedText) {
          content += `[${timeStr}]${subtitle.translatedText}\n`;
        }
      }
      if (mode === 'bilingual-line') {
        if (subtitle.originalText) content += `[${timeStr}]${subtitle.originalText}\n`;
        if (subtitle.translatedText) content += `[${timeStr}]${subtitle.translatedText}\n`;
      }
    });

    this.downloadFile(content, 'subtitles.lrc', 'text/plain;charset=utf-8');
    VibeApp.showToast('LRC歌词导出成功', 'success');
  },

  // ========== Word 双语文档导出 ==========

  async exportWord(mode = 'both', subtitles = null) {
    const items = subtitles || this.subtitles;
    VibeApp.showToast('正在生成Word文档...', 'info');

    try {
      await VibeCorpus.loadScript('https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.js');
      const doc = new window.docx.Document();

      items.forEach((subtitle, index) => {
        const startTime = this.formatTime(subtitle.startTime);
        const endTime = this.formatTime(subtitle.endTime);

        const children = [
          new window.docx.Paragraph({
            children: [
              new window.docx.TextRun({ text: `${index + 1}. `, bold: true }),
              new window.docx.TextRun({ text: `[${startTime} → ${endTime}]`, color: '666666' })
            ]
          })
        ];

        if (mode === 'original' || mode === 'both' || mode === 'bilingual-line') {
          if (subtitle.originalText) {
            children.push(new window.docx.Paragraph({
              children: [new window.docx.TextRun({ text: subtitle.originalText })]
            }));
          }
        }
        if (mode === 'translated' || mode === 'both' || mode === 'bilingual-line') {
          if (subtitle.translatedText) {
            children.push(new window.docx.Paragraph({
              children: [new window.docx.TextRun({ text: subtitle.translatedText, color: '0066cc' })]
            }));
          }
        }

        doc.addSection({ children: [...children, new window.docx.Paragraph({})] });
      });

      const blob = await doc.toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'subtitles_bilingual.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      VibeApp.showToast('Word文档导出成功', 'success');
    } catch (error) {
      console.error('Word export error:', error);
      // 备用方案：导出为HTML格式
      this.exportWordAsHtml(mode, items);
    }
  },

  exportWordAsHtml(mode, items) {
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>双语字幕</title>
      <style>body{font-family:Arial,sans-serif;line-height:1.8;max-width:800px;margin:40px auto}
      .time{color:#666;font-size:12px}.original{margin:8px 0}.translated{color:#0066cc;margin:8px 0}
      .item{border-bottom:1px solid #eee;padding:12px 0}</style></head><body>`;

    items.forEach((subtitle, index) => {
      html += `<div class="item"><div class="time">${index + 1}. [${this.formatTime(subtitle.startTime)} → ${this.formatTime(subtitle.endTime)}]</div>`;
      if (mode === 'original' || mode === 'both' || mode === 'bilingual-line') {
        if (subtitle.originalText) html += `<div class="original">${this.escapeHtml(subtitle.originalText)}</div>`;
      }
      if (mode === 'translated' || mode === 'both' || mode === 'bilingual-line') {
        if (subtitle.translatedText) html += `<div class="translated">${this.escapeHtml(subtitle.translatedText)}</div>`;
      }
      html += `</div>`;
    });
    html += `</body></html>`;

    this.downloadFile(html, 'subtitles_bilingual.doc', 'application/msword');
    VibeApp.showToast('Word文档导出成功（HTML兼容格式）', 'success');
  },

  // ========== Excel 对照稿导出 ==========

  async exportExcel(mode = 'both', subtitles = null) {
    const items = subtitles || this.subtitles;
    VibeApp.showToast('正在生成Excel...', 'info');

    try {
      await VibeCorpus.loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');

      const data = items.map((subtitle, index) => {
        const row = {
          '序号': index + 1,
          '开始时间': this.formatTime(subtitle.startTime),
          '结束时间': this.formatTime(subtitle.endTime),
          '时长(秒)': (subtitle.endTime - subtitle.startTime).toFixed(2)
        };

        if (mode === 'original' || mode === 'both' || mode === 'bilingual-line') {
          row['原文'] = subtitle.originalText || '';
        }
        if (mode === 'translated' || mode === 'both' || mode === 'bilingual-line') {
          row['译文'] = subtitle.translatedText || '';
        }

        return row;
      });

      const ws = window.XLSX.utils.json_to_sheet(data);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, '字幕对照');

      window.XLSX.writeFile(wb, 'subtitles_bilingual.xlsx');
      VibeApp.showToast('Excel导出成功', 'success');
    } catch (error) {
      console.error('Excel export error:', error);
      VibeApp.showToast('Excel导出失败，改用CSV', 'info');
      this.exportCsv(mode, items);
    }
  },

  // ========== CSV 对照稿导出 ==========

  exportCsv(mode = 'both', subtitles = null) {
    const items = subtitles || this.subtitles;
    let csv = '\uFEFF序号,开始时间,结束时间,时长(秒)';

    if (mode === 'original' || mode === 'both' || mode === 'bilingual-line') csv += ',原文';
    if (mode === 'translated' || mode === 'both' || mode === 'bilingual-line') csv += ',译文';
    csv += '\n';

    items.forEach((subtitle, index) => {
      const row = [
        index + 1,
        this.formatTime(subtitle.startTime),
        this.formatTime(subtitle.endTime),
        (subtitle.endTime - subtitle.startTime).toFixed(2)
      ];

      if (mode === 'original' || mode === 'both' || mode === 'bilingual-line') {
        row.push('"' + (subtitle.originalText || '').replace(/"/g, '""') + '"');
      }
      if (mode === 'translated' || mode === 'both' || mode === 'bilingual-line') {
        row.push('"' + (subtitle.translatedText || '').replace(/"/g, '""') + '"');
      }

      csv += row.join(',') + '\n';
    });

    this.downloadFile(csv, 'subtitles_bilingual.csv', 'text/csv;charset=utf-8');
    VibeApp.showToast('CSV导出成功', 'success');
  },

  // ========== TMX 记忆库格式导出 ==========

  exportTmx(subtitles = null) {
    const items = subtitles || this.subtitles;
    const sourceLang = this.sourceLanguage || 'zh';
    const targetLang = this.targetLanguage || 'en';
    const date = new Date().toISOString();

    let tmx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    tmx += `<!DOCTYPE tmx SYSTEM "tmx14.dtd">\n`;
    tmx += `<tmx version="1.4">\n`;
    tmx += `  <header creationtool="VibeTrans" creationtoolversion="1.0" segtype="sentence" o-tmf="plain" adminlang="en" srclang="${sourceLang}" datatype="plaintext" creationdate="${date}">\n`;
    tmx += `  </header>\n`;
    tmx += `  <body>\n`;

    items.forEach(subtitle => {
      if (!subtitle.originalText || !subtitle.translatedText) return;
      tmx += `    <tu tuid="${subtitle.id || ''}">\n`;
      tmx += `      <prop type="starttime">${subtitle.startTime}</prop>\n`;
      tmx += `      <prop type="endtime">${subtitle.endTime}</prop>\n`;
      tmx += `      <tuv xml:lang="${sourceLang}"><seg>${this.escapeXml(subtitle.originalText)}</seg></tuv>\n`;
      tmx += `      <tuv xml:lang="${targetLang}"><seg>${this.escapeXml(subtitle.translatedText)}</seg></tuv>\n`;
      tmx += `    </tu>\n`;
    });

    tmx += `  </body>\n</tmx>`;

    this.downloadFile(tmx, 'subtitles.tmx', 'application/xml;charset=utf-8');
    VibeApp.showToast('TMX记忆库导出成功', 'success');
  },

  escapeXml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  },

  // ========== YouTube 字幕导出 ==========

  exportYoutube(mode = 'both', subtitles = null) {
    // YouTube 使用 VTT 格式，但有一些特殊要求
    const items = subtitles || this.subtitles;
    let content = 'WEBVTT\n\n';

    items.forEach((subtitle, index) => {
      const startStr = this.formatTimeVtt(subtitle.startTime);
      const endStr = this.formatTimeVtt(subtitle.endTime);

      content += `${index + 1}\n`;
      content += `${startStr} --> ${endStr}\n`;

      if (mode === 'original' || mode === 'both') {
        if (subtitle.originalText) content += `${subtitle.originalText}\n`;
      }
      if (mode === 'translated' || mode === 'both') {
        if (subtitle.translatedText) content += `${subtitle.translatedText}\n`;
      }
      if (mode === 'bilingual-line') {
        if (subtitle.originalText) content += `${subtitle.originalText}\n`;
        if (subtitle.translatedText) content += `${subtitle.translatedText}\n`;
      }
      content += '\n';
    });

    this.downloadFile(content, 'subtitles_youtube.vtt', 'text/vtt;charset=utf-8');
    VibeApp.showToast('YouTube字幕导出成功', 'success');
  },

  // ========== 抖音适配字幕导出 ==========

  exportDouyin(mode = 'both', subtitles = null) {
    // 抖音使用 SRT 格式，但限制每行字数
    const items = subtitles || this.subtitles;
    let content = '';

    items.forEach((subtitle, index) => {
      const startStr = this.formatTimeSrt(subtitle.startTime);
      const endStr = this.formatTimeSrt(subtitle.endTime);

      content += `${index + 1}\n`;
      content += `${startStr} --> ${endStr}\n`;

      // 抖音每行最多18个字
      const maxCharsPerLine = 18;
      const formatDouyin = (text) => {
        if (!text) return '';
        const lines = [];
        for (let i = 0; i < text.length; i += maxCharsPerLine) {
          lines.push(text.substr(i, maxCharsPerLine));
        }
        return lines.join('\n');
      };

      if (mode === 'original' || mode === 'both') {
        if (subtitle.originalText) content += `${formatDouyin(subtitle.originalText)}\n`;
      }
      if (mode === 'translated' || mode === 'both') {
        if (subtitle.translatedText) content += `${formatDouyin(subtitle.translatedText)}\n`;
      }
      content += '\n';
    });

    this.downloadFile(content, 'subtitles_douyin.srt', 'text/srt;charset=utf-8');
    VibeApp.showToast('抖音字幕导出成功', 'success');
  },

  // ========== 纯文本导出 ==========

  exportText(mode = 'both', subtitles = null) {
    const items = subtitles || this.subtitles;
    let content = '';

    items.forEach(subtitle => {
      if (mode === 'original' || mode === 'both') {
        if (subtitle.originalText) content += subtitle.originalText + '\n';
      }
      if (mode === 'translated' || mode === 'both') {
        if (subtitle.translatedText) content += subtitle.translatedText + '\n';
      }
      if (mode === 'bilingual-line') {
        if (subtitle.originalText) content += subtitle.originalText + '\n';
        if (subtitle.translatedText) content += subtitle.translatedText + '\n';
      }
      content += '\n';
    });

    this.downloadFile(content, 'subtitles.txt', 'text/plain;charset=utf-8');
    VibeApp.showToast('纯文本导出成功', 'success');
  },

  // ========== 下载文件工具 ==========

  downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // ========== LRC 歌词导入 ==========

  parseLrc(content) {
    const lines = content.split(/\r?\n/);
    const subtitles = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;

    for (const line of lines) {
      // 跳过元数据行
      if (/^\[(ti|ar|al|by|offset):/i.test(line)) continue;

      const times = [];
      let match;
      while ((match = timeRegex.exec(line)) !== null) {
        const min = parseInt(match[1]);
        const sec = parseInt(match[2]);
        const ms = parseInt(match[3].padEnd(3, '0'));
        times.push(min * 60 + sec + ms / 1000);
      }

      if (times.length > 0) {
        const text = line.replace(timeRegex, '').trim();
        if (text) {
          times.forEach(time => {
            subtitles.push({
              id: Date.now() + Math.random(),
              startTime: time,
              endTime: time + 3,
              originalText: text,
              translatedText: '',
              translationSource: null,
              style: null,
              isLoading: false,
              track: 'main'
            });
          });
        }
      }
    }

    // 按时间排序并设置结束时间为下一行开始时间
    subtitles.sort((a, b) => a.startTime - b.startTime);
    for (let i = 0; i < subtitles.length - 1; i++) {
      if (subtitles[i].endTime > subtitles[i + 1].startTime) {
        subtitles[i].endTime = subtitles[i + 1].startTime;
      }
    }

    return subtitles;
  },

  // 兼容旧的大写命名
  exportSRT() { this.showExportDialog('srt'); },
  exportVTT() { this.showExportDialog('vtt'); },
  exportASS() { this.showExportDialog('ass'); },

  exportSrt(mode = 'both', subtitles = null) {
    const items = subtitles || this.subtitles;
    if (items.length === 0) {
      VibeApp.showToast('没有字幕可导出', 'info');
      return;
    }
    
    let srtContent = '';

    items.forEach((subtitle, index) => {
      const startStr = this.formatTimeSrt(subtitle.startTime);
      const endStr = this.formatTimeSrt(subtitle.endTime);

      srtContent += `${index + 1}\n`;
      srtContent += `${startStr} --> ${endStr}\n`;

      if (mode === 'original' || mode === 'both') {
        srtContent += `${subtitle.originalText}\n`;
      }
      if (mode === 'translated' || mode === 'both') {
        if (subtitle.translatedText) {
          srtContent += `${subtitle.translatedText}\n`;
        }
      }
      if (mode === 'bilingual-line') {
        if (subtitle.originalText) srtContent += `${subtitle.originalText}\n`;
        if (subtitle.translatedText) srtContent += `${subtitle.translatedText}\n`;
      }
      srtContent += '\n';
    });

    this.downloadFile(srtContent, `subtitles_${mode}.srt`, 'text/srt;charset=utf-8');
    
    VibeApp.showToast('SRT导出成功', 'success');
  },
  
  // 导出VTT文件
  exportVtt(mode = 'both') {
    if (this.subtitles.length === 0) {
      VibeApp.showToast('没有字幕可导出', 'info');
      return;
    }
    
    let vttContent = 'WEBVTT\n\n';
    
    this.subtitles.forEach((subtitle, index) => {
      const startStr = this.formatTimeVtt(subtitle.startTime);
      const endStr = this.formatTimeVtt(subtitle.endTime);
      
      vttContent += `${index + 1}\n`;
      vttContent += `${startStr} --> ${endStr}\n`;
      
      if (mode === 'original' || mode === 'both') {
        vttContent += `${subtitle.originalText}\n`;
      }
      if (mode === 'translated' || mode === 'both') {
        if (subtitle.translatedText) {
          vttContent += `${subtitle.translatedText}\n`;
        }
      }
      vttContent += '\n';
    });
    
    const blob = new Blob([vttContent], { type: 'text/vtt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subtitles_${mode}.vtt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    VibeApp.showToast('VTT导出成功', 'success');
  },
  
  // 导出ASS文件（带样式）
  exportAss() {
    if (this.subtitles.length === 0) {
      VibeApp.showToast('没有字幕可导出', 'info');
      return;
    }
    
    const style = this.globalStyleSettings;
    
    let assContent = `[Script Info]
Title: VibeTrans Subtitles
ScriptType: v4.00+
Collisions: Normal
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontFamily || 'Microsoft YaHei'},${style.originalFontSize},${this.rgbToAssColor(style.originalColor)},${this.rgbToAssColor(style.originalColor)},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,${style.position * 10},1
Style: Translated,${style.fontFamily || 'Microsoft YaHei'},${style.translatedFontSize},${this.rgbToAssColor(style.translatedColor)},${this.rgbToAssColor(style.translatedColor)},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,${style.position * 10},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    
    this.subtitles.forEach((subtitle, index) => {
      const startStr = this.formatTimeAss(subtitle.startTime);
      const endStr = this.formatTimeAss(subtitle.endTime);
      
      const originalText = this.escapeAssText(subtitle.originalText);
      const translatedText = subtitle.translatedText ? this.escapeAssText(subtitle.translatedText) : '';
      
      if (translatedText) {
        assContent += `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${originalText}\\N${translatedText}\n`;
      } else {
        assContent += `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${originalText}\n`;
      }
    });
    
    const blob = new Blob([assContent], { type: 'text/x-ssa;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'subtitles.ass';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    VibeApp.showToast('ASS导出成功', 'success');
  },
  
  // 格式化时间为VTT格式（hh:mm:ss.mmm）
  formatTimeVtt(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    const hStr = h.toString().padStart(2, '0');
    const mStr = m.toString().padStart(2, '0');
    const sStr = s.toString().padStart(2, '0');
    const msStr = ms.toString().padStart(3, '0');
    
    return `${hStr}:${mStr}:${sStr}.${msStr}`;
  },
  
  // 格式化时间为ASS格式（hh:mm:ss.cc）
  formatTimeAss(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds % 1) * 100);
    
    const hStr = h.toString().padStart(2, '0');
    const mStr = m.toString().padStart(2, '0');
    const sStr = s.toString().padStart(2, '0');
    const csStr = cs.toString().padStart(2, '0');
    
    return `${hStr}:${mStr}:${sStr}.${csStr}`;
  },
  
  // RGB颜色转ASS颜色格式
  rgbToAssColor(color) {
    if (!color || color.length !== 7) return '&HFFFFFF';
    
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    
    return `&H${b.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${r.toString(16).padStart(2, '0')}`;
  },
  
  // 转义ASS特殊字符
  escapeAssText(text) {
    if (!text) return '';
    return text.replace(/\\/g, '\\\\')
               .replace(/\{/g, '\\{')
               .replace(/\}/g, '\\}')
               .replace(/\n/g, '\\N');
  },
  
  // 导入字幕文件
  importSubtitleFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      const extension = file.name.split('.').pop().toLowerCase();

      try {
        let subtitles = [];

        if (extension === 'srt') {
          subtitles = this.parseSrt(content);
        } else if (extension === 'vtt') {
          subtitles = this.parseVtt(content);
        } else if (extension === 'ass' || extension === 'ssa') {
          subtitles = this.parseAss(content);
        } else if (extension === 'lrc') {
          subtitles = this.parseLrc(content);
        } else if (extension === 'txt') {
          // 尝试自动识别格式
          if (content.includes('[Script Info]') || content.includes('Dialogue:')) {
            subtitles = this.parseAss(content);
          } else if (content.includes('WEBVTT')) {
            subtitles = this.parseVtt(content);
          } else if (content.includes('-->')) {
            subtitles = this.parseSrt(content);
          } else if (/\[\d{2}:\d{2}\.\d{2,3}\]/.test(content)) {
            subtitles = this.parseLrc(content);
          } else {
            VibeApp.showToast('无法识别字幕格式', 'error');
            return;
          }
        }

        if (subtitles.length > 0) {
          // 合并导入（保留现有字幕）
          subtitles.forEach(s => {
            if (!s.track) s.track = this.currentTrack;
          });
          this.subtitles = [...this.subtitles, ...subtitles];
          // 按时间排序
          this.subtitles.sort((a, b) => a.startTime - b.startTime);
          this.saveSubtitles();
          this.renderTrackTabs();
          this.renderTimeline();
          this.updateUI();
          VibeApp.showToast(`成功导入 ${subtitles.length} 条字幕`, 'success');
        } else {
          VibeApp.showToast('未解析到字幕数据', 'error');
        }
      } catch (error) {
        console.error('[Import] 字幕解析失败:', error);
        VibeApp.showToast('字幕解析失败，请检查文件格式', 'error');
      }
    };

    reader.readAsText(file, 'utf-8');
  },
  
  // 解析SRT格式
  parseSrt(content) {
    const subtitles = [];
    const blocks = content.trim().split(/\n\n+/);
    
    blocks.forEach(block => {
      const lines = block.split('\n');
      if (lines.length < 3) return;
      
      const index = parseInt(lines[0]);
      const timeLine = lines[1];
      const text = lines.slice(2).join('\n').trim();
      
      if (timeLine && text) {
        const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
        if (timeMatch) {
          subtitles.push({
            startTime: this.parseTimeSrt(timeMatch[1]),
            endTime: this.parseTimeSrt(timeMatch[2]),
            originalText: text,
            translatedText: '',
            translationSource: null
          });
        }
      }
    });
    
    return subtitles.sort((a, b) => a.startTime - b.startTime);
  },
  
  // 解析VTT格式
  parseVtt(content) {
    const subtitles = [];
    const lines = content.trim().split('\n');
    
    let i = 0;
    while (i < lines.length) {
      if (lines[i].startsWith('WEBVTT') || lines[i].trim() === '') {
        i++;
        continue;
      }
      
      const timeLine = lines[i];
      const textLines = [];
      i++;
      
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i]);
        i++;
      }
      
      if (timeLine && textLines.length > 0) {
        const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
        if (timeMatch) {
          subtitles.push({
            startTime: this.parseTimeVtt(timeMatch[1]),
            endTime: this.parseTimeVtt(timeMatch[2]),
            originalText: textLines.join('\n'),
            translatedText: '',
            translationSource: null
          });
        }
      }
    }
    
    return subtitles.sort((a, b) => a.startTime - b.startTime);
  },
  
  // 解析ASS格式
  parseAss(content) {
    const subtitles = [];
    const lines = content.split('\n');
    
    lines.forEach(line => {
      if (line.startsWith('Dialogue:')) {
        const parts = line.split(',');
        if (parts.length >= 10) {
          const startTime = parts[1].trim();
          const endTime = parts[2].trim();
          const text = parts.slice(9).join(',').trim();
          
          const splitIndex = text.indexOf('\\N');
          let originalText = text;
          let translatedText = '';
          
          if (splitIndex !== -1) {
            originalText = text.substring(0, splitIndex);
            translatedText = text.substring(splitIndex + 2);
          }
          
          subtitles.push({
            startTime: this.parseTimeAss(startTime),
            endTime: this.parseTimeAss(endTime),
            originalText: this.unescapeAssText(originalText),
            translatedText: this.unescapeAssText(translatedText),
            translationSource: null
          });
        }
      }
    });
    
    return subtitles.sort((a, b) => a.startTime - b.startTime);
  },
  
  // 解析SRT时间格式
  parseTimeSrt(timeStr) {
    const parts = timeStr.split(':');
    const h = parseInt(parts[0]) || 0;
    const m = parseInt(parts[1]) || 0;
    const sParts = parts[2].split(',');
    const s = parseInt(sParts[0]) || 0;
    const ms = parseInt(sParts[1]) || 0;
    return h * 3600 + m * 60 + s + ms / 1000;
  },
  
  // 解析VTT时间格式
  parseTimeVtt(timeStr) {
    const parts = timeStr.split(':');
    const h = parseInt(parts[0]) || 0;
    const m = parseInt(parts[1]) || 0;
    const sParts = parts[2].split('.');
    const s = parseInt(sParts[0]) || 0;
    const ms = parseInt(sParts[1]) || 0;
    return h * 3600 + m * 60 + s + ms / 1000;
  },
  
  // 解析ASS时间格式
  parseTimeAss(timeStr) {
    const parts = timeStr.split(':');
    const h = parseInt(parts[0]) || 0;
    const m = parseInt(parts[1]) || 0;
    const sParts = parts[2].split('.');
    const s = parseInt(sParts[0]) || 0;
    const cs = parseInt(sParts[1]) || 0;
    return h * 3600 + m * 60 + s + cs / 100;
  },
  
  // 反转义ASS文本
  unescapeAssText(text) {
    if (!text) return '';
    return text.replace(/\\N/g, '\n')
               .replace(/\\{/g, '{')
               .replace(/\\}/g, '}')
               .replace(/\\\\/g, '\\');
  },
  
  // 保存项目
  saveProject() {
    const projectData = {
      version: '1.0',
      saveTime: new Date().toISOString(),
      videoFileName: this.videoFile ? this.videoFile.name : '',
      subtitles: this.subtitles,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      styleSettings: this.globalStyleSettings,
      displayMode: this.displayMode
    };
    
    const jsonStr = JSON.stringify(projectData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vibetrans_project_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    VibeApp.showToast('项目保存成功', 'success');
  },
  
  // 打开项目
  openProject(file) {
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const projectData = JSON.parse(e.target.result);
        
        if (projectData.subtitles) {
          this.subtitles = projectData.subtitles;
          this.renderTimeline();
          this.updateUI();
        }
        
        if (projectData.sourceLanguage) {
          this.sourceLanguage = projectData.sourceLanguage;
        }
        
        if (projectData.targetLanguage) {
          this.targetLanguage = projectData.targetLanguage;
        }
        
        if (projectData.styleSettings) {
          this.globalStyleSettings = projectData.styleSettings;
          this.applyStyleSettingsToPanel(this.globalStyleSettings);
        }
        
        if (projectData.displayMode) {
          this.setDisplayMode(projectData.displayMode);
        }
        
        VibeApp.showToast('项目打开成功', 'success');
        
      } catch (error) {
        console.error('[Project] 项目解析失败:', error);
        VibeApp.showToast('项目文件格式错误', 'error');
      }
    };
    
    reader.readAsText(file, 'utf-8');
  },
  
  // 更新UI状态
  updateUI() {
    const exportBtn = document.getElementById('exportDropdown');
    const countEl = document.getElementById('subtitleCount');
    
    exportBtn.disabled = this.subtitles.length === 0;
    countEl.textContent = `${this.subtitles.length} 条`;
  },
  
  // 编辑聚焦时暂停播放
  onEditFocus(index, field) {
    const video = document.getElementById('subtitleVideo');
    if (video && !video.paused) {
      this.wasPlayingBeforeEdit = true;
      video.pause();
      VibeAudioManager.pause();
    } else {
      this.wasPlayingBeforeEdit = false;
    }
    
    this.currentEditingIndex = index;
    this.currentEditingField = field;
    
    if (field === 'target' && window.VibeMemory && VibeMemory.findSimilar) {
      this.showTranslationMemory(index);
    }
  },
  
  showTranslationMemory(index) {
    const subtitle = this.subtitles[index];
    if (!subtitle || !subtitle.originalText.trim()) return;
    
    const sourceLang = this.sourceLanguage || this.recognizeLanguage || 'zh';
    const targetLang = this.targetLanguage || 'en';
    
    const matches = VibeMemory.findSimilar(subtitle.originalText, sourceLang, targetLang, 70, 5);
    if (matches.length === 0) {
      this.hideTranslationMemory();
      return;
    }
    
    let memoryPanel = document.getElementById('translationMemoryPanel');
    if (!memoryPanel) {
      memoryPanel = document.createElement('div');
      memoryPanel.id = 'translationMemoryPanel';
      memoryPanel.className = 'translation-memory-panel';
      document.body.appendChild(memoryPanel);
    }
    
    memoryPanel.innerHTML = `
      <div class="memory-header">
        <span>📚 翻译记忆</span>
        <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.hideTranslationMemory()">✕</button>
      </div>
      <div class="memory-list">
        ${matches.map((match, i) => `
          <div class="memory-item" onclick="VibeSubtitles.applyMemoryMatch(${index}, '${this.escapeHtml(match.targetText)}')">
            <div class="memory-score">${match.matchScore}%</div>
            <div class="memory-content">
              <div class="memory-source">${this.escapeHtml(match.sourceText)}</div>
              <div class="memory-target">${this.escapeHtml(match.targetText)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    
    memoryPanel.style.display = 'block';
    this._currentMemoryIndex = index;
  },
  
  hideTranslationMemory() {
    const panel = document.getElementById('translationMemoryPanel');
    if (panel) {
      panel.style.display = 'none';
    }
    this._currentMemoryIndex = null;
  },
  
  applyMemoryMatch(index, targetText) {
    this.subtitles[index].translatedText = targetText;
    this.subtitles[index].translationSource = 'memory';
    this.renderTimeline();
    this.hideTranslationMemory();
  },
  
  onEditBlur() {
    const video = document.getElementById('subtitleVideo');
    if (video && this.wasPlayingBeforeEdit && video.paused) {
      video.play();
      VibeAudioManager.play();
    }
    this.wasPlayingBeforeEdit = false;
    this.hideTranslationMemory();
  },
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
  
  viewMode: 'table',
  
  setViewMode(mode) {
    this.viewMode = mode;
    
    document.getElementById('tableViewBtn').classList.toggle('active', mode === 'table');
    document.getElementById('compareViewBtn').classList.toggle('active', mode === 'compare');
    document.getElementById('timelineScroll').style.display = mode === 'table' ? 'block' : 'none';
    document.getElementById('compareView').style.display = mode === 'compare' ? 'block' : 'none';
    
    if (mode === 'compare' && this.subtitles.length > 0) {
      this.renderCompareView();
    }
  },
  
  renderCompareView() {
    const index = this.selectedSubtitleIndex >= 0 ? this.selectedSubtitleIndex : 0;
    if (index >= this.subtitles.length) return;
    
    const subtitle = this.subtitles[index];
    
    document.getElementById('compareCounter').textContent = `${index + 1} / ${this.subtitles.length}`;
    document.getElementById('compareTime').textContent = `${this.formatTime(subtitle.startTime)} → ${this.formatTime(subtitle.endTime)}`;
    document.getElementById('compareSourceLang').textContent = this.getLangName(this.recognizeLanguage);
    document.getElementById('compareTargetLang').textContent = '中文';
    
    const sourcePreview = this.highlightTerms(subtitle.originalText);
    const targetPreview = this.highlightTerms(subtitle.translatedText);
    document.getElementById('compareSourcePreview').innerHTML = sourcePreview || '<span class="empty-text">空</span>';
    document.getElementById('compareTargetPreview').innerHTML = targetPreview || '<span class="empty-text">空</span>';
    
    document.getElementById('compareSourceInput').value = subtitle.originalText;
    document.getElementById('compareTargetInput').value = subtitle.translatedText;
    
    this.currentCompareIndex = index;
  },
  
  prevSubtitle() {
    if (this.currentCompareIndex > 0) {
      this.currentCompareIndex--;
      this.selectSubtitle(this.currentCompareIndex);
      this.renderCompareView();
    }
  },
  
  nextSubtitle() {
    if (this.currentCompareIndex < this.subtitles.length - 1) {
      this.currentCompareIndex++;
      this.selectSubtitle(this.currentCompareIndex);
      this.renderCompareView();
    }
  },
  
  updateCompareSource(value) {
    if (this.currentCompareIndex >= 0) {
      this.subtitles[this.currentCompareIndex].originalText = value;
      const preview = this.highlightTerms(value);
      document.getElementById('compareSourcePreview').innerHTML = preview || '<span class="empty-text">空</span>';
    }
  },
  
  updateCompareTarget(value) {
    if (this.currentCompareIndex >= 0) {
      this.subtitles[this.currentCompareIndex].translatedText = value;
      if (value) {
        this.subtitles[this.currentCompareIndex].translationSource = 'manual';
      } else {
        this.subtitles[this.currentCompareIndex].translationSource = null;
      }
      const preview = this.highlightTerms(value);
      document.getElementById('compareTargetPreview').innerHTML = preview || '<span class="empty-text">空</span>';
    }
  },
  
  jumpToCurrentCompare() {
    if (this.currentCompareIndex >= 0) {
      this.jumpToSubtitle(this.currentCompareIndex);
    }
  },
  
  translateCurrentCompare() {
    if (this.currentCompareIndex >= 0) {
      this.translateSingle(this.currentCompareIndex);
    }
  },
  
  deleteCurrentCompare() {
    if (this.currentCompareIndex >= 0) {
      this.deleteSubtitle(this.currentCompareIndex);
      if (this.subtitles.length > 0) {
        this.currentCompareIndex = Math.min(this.currentCompareIndex, this.subtitles.length - 1);
        this.renderCompareView();
      } else {
        this.setViewMode('table');
      }
    }
  },
  
  getLangName(code) {
    const langMap = {
      'zh': '中文',
      'en': '英语',
      'ja': '日语',
      'ko': '韩语',
      'fr': '法语',
      'de': '德语',
      'es': '西班牙语'
    };
    return langMap[code] || code;
  },
  
  // ==================== Whisper语音识别功能 ====================
  
  // 获取浏览器信息
  getBrowserInfo() {
    const userAgent = navigator.userAgent;
    let browser = 'unknown';
    let version = 0;
    
    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
      browser = 'chrome';
      const match = userAgent.match(/Chrome\/(\d+)/);
      version = match ? parseInt(match[1]) : 0;
    } else if (userAgent.includes('Edg')) {
      browser = 'edge';
      const match = userAgent.match(/Edg\/(\d+)/);
      version = match ? parseInt(match[1]) : 0;
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      browser = 'safari';
      const match = userAgent.match(/Version\/(\d+)/);
      version = match ? parseInt(match[1]) : 0;
    } else if (userAgent.includes('Firefox')) {
      browser = 'firefox';
      const match = userAgent.match(/Firefox\/(\d+)/);
      version = match ? parseInt(match[1]) : 0;
    } else if (userAgent.includes('Opera') || userAgent.includes('OPR')) {
      browser = 'opera';
      const match = userAgent.match(/(?:Opera|OPR)\/(\d+)/);
      version = match ? parseInt(match[1]) : 0;
    }
    
    return { browser, version };
  },
  
  // 浏览器兼容性检测
  checkBrowserCompatibility() {
    const result = {
      supported: true,
      message: '',
      missingFeatures: [],
      warnings: [],
      recommendedBrowsers: ['Chrome', 'Edge', 'Safari', 'Firefox']
    };
    
    const browserInfo = this.getBrowserInfo();
    
    // 检查AudioContext
    if (!window.AudioContext && !window.webkitAudioContext) {
      result.missingFeatures.push('音频处理');
    }
    
    // 检查MediaRecorder
    if (!window.MediaRecorder) {
      result.missingFeatures.push('音频录制');
    }
    
    // 检查WebAssembly（Transformers.js需要）
    if (!window.WebAssembly) {
      result.missingFeatures.push('WebAssembly');
    }
    
    // 检查fetch
    if (!window.fetch) {
      result.missingFeatures.push('网络请求');
    }
    
    // 检查captureStream（可选，有回退方案）
    const video = document.getElementById('subtitleVideo');
    if (video && !video.captureStream && !video.mozCaptureStream) {
      result.warnings.push('屏幕捕获（将使用回退方案）');
    }
    
    // 检查 SharedArrayBuffer（可选，quantized模式不需要）
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
    if (!hasSharedArrayBuffer) {
      result.warnings.push('SharedArrayBuffer（将使用纯CPU模式）');
      console.log('[Compat] SharedArrayBuffer不可用，将使用quantized模式');
    }
    
    // 检查浏览器版本
    const minVersions = {
      chrome: 90,
      edge: 90,
      safari: 17, // Safari 17+ 支持更好
      firefox: 120, // Firefox 120+ 支持更好
      opera: 76
    };
    
    const currentVersion = browserInfo.version;
    const minVersion = minVersions[browserInfo.browser] || 0;
    
    if (currentVersion < minVersion && minVersion > 0) {
      result.warnings.push(`浏览器版本较低（当前${currentVersion}，建议${minVersion}+）`);
    }
    
    // 根据缺失功能判断是否支持
    if (result.missingFeatures.length > 0) {
      result.supported = false;
      
      // 根据浏览器给出针对性建议
      let suggestion = '';
      switch (browserInfo.browser) {
        case 'chrome':
          suggestion = currentVersion >= 90 ? '当前版本应支持所有功能，请尝试刷新页面' : '请升级Chrome到90版本以上';
          break;
        case 'edge':
          suggestion = currentVersion >= 90 ? '当前版本应支持所有功能，请尝试刷新页面' : '请升级Edge到90版本以上';
          break;
        case 'safari':
          suggestion = currentVersion >= 17 ? 'Safari 17+支持Whisper识别，首次使用需下载模型' : '请升级Safari到17版本以上';
          break;
        case 'firefox':
          suggestion = currentVersion >= 120 ? 'Firefox 120+支持Whisper识别，首次使用需下载模型' : '请升级Firefox到120版本以上';
          break;
        case 'opera':
          suggestion = currentVersion >= 76 ? '当前版本应支持所有功能，请尝试刷新页面' : '请升级Opera到76版本以上';
          break;
        default:
          suggestion = '建议使用Chrome 90+、Edge 90+、Safari 17+或Firefox 120+';
      }
      
      if (result.missingFeatures.includes('WebAssembly')) {
        result.message = '您的浏览器版本过旧，不支持WebAssembly。' + suggestion;
      } else if (result.missingFeatures.includes('音频处理')) {
        result.message = '您的浏览器不支持音频处理功能。' + suggestion;
      } else {
        result.message = '您的浏览器缺少以下功能：' + result.missingFeatures.join('、') + '。' + suggestion;
      }
    } else if (result.warnings.length > 0) {
      // 有警告但基本支持
      console.log('[Compat] 浏览器兼容性警告:', result.warnings.join(', '));
      
      // Safari 和 Firefox 的特殊提示
      if (browserInfo.browser === 'safari') {
        console.log('[Compat] Safari用户提示：首次使用需下载约39MB模型，请耐心等待');
      } else if (browserInfo.browser === 'firefox') {
        console.log('[Compat] Firefox用户提示：首次使用需下载约39MB模型，请耐心等待');
      }
    }
    
    return result;
  },
  
  // 自动生成字幕（主入口）
  async extractAudioOnly() {
    if (this.isGenerating) {
      VibeApp.showToast('正在处理中，请稍候...', 'info');
      return;
    }
    
    if (!this.videoUrl || !this.videoFile) {
      VibeApp.showToast('请先导入视频文件', 'error');
      return;
    }
    
    const btn = document.getElementById('autoGenerateBtn');
    const originalText = btn.innerHTML;
    
    try {
      this.isGenerating = true;
      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span> 提取中...';
      
      const progressBar = document.getElementById('recognitionProgress');
      const progressText = document.getElementById('recognitionProgressText');
      if (progressBar) progressBar.style.display = 'block';
      if (progressText) progressText.textContent = '提取音频中...';
      
      const updateProgress = (percent, text) => {
        if (progressBar) progressBar.style.width = percent + '%';
        if (progressText) progressText.textContent = text;
      };
      
      await VibeAudioManager.extractAudio(this.videoFile, updateProgress);
      
      VibeApp.showToast('音频提取成功，波形已渲染', 'success');
      
    } catch (error) {
      console.error('Extract audio error:', error);
      VibeApp.showToast('音频提取失败: ' + error.message, 'error');
    } finally {
      this.isGenerating = false;
      btn.disabled = false;
      btn.innerHTML = originalText;
      
      const progressBar = document.getElementById('recognitionProgress');
      const progressText = document.getElementById('recognitionProgressText');
      if (progressBar) progressBar.style.display = 'none';
      if (progressText) progressText.textContent = '';
    }
  },
  
  async autoGenerateSubtitles() {
    console.log('[AutoGen] ========== 自动生成字幕 ==========');

    if (!this.videoUrl || !this.videoFile) {
      VibeApp.showToast('请先导入视频', 'error');
      return;
    }

    const btn = document.getElementById('autoGenerateBtn');
    const originalText = btn?.innerHTML;

    try {
      // 1. 提取音频（不影响已有波形）
      console.log('[AutoGen] 步骤1: 提取音频（非破坏性）');
      if (btn) {
        btn.innerHTML = '<span>⏳</span> 提取音频中...';
        btn.disabled = true;
      }

      const audioBlob = await VibeAudioManager.extractAudioForRecognition(this.videoFile, (progress, message) => {
        console.log(`[AutoGen] 提取进度: ${progress}% - ${message}`);
        if (btn) btn.innerHTML = `<span>⏳</span> ${message} ${progress}%`;
      });

      if (!audioBlob || audioBlob.size === 0) {
        throw new Error('音频提取失败');
      }

      // 2. 使用 Whisper 语音识别（默认引擎，从国内CDN加载）
      console.log('[AutoGen] 步骤2: 加载 Whisper 语音识别模型');
      if (btn) {
        btn.innerHTML = '<span>⏳</span> 加载语音模型...';
      }

      let results = [];

      // 显示模型加载进度
      const pipeline = await this.loadWhisperModel((progress) => {
        if (btn) {
          if (progress.status === 'progress') {
            const pct = progress.progress ? (progress.progress * 100).toFixed(0) : 0;
            btn.innerHTML = `<span>⏳</span> 下载模型 ${pct}%`;
          } else if (progress.status === 'ready') {
            btn.innerHTML = '<span>⏳</span> 模型加载完成';
          }
        }
      });

      if (btn) {
        btn.innerHTML = '<span>⏳</span> 识别中...';
      }

      const audioData = await this.decodeAudioForWhisper(audioBlob);
      results = await this.transcribeAudioInChunks(pipeline, audioData);

      // 3. 生成字幕（合并到现有字幕，不清空）
      console.log('[AutoGen] 步骤3: 生成字幕');
      if (results.length === 0) {
        VibeApp.showToast('未识别到语音内容', 'info');
        return;
      }

      // 保留现有字幕，将新识别的字幕合并
      const existingCount = this.subtitles.length;
      results.forEach((result, index) => {
        this.subtitles.push({
          id: Date.now() + index + Math.random(),
          startTime: result.startTime,
          endTime: result.endTime,
          originalText: result.text,
          translatedText: '',
          translationSource: null,
          style: null,
          isLoading: false,
          track: this.currentTrack || 'main'
        });
      });

      this.sortSubtitles();
      this.renderTrackTabs();
      this.renderTimeline();
      this.updateUI();
      this.saveSubtitles();

      VibeApp.showToast(`识别完成，新增 ${results.length} 条字幕（共 ${this.subtitles.length} 条）`, 'success');
      console.log(`[AutoGen] ✅ 新增 ${results.length} 条字幕，总计 ${this.subtitles.length} 条`);

    } catch (error) {
      console.error('[AutoGen] ❌ 生成失败:', error);
      VibeApp.showToast('生成失败: ' + error.message, 'error');
    } finally {
      if (btn) {
        btn.innerHTML = originalText || '⚡ 自动识别';
        btn.disabled = false;
      }
    }
  },

  /**
   * 仅提取视频文本（不创建字幕条目，不影响时间轴和波形）
   * 识别结果以弹窗形式展示，可复制或一键导入为字幕
   */
  async extractVideoText() {
    if (!this.videoUrl || !this.videoFile) {
      VibeApp.showToast('请先导入视频', 'error');
      return;
    }

    // 显示进度弹窗
    const progressModal = this._showTextExtractProgress();
    const updateProgress = (msg, pct) => {
      const msgEl = document.getElementById('textExtractMsg');
      const barEl = document.getElementById('textExtractBar');
      const pctEl = document.getElementById('textExtractPct');
      if (msgEl) msgEl.textContent = msg;
      if (barEl) barEl.style.width = (pct || 0) + '%';
      if (pctEl) pctEl.textContent = (pct || 0).toFixed(0) + '%';
    };

    try {
      updateProgress('正在提取音频（不影响波形）...', 5);
      const audioBlob = await VibeAudioManager.extractAudioForRecognition(this.videoFile, (p, m) => {
        updateProgress(m, p);
      });

      // 检查是否已取消
      const modal = document.getElementById('textExtractModal');
      if (!modal || modal._cancelled) {
        return;
      }

      updateProgress('正在加载语音识别模型...', 30);
      const modelStartTime = Date.now();
      const pipeline = await this.loadWhisperModel((progress) => {
        // 检查是否已取消
        const m = document.getElementById('textExtractModal');
        if (!m || m._cancelled) {
          throw new Error('用户取消操作');
        }
        if (progress.status === 'progress') {
          const pct = progress.progress ? 30 + progress.progress * 40 : 30;
          const sizeMB = progress.total ? (progress.total / 1024 / 1024).toFixed(1) : '?';
          const loadedMB = progress.loaded ? (progress.loaded / 1024 / 1024).toFixed(1) : '?';
          updateProgress(`下载模型 ${loadedMB}/${sizeMB} MB (${(progress.progress * 100).toFixed(0)}%)`, pct);
        } else if (progress.status === 'ready') {
          const elapsed = ((Date.now() - modelStartTime) / 1000).toFixed(1);
          updateProgress(`模型加载完成（${elapsed}s），开始识别...`, 70);
        } else if (progress.status === 'loading') {
          updateProgress(`加载模型: ${progress.name || '...'} `, 50);
        }
      });

      // 检查是否已取消
      const modal2 = document.getElementById('textExtractModal');
      if (!modal2 || modal2._cancelled) {
        return;
      }

      updateProgress('正在识别语音内容...', 75);
      const audioData = await this.decodeAudioForWhisper(audioBlob);
      const totalDuration = audioData.length / 16000;
      const results = await this.transcribeAudioInChunks(pipeline, audioData, (progress, msg, info) => {
        // 检查是否已取消
        const m = document.getElementById('textExtractModal');
        if (!m || m._cancelled) {
          throw new Error('用户取消操作');
        }
        // 75% - 100% 区间
        const pct = 75 + (progress / 100) * 25;
        updateProgress(msg, pct);
      });

      // 检查是否已取消
      const modal3 = document.getElementById('textExtractModal');
      if (!modal3 || modal3._cancelled) {
        return;
      }

      updateProgress('识别完成，整理结果...', 100);
      setTimeout(() => {
        const m = document.getElementById('textExtractModal');
        if (m) {
          if (m._timer) clearInterval(m._timer);
          m.remove();
        }
        this._showTextExtractResult(results);
      }, 300);

    } catch (error) {
      console.error('[TextExtract] 失败:', error);
      const m = document.getElementById('textExtractModal');
      if (m) {
        if (m._timer) clearInterval(m._timer);
        m.remove();
      }
      if (error.message && error.message.includes('取消')) {
        VibeApp.showToast('文本提取已取消', 'info');
      } else {
        VibeApp.showToast('文本提取失败: ' + error.message, 'error');
      }
    }
  },

  _showTextExtractProgress() {
    const existing = document.getElementById('textExtractModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'textExtractModal';
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 480px; text-align: center; position: relative;">
        <button class="modal-close-btn" onclick="VibeSubtitles.cancelExtractText()" title="取消提取">✕</button>
        <h3 style="margin-bottom: 16px;">📝 提取视频文本</h3>
        <div style="margin: 24px 0;">
          <div style="font-size: 42px; margin-bottom: 12px; animation: pulse 1.5s ease-in-out infinite;">🎙️</div>
          <div id="textExtractMsg" style="color: var(--text-secondary); margin-bottom: 12px; font-size: 13px; min-height: 1.5em;">准备中...</div>
          <div style="background: var(--bg-secondary); border-radius: 6px; overflow: hidden; height: 10px; margin-bottom: 8px;">
            <div id="textExtractBar" style="background: linear-gradient(90deg, #165dff, #4d9fff); height: 100%; width: 0%; transition: width 0.3s; background-size: 20px 20px; background-image: linear-gradient(45deg, rgba(255,255,255,0.2) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.2) 75%, transparent 75%, transparent); animation: progressStripes 1s linear infinite;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-tertiary);">
            <span>已用: <span id="textExtractElapsed">0s</span></span>
            <span id="textExtractPct">0%</span>
          </div>
        </div>
        <p style="font-size: 12px; color: var(--text-tertiary);">识别过程不影响已有波形和时间轴</p>
        <button class="btn btn-secondary btn-sm" style="margin-top: 12px;" onclick="VibeSubtitles.cancelExtractText()">取消提取</button>
        <style>@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.7; transform: scale(0.92); } }</style>
      </div>
    `;
    document.body.appendChild(modal);

    // 启动计时器
    const startTs = Date.now();
    const timer = setInterval(() => {
      const el = document.getElementById('textExtractElapsed');
      if (!el) { clearInterval(timer); return; }
      const sec = Math.floor((Date.now() - startTs) / 1000);
      if (sec < 60) el.textContent = sec + 's';
      else el.textContent = Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
    }, 500);
    modal._timer = timer;
    modal._startTs = startTs;
    modal._cancelled = false;
    return modal;
  },

  // 取消文本提取
  cancelExtractText() {
    const modal = document.getElementById('textExtractModal');
    if (modal) {
      modal._cancelled = true;
      if (modal._timer) clearInterval(modal._timer);
      modal.remove();
    }
    VibeApp.showToast('已取消文本提取', 'info');
  },

  _showTextExtractResult(results) {
    if (!results || results.length === 0) {
      VibeApp.showToast('未识别到语音内容', 'info');
      return;
    }

    const fullText = results.map(r => r.text).join('\n');
    const totalDuration = results.length > 0 ? results[results.length - 1].endTime : 0;
    const formatTime = (s) => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    const existing = document.getElementById('textResultModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'textResultModal';
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 720px;">
        <button class="modal-close-btn" onclick="document.getElementById('textResultModal').remove()">✕</button>
        <h3 style="margin-bottom: 16px;">📝 视频文本提取结果</h3>
        <div style="background: var(--bg-secondary); padding: 10px 14px; border-radius: var(--radius); margin-bottom: 16px; font-size: 13px; color: var(--text-secondary);">
          <span>共识别 <strong style="color: var(--primary-color);">${results.length}</strong> 段</span>
          <span style="margin-left: 16px;">音频时长 <strong>${formatTime(totalDuration)}</strong></span>
          <span style="margin-left: 16px;">总字数 <strong>${fullText.replace(/\s/g, '').length}</strong></span>
        </div>
        <div style="border: 1px solid var(--border-light); border-radius: var(--radius); max-height: 400px; overflow-y: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead style="position: sticky; top: 0; background: var(--bg-secondary); z-index: 1;">
              <tr>
                <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-light); width: 100px;">时间</th>
                <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-light);">文本</th>
              </tr>
            </thead>
            <tbody>
              ${results.map(r => `
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid var(--border-light); color: var(--text-tertiary); font-family: monospace; font-size: 11px; vertical-align: top;">
                    ${formatTime(r.startTime)}<br>→ ${formatTime(r.endTime)}
                  </td>
                  <td style="padding: 8px; border-bottom: 1px solid var(--border-light);">${this.escapeHtml(r.text)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="modal-footer" style="margin-top: 16px;">
          <button class="btn btn-secondary" onclick="VibeSubtitles._copyExtractedText()">📋 复制纯文本</button>
          <button class="btn btn-secondary" onclick="VibeSubtitles._downloadExtractedText()">📥 下载 TXT</button>
          <button class="btn btn-primary" onclick="VibeSubtitles._importExtractedAsSubtitles()">➕ 导入为字幕</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    this._lastExtractedResults = results;
  },

  _copyExtractedText() {
    const text = (this._lastExtractedResults || []).map(r => r.text).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      VibeApp.showToast('已复制到剪贴板', 'success');
    }).catch(() => {
      VibeApp.showToast('复制失败', 'error');
    });
  },

  _downloadExtractedText() {
    const results = this._lastExtractedResults || [];
    let content = `视频文本提取结果\n生成时间: ${new Date().toLocaleString()}\n${'='.repeat(50)}\n\n`;
    results.forEach((r, i) => {
      content += `[${this.formatTime(r.startTime)} → ${this.formatTime(r.endTime)}]\n${r.text}\n\n`;
    });
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (this.videoFile?.name || 'video').replace(/\.[^.]+$/, '') + '_transcript.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    VibeApp.showToast('已下载', 'success');
  },

  _importExtractedAsSubtitles() {
    const results = this._lastExtractedResults || [];
    if (results.length === 0) return;
    let count = 0;
    results.forEach((result, index) => {
      this.subtitles.push({
        id: Date.now() + index + Math.random(),
        startTime: result.startTime,
        endTime: result.endTime,
        originalText: result.text,
        translatedText: '',
        translationSource: null,
        style: null,
        isLoading: false,
        track: this.currentTrack || 'main'
      });
      count++;
    });
    this.sortSubtitles();
    this.renderTrackTabs();
    this.renderTimeline();
    this.updateUI();
    this.saveSubtitles();
    const modal = document.getElementById('textResultModal');
    if (modal) modal.remove();
    VibeApp.showToast(`已导入 ${count} 条字幕`, 'success');
  },

  // 从视频提取音频（兼容多浏览器）
  async extractAudioFromVideo() {
    const video = document.getElementById('subtitleVideo');
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    
    if (!AudioContextClass) {
      throw new Error('您的浏览器不支持音频处理，请使用Chrome、Edge或Safari');
    }
    
    if (!this.videoUrl || !this.videoFile) {
      throw new Error('请先导入视频文件');
    }
    
    // 确保视频已加载元数据
    if (video.readyState < 2) {
      await new Promise((resolve) => {
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          resolve();
        };
        video.addEventListener('loadedmetadata', onLoaded);
        video.load();
      });
    }
    
    const duration = video.duration;
    if (!duration || duration <= 0) {
      throw new Error('无法获取视频时长');
    }
    
    const audioContext = new AudioContextClass();
    const sampleRate = 16000;
    
    // 方案1：使用captureStream + MediaRecorder（最可靠，支持所有现代浏览器）
    try {
      console.log('尝试方案1：captureStream + MediaRecorder');
      const result = await this.extractAudioWithCaptureStream(video, audioContext, duration, sampleRate);
      if (result) return result;
    } catch (error) {
      console.warn('方案1失败:', error.message);
    }
    
    // 方案2：使用fetch获取视频文件并解码音频轨道
    try {
      console.log('尝试方案2：fetch + AudioDecoder API');
      const result = await this.extractAudioWithFetch(video, audioContext, duration, sampleRate);
      if (result) return result;
    } catch (error) {
      console.warn('方案2失败:', error.message);
    }
    
    // 方案3：使用Web Audio API实时录制
    try {
      console.log('尝试方案3：Web Audio API实时录制');
      const result = await this.extractAudioWithWebAudio(video, audioContext, duration, sampleRate);
      if (result) return result;
    } catch (error) {
      console.warn('方案3失败:', error.message);
    }
    
    // 方案4：使用readAsArrayBuffer直接读取（回退方案）
    try {
      console.log('尝试方案4：readAsArrayBuffer');
      const result = await this.extractAudioWithFileReader(video, audioContext, this.videoFile, sampleRate);
      if (result) return result;
    } catch (error) {
      console.warn('方案4失败:', error.message);
    }
    
    audioContext.close();
    throw new Error('无法提取视频音频，请尝试使用Chrome、Edge或Safari浏览器');
  },
  
  // 方案1：captureStream + MediaRecorder（最可靠）
  async extractAudioWithCaptureStream(video, audioContext, duration, sampleRate) {
    const captureStream = video.captureStream || video.mozCaptureStream;
    if (!captureStream) {
      throw new Error('浏览器不支持captureStream');
    }
    
    const stream = captureStream.call(video);
    const audioTracks = stream.getAudioTracks();
    
    if (audioTracks.length === 0) {
      throw new Error('视频没有音频轨道');
    }
    
    const audioStream = new MediaStream([audioTracks[0]]);
    const mimeType = this.getSupportedMimeType();
    
    if (!mimeType) {
      throw new Error('浏览器不支持音频录制');
    }
    
    const mediaRecorder = new MediaRecorder(audioStream, { mimeType });
    const audioChunks = [];
    
    return new Promise((resolve, reject) => {
      let stopTimeout;
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        try {
          if (audioChunks.length === 0) {
            reject(new Error('没有录制到音频数据'));
            return;
          }
          
          const audioBlob = new Blob(audioChunks, { type: mimeType });
          const arrayBuffer = await audioBlob.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          const resampledBuffer = await this.resampleAudio(audioBuffer, sampleRate);
          
          audioContext.close();
          resolve(resampledBuffer.getChannelData(0));
        } catch (err) {
          audioContext.close();
          reject(err);
        }
      };
      
      mediaRecorder.onerror = (e) => {
        clearTimeout(stopTimeout);
        audioContext.close();
        reject(new Error('MediaRecorder错误: ' + (e.error?.message || e.message)));
      };
      
      const originalTime = video.currentTime;
      const originalMuted = video.muted;
      const originalVolume = video.volume;
      
      mediaRecorder.start();
      
      video.currentTime = 0;
      video.muted = true;
      video.volume = 0;
      
      video.play().catch((e) => {
        clearTimeout(stopTimeout);
        mediaRecorder.stop();
        audioContext.close();
        reject(new Error('无法播放视频: ' + e.message));
      });
      
      video.addEventListener('ended', () => {
        clearTimeout(stopTimeout);
        if (mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      }, { once: true });
      
      stopTimeout = setTimeout(() => {
        if (mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      }, duration * 1000 + 10000);
    });
  },
  
  // 方案2：使用fetch获取视频文件并提取音频
  async extractAudioWithFetch(video, audioContext, duration, sampleRate) {
    if (!this.videoFile) {
      throw new Error('没有视频文件引用');
    }
    
    const arrayBuffer = await this.videoFile.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const resampledBuffer = await this.resampleAudio(audioBuffer, sampleRate);
    
    audioContext.close();
    return resampledBuffer.getChannelData(0);
  },
  
  // 方案3：使用Web Audio API实时录制到AudioBuffer
  async extractAudioWithWebAudio(video, audioContext, duration, sampleRate) {
    return new Promise((resolve, reject) => {
      const sourceNode = audioContext.createMediaElementSource(video);
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      
      const audioData = [];
      let totalSamples = 0;
      const targetSamples = Math.ceil(duration * sampleRate);
      
      scriptProcessor.onaudioprocess = (e) => {
        const inputBuffer = e.inputBuffer;
        const channelData = inputBuffer.getChannelData(0);
        
        for (let i = 0; i < channelData.length; i++) {
          if (totalSamples < targetSamples) {
            audioData.push(channelData[i]);
            totalSamples++;
          }
        }
        
        if (totalSamples >= targetSamples) {
          scriptProcessor.disconnect();
          sourceNode.disconnect();
          video.pause();
          
          try {
            const offlineContext = new OfflineAudioContext(1, targetSamples, sampleRate);
            const buffer = offlineContext.createBuffer(1, targetSamples, sampleRate);
            buffer.getChannelData(0).set(audioData);
            
            const resampledBuffer = this.resampleAudio(buffer, sampleRate);
            audioContext.close();
            resolve(resampledBuffer.getChannelData(0));
          } catch (err) {
            audioContext.close();
            reject(err);
          }
        }
      };
      
      sourceNode.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
      
      video.currentTime = 0;
      video.muted = true;
      
      video.play().catch((e) => {
        scriptProcessor.disconnect();
        sourceNode.disconnect();
        audioContext.close();
        reject(new Error('无法播放视频: ' + e.message));
      });
      
      setTimeout(() => {
        if (scriptProcessor) {
          scriptProcessor.disconnect();
          sourceNode.disconnect();
          video.pause();
          
          if (audioData.length > 0) {
            try {
              const offlineContext = new OfflineAudioContext(1, audioData.length, sampleRate);
              const buffer = offlineContext.createBuffer(1, audioData.length, sampleRate);
              buffer.getChannelData(0).set(audioData);
              
              const resampledBuffer = this.resampleAudio(buffer, sampleRate);
              audioContext.close();
              resolve(resampledBuffer.getChannelData(0));
            } catch (err) {
              audioContext.close();
              reject(err);
            }
          } else {
            audioContext.close();
            reject(new Error('没有录制到音频数据'));
          }
        }
      }, duration * 1000 + 5000);
    });
  },
  
  // 方案4：使用FileReader读取文件（回退方案）
  async extractAudioWithFileReader(video, audioContext, file, sampleRate) {
    if (!file) {
      throw new Error('没有文件引用');
    }
    
    const arrayBuffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsArrayBuffer(file);
    });
    
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const resampledBuffer = await this.resampleAudio(audioBuffer, sampleRate);
    
    audioContext.close();
    return resampledBuffer.getChannelData(0);
  },
  
  // 获取支持的MediaRecorder格式
  getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/ogg'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    
    return null;
  },
  
  // 重采样音频到目标采样率
  async resampleAudio(audioBuffer, targetSampleRate) {
    const sourceSampleRate = audioBuffer.sampleRate;
    const numberOfChannels = 1; // Whisper需要单声道
    
    if (sourceSampleRate === targetSampleRate && audioBuffer.numberOfChannels === 1) {
      return audioBuffer;
    }
    
    // 创建OfflineAudioContext进行重采样
    const duration = audioBuffer.duration;
    const offlineContext = new OfflineAudioContext(
      numberOfChannels,
      Math.ceil(duration * targetSampleRate),
      targetSampleRate
    );
    
    // 创建buffer source
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start(0);
    
    // 渲染
    const resampledBuffer = await offlineContext.startRendering();
    return resampledBuffer;
  },
  
  // 加载Whisper模型（带重试机制，使用国内CDN加速）
  async loadWhisperModelWithRetry(maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Whisper] 加载模型尝试 ${attempt}/${maxRetries}`);
        
        // 检查是否已加载
        if (this.whisperPipeline) {
          console.log('[Whisper] 模型已加载，直接使用');
          return this.whisperPipeline;
        }
        
        // 使用Transformers.js加载模型
        if (!window.loadTransformers) {
          throw new Error('Transformers.js未加载');
        }

        const transformersModule = await window.loadTransformers();
        const pipelineFn = transformersModule.pipeline;

        // 配置环境变量，禁用本地模型加载
        if (transformersModule.env) {
          transformersModule.env.allowLocalModels = false;
          transformersModule.env.allowRemoteModels = true;
        }

        // 加载Whisper tiny模型（quantized模式，不依赖SharedArrayBuffer）
        console.log('[Whisper] 开始加载模型...');
        console.log('[Whisper] 提示：首次加载约需39MB，模型会缓存到浏览器');

        this.whisperPipeline = await pipelineFn('automatic-speech-recognition', 'Xenova/whisper-tiny', {
          quantized: true, // 使用量化模型，减少内存占用，不依赖SharedArrayBuffer
          progress_callback: (progress) => {
            if (progress.status === 'downloading') {
              const percent = progress.progress ? Math.round(progress.progress) : 0;
              const file = progress.file || '';
              console.log(`[Whisper] 下载进度: ${percent}% - ${file}`);

              // 更新按钮状态
              const btn = document.getElementById('autoGenerateBtn');
              if (btn && percent > 0) {
                btn.innerHTML = `<span>⏳</span> 下载模型 ${percent}%`;
              }
              
              // 更新区间识别按钮状态
              const recognizeBtn = document.getElementById('recognizeSegmentBtn');
              if (recognizeBtn && percent > 0) {
                recognizeBtn.innerHTML = `<span>⏳</span> 下载模型 ${percent}%`;
              }
            } else if (progress.status === 'loading') {
              console.log('[Whisper] 正在加载模型到内存...');
              
              // 更新按钮状态
              const recognizeBtn = document.getElementById('recognizeSegmentBtn');
              if (recognizeBtn) {
                recognizeBtn.innerHTML = '<span>⏳</span> 加载模型中...';
              }
            }
          }
        });
        
        console.log('[Whisper] 模型加载成功');
        return this.whisperPipeline;
        
      } catch (error) {
        console.error(`[Whisper] 加载失败 (尝试 ${attempt}/${maxRetries}):`, error);
        
        // 特殊错误处理
        if (error.message.includes('SharedArrayBuffer')) {
          throw new Error('SharedArrayBuffer不可用，请确保浏览器支持或使用quantized模式');
        }
        
        if (error.message.includes('CORS') || error.message.includes('cross-origin')) {
          throw new Error('模型下载被CORS阻止，请检查网络设置');
        }
        
        if (error.message.includes('404') || error.message.includes('Not Found')) {
          throw new Error('模型文件不存在，CDN可能暂时不可用');
        }
        
        if (error.message.includes('network') || error.message.includes('fetch')) {
          throw new Error('网络连接失败，请检查是否能访问 huggingface.co');
        }
        
        // 如果是最后一次尝试，抛出错误
        if (attempt === maxRetries) {
          throw new Error('语音模型加载失败，请检查网络并重试');
        }
        
        // 等待一段时间后重试
        console.log('[Whisper] 等待2秒后重试...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  },
  
  // 分段识别音频（每段30秒）
  async transcribeAudioInChunks(pipeline, audioData, onProgress) {
    const CHUNK_DURATION = 30; // 每段30秒
    const SAMPLE_RATE = 16000;
    const samplesPerChunk = CHUNK_DURATION * SAMPLE_RATE;

    const totalSamples = audioData.length;
    const totalDuration = totalSamples / SAMPLE_RATE;
    const numChunks = Math.ceil(totalDuration / CHUNK_DURATION);

    console.log(`[Whisper] 音频总时长: ${totalDuration.toFixed(1)}秒, 分为 ${numChunks} 段识别`);

    const startTime = Date.now();

    // 获取当前配置参数
    const langSelect = document.getElementById('recognizeLang');
    const tempSlider = document.getElementById('recognizeTemperature');
    const beamSlider = document.getElementById('recognizeBeamSize');
    const penaltySlider = document.getElementById('recognizeRepetitionPenalty');

    // 语言映射：确保使用Whisper支持的语言代码
    const whisperLangMap = {
      'zh': 'zh', 'zh-CN': 'zh', '中文': 'zh',
      'en': 'en', 'en-US': 'en', '英文': 'en',
      'ja': 'ja', '日文': 'ja',
      'ko': 'ko', '韩文': 'ko',
      'fr': 'fr', '法文': 'fr',
      'de': 'de', '德文': 'de',
      'es': 'es', '西班牙语': 'es'
    };
    const selectedLang = langSelect?.value || this.recognizeLanguage || 'zh';
    const whisperLang = whisperLangMap[selectedLang] || selectedLang;

    const recognizeParams = {
      language: whisperLang,
      temperature: parseFloat(tempSlider?.value || '0.0'),
      beam_size: parseInt(beamSlider?.value || '5'),
      repetition_penalty: parseFloat(penaltySlider?.value || '1.0'),
      task: 'transcribe',
      return_timestamps: true,
    };

    console.log('[Whisper] 使用语言:', whisperLang, '参数:', recognizeParams);

    const allResults = [];

    for (let i = 0; i < numChunks; i++) {
      const startSample = i * samplesPerChunk;
      const endSample = Math.min(startSample + samplesPerChunk, totalSamples);
      const chunkDuration = (endSample - startSample) / SAMPLE_RATE;

      // 提取当前片段的音频数据
      const chunkAudio = audioData.slice(startSample, endSample);

      // 计算进度与剩余时间
      const progress = Math.round((i + 1) / numChunks * 100);
      const elapsed = (Date.now() - startTime) / 1000;
      const avgPerChunk = (i + 1) > 0 ? elapsed / (i + 1) : 0;
      const remaining = (numChunks - i - 1) * avgPerChunk;

      const progressMsg = `识别中 ${i + 1}/${numChunks} 段（${chunkDuration.toFixed(0)}秒/段）· 已用 ${elapsed.toFixed(0)}s · 剩余 ~${remaining.toFixed(0)}s`;

      // 更新按钮（兼容自动识别字幕流程）
      const btn = document.getElementById('autoGenerateBtn');
      if (btn) {
        btn.innerHTML = `<span>⏳</span> ${progressMsg}`;
      }

      // 回调通知调用方
      if (onProgress) {
        onProgress(progress, progressMsg, { current: i + 1, total: numChunks, elapsed, remaining });
      }

      console.log(`[Whisper] 正在识别第 ${i + 1}/${numChunks} 段 (${chunkDuration.toFixed(1)}秒)`);

      try {
        // 调用Whisper模型识别当前片段（使用配置参数）
        const result = await pipeline(chunkAudio, {
          ...recognizeParams,
          chunk_length_s: chunkDuration // 指定片段长度
        });
        
        // 处理结果，添加时间偏移
        if (result && result.chunks) {
          const timeOffset = i * CHUNK_DURATION;
          
          result.chunks.forEach(chunk => {
            if (chunk.text && chunk.text.trim()) {
              allResults.push({
                text: chunk.text.trim(),
                startTime: (chunk.timestamp[0] || 0) + timeOffset,
                endTime: (chunk.timestamp[1] || chunk.timestamp[0] + 3) + timeOffset
              });
            }
          });
        } else if (result && result.text) {
          // 如果没有chunks，使用整个片段的时间范围
          const timeOffset = i * CHUNK_DURATION;
          allResults.push({
            text: result.text.trim(),
            startTime: timeOffset,
            endTime: timeOffset + chunkDuration
          });
        }
        
      } catch (error) {
        console.error(`[Whisper] 第 ${i + 1} 段识别失败:`, error);
        // 继续识别下一段，不中断整个流程
      }
    }
    
    console.log(`[Whisper] 识别完成，共 ${allResults.length} 条字幕`);
    return allResults;
  },
  
  // 识别选中区间的语音（已移除）
  // ========== 音轨检测 ==========

  /**
   * 检测视频是否包含音轨
   * @param {HTMLVideoElement} video - 视频元素
   * @returns {Promise<boolean>} 是否有音轨
   */
  async checkVideoHasAudio(video) {
    console.log('[Audio] ========== 检测音轨 ==========');

    try {
      // 方法1：检查 video.audioTracks（部分浏览器支持）
      if (video.audioTracks && video.audioTracks.length > 0) {
        console.log('[Audio] 通过 audioTracks 检测到音轨:', video.audioTracks.length, '条');
        return true;
      }

      // 方法2：使用 Web Audio API 检测音频数据
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        console.warn('[Audio] Web Audio API 不可用，跳过音轨检测');
        return true; // 假设可能有音轨，让后续步骤处理
      }

      const audioContext = new AudioContext();
      try {
        const source = audioContext.createMediaElementSource(video);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        // 播放一小段（0.5秒）来检测音频
        const currentTime = video.currentTime;
        const wasPaused = video.paused;

        video.muted = false;
        await video.play();
        await new Promise(r => setTimeout(r, 500));
        if (wasPaused) video.pause();
        video.currentTime = currentTime;

        // 读取音频数据
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(dataArray);

        // 检查是否有非零数据
        let hasNonZero = false;
        for (let i = 0; i < dataArray.length; i++) {
          if (dataArray[i] !== 128) { // 128 是静音值（无信号时的中间值）
            hasNonZero = true;
            break;
          }
        }

        console.log('[Audio] 音频数据检测结果:', hasNonZero ? '有声音' : '无声音（全零）');

        source.disconnect();
        analyser.disconnect();
        await audioContext.close();

        return hasNonZero;

      } catch (e) {
        console.warn('[Audio] Web Audio 检测失败:', e.message);
        await audioContext.close();
        return true; // 检测失败时假设可能有音轨
      }

    } catch (error) {
      console.warn('[Audio] 音轨检测异常:', error.message);
      return true; // 检测失败时假设可能有音轨
    }
  },

  // ========== 区间音频提取 ==========

  /**
   * 提取指定区间的音频
   * @param {number} startTime - 开始时间（秒）
   * @param {number} endTime - 结束时间（秒）
   * @returns {Promise<Blob>} WAV 格式的音频 Blob
   */
  async extractSegmentAudio(startTime, endTime) {
    console.log('[Audio] ========== 提取区间音频 ==========');
    console.log('[Audio] 时间范围:', startTime.toFixed(2), '-', endTime.toFixed(2), '秒');
    console.log('[Audio] 时长:', (endTime - startTime).toFixed(2), '秒');

    const duration = endTime - startTime;
    if (duration <= 0) {
      throw new Error('区间时长无效');
    }

    const video = document.getElementById('subtitleVideo');
    if (!video) {
      throw new Error('找不到视频元素');
    }

    // 先检测是否有音轨
    const hasAudio = await this.checkVideoHasAudio(video);
    if (!hasAudio) {
      console.warn('[Audio] 该视频没有声音');
      throw new Error('该视频没有声音，无法进行语音识别');
    }

    // 方案1：使用 FFmpeg.wasm 提取（最可靠）
    try {
      console.log('[Audio] 尝试使用 FFmpeg 提取音频...');
      const wavBlob = await this.cutAudioWithFFmpeg(this.videoFile, startTime, duration);
      if (wavBlob && wavBlob.size > 0) {
        console.log('[Audio] FFmpeg 提取成功，大小:', wavBlob.size, '字节');
        return wavBlob;
      }
    } catch (ffmpegError) {
      console.warn('[Audio] FFmpeg 提取失败:', ffmpegError.message);
    }

    // 方案2：使用 OfflineAudioContext
    try {
      console.log('[Audio] 尝试使用 OfflineAudioContext 提取...');
      const wavBlob = await this.extractWithOfflineContext(video, startTime, duration);
      if (wavBlob && wavBlob.size > 0) {
        console.log('[Audio] OfflineAudioContext 提取成功，大小:', wavBlob.size, '字节');
        return wavBlob;
      }
    } catch (offlineError) {
      console.warn('[Audio] OfflineAudioContext 提取失败:', offlineError.message);
    }

    // 方案3：使用 MediaRecorder 录制（兼容性最好）
    try {
      console.log('[Audio] 尝试使用 MediaRecorder 录制...');
      const wavBlob = await this.recordWithMediaRecorder(video, startTime, duration);
      if (wavBlob && wavBlob.size > 0) {
        console.log('[Audio] MediaRecorder 录制成功，大小:', wavBlob.size, '字节');
        return wavBlob;
      }
    } catch (recorderError) {
      console.error('[Audio] MediaRecorder 录制也失败:', recorderError.message);
    }

    throw new Error('所有音频提取方案都失败了，请尝试其他视频');
  },

  /**
   * 使用 OfflineAudioContext 提取区间音频
   */
  async extractWithOfflineContext(video, startTime, duration) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const OfflineAudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;

    if (!AudioContext || !OfflineAudioContext) {
      throw new Error('浏览器不支持 OfflineAudioContext');
    }

    const sampleRate = 16000;
    const channels = 1;
    const length = Math.ceil(duration * sampleRate);

    // 先创建一个普通 AudioContext 来解码
    const tempContext = new AudioContext();

    try {
      // 读取视频文件并解码
      const arrayBuffer = await this.videoFile.arrayBuffer();
      const audioBuffer = await tempContext.decodeAudioData(arrayBuffer.slice(0));

      // 创建离线上文
      const offlineContext = new OfflineAudioContext(channels, length, sampleRate);

      // 创建缓冲区源
      const source = offlineContext.createBufferSource();
      source.buffer = audioBuffer;

      // 创建增益节点（用于淡入淡出防止爆音）
      const gainNode = offlineContext.createGain();
      gainNode.gain.value = 1;

      source.connect(gainNode);
      gainNode.connect(offlineContext.destination);

      // 从指定位置开始播放
      source.start(0, startTime, duration);

      // 渲染
      const renderedBuffer = await offlineContext.startRendering();

      await tempContext.close();

      // 转换为 WAV
      return this.bufferToWav(renderedBuffer, sampleRate);

    } catch (error) {
      try { await tempContext.close(); } catch(e) {}
      throw error;
    }
  },

  /**
   * 使用 MediaRecorder 录制区间音频（兼容性方案）
   */
  async recordWithMediaRecorder(video, startTime, duration) {
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('浏览器不支持 MediaRecorder');
    }

    // 捕获视频音频流
    let stream;
    if (video.captureStream) {
      stream = video.captureStream();
    } else if (video.mozCaptureStream) {
      stream = video.mozCaptureStream();
    } else {
      throw new Error('浏览器不支持 captureStream');
    }

    // 只保留音频轨道
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new Error('视频没有音频轨道');
    }

    const audioStream = new MediaStream(audioTracks);

    // 选择支持的 MIME 类型
    let mimeType = 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/webm')) {
      mimeType = 'audio/webm';
    } else {
      mimeType = '';
    }

    const chunks = [];
    const options = mimeType ? { mimeType } : undefined;
    const recorder = new MediaRecorder(audioStream, options);

    return new Promise((resolve, reject) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        try {
          const recordedBlob = new Blob(chunks, { type: mimeType || 'audio/webm' });
          console.log('[Audio] MediaRecorder 录制完成，原始格式大小:', recordedBlob.size);

          // 尝试转换为 WAV（如果浏览器支持 Web Audio）
          try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
              const ctx = new AudioContext();
              const arrayBuffer = await recordedBlob.arrayBuffer();
              const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
              const wavBlob = this.bufferToWav(audioBuffer, 16000);
              await ctx.close();
              resolve(wavBlob);
              return;
            }
          } catch (e) {
            console.warn('[Audio] 转换 WAV 失败，返回原始格式:', e.message);
          }

          resolve(recordedBlob);
        } catch (err) {
          reject(err);
        }
      };

      recorder.onerror = (e) => reject(e.error || new Error('录制失败'));

      // 跳转到开始位置
      video.currentTime = startTime;

      // 等待 seek 完成
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        try {
          recorder.start();
          video.play();

          // 录制 duration 秒后停止
          setTimeout(() => {
            if (recorder.state === 'recording') {
              recorder.stop();
              video.pause();
            }
          }, duration * 1000);
        } catch (e) {
          reject(e);
        }
      };

      video.addEventListener('seeked', onSeeked);
    });
  },

  // ========== Whisper 语音识别 ==========

  /**
   * 加载 Whisper 模型（支持国内 CDN）
   */
  async loadWhisperModel(onProgress) {
    if (this.whisperPipeline) {
      console.log('[Whisper] 模型已加载');
      if (onProgress) onProgress({ status: 'ready' });
      return this.whisperPipeline;
    }

    // 检查 transformers 是否可用
    if (typeof pipeline === 'undefined' && window.transformers) {
      window.pipeline = window.transformers.pipeline;
    }

    if (typeof pipeline === 'undefined') {
      throw new Error('Transformers.js 未加载，请刷新页面重试');
    }

    // 配置 Transformers.js 环境变量，禁用本地模型加载，使用远程CDN
    if (window.transformers && window.transformers.env) {
      window.transformers.env.allowLocalModels = false;
      window.transformers.env.allowRemoteModels = true;
      console.log('[Whisper] Transformers.js env configured: remote-only mode');
    }

    console.log('[Whisper] ========== 加载语音模型 ==========');
    console.log('[Whisper] 模型: Xenova/whisper-tiny (约39MB)');
    console.log('[Whisper] 首次加载需要下载模型，后续会缓存到浏览器');

    VibeApp.showToast('正在下载语音模型（约39MB，国内CDN）...', 'info');

    // 尝试多个 CDN 源
    const cdnSources = [
      {
        name: 'jsDelivr CDN',
        config: {
          remoteHost: 'https://cdn.jsdelivr.net',
          remotePathTemplate: 'npm/@xenova/transformers@2/dist/{model}/{file}',
        }
      },
      {
        name: 'unpkg CDN',
        config: {
          remoteHost: 'https://unpkg.com',
          remotePathTemplate: '@xenova/transformers@2/dist/{model}/{file}',
        }
      },
      {
        name: 'Hugging Face 镜像',
        config: {
          remoteHost: 'https://hf-mirror.com',
          remotePathTemplate: '{model}/resolve/main/{file}',
        }
      }
    ];

    const maxRetries = 2;

    for (let sourceIdx = 0; sourceIdx < cdnSources.length; sourceIdx++) {
      const source = cdnSources[sourceIdx];
      console.log(`[Whisper] 尝试从 ${source.name} 加载模型...`);

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[Whisper] 第 ${attempt}/${maxRetries} 次尝试 (${source.name})`);

          // 超时检测：如果 90 秒内没有完成，抛出超时错误
          let lastProgressTime = Date.now();
          let loadTimeout = setTimeout(() => {
            if (!this.whisperPipeline) {
              console.error('[Whisper] 模型加载超时（90秒无响应）');
              throw new Error('模型下载超时，可能是网络问题。请检查网络连接后重试，或使用其他方式导入字幕。');
            }
          }, 90000);

          const modelOptions = {
            quantized: true,
            progress_callback: (progress) => {
              if (progress.status === 'downloading') {
                const percent = progress.progress ? Math.round(progress.progress) : 0;
                const file = progress.file || '';
                if (percent > 0) {
                  console.log(`[Whisper] 下载进度: ${percent}% - ${file}`);
                  // 转发下载进度到 onProgress
                  if (onProgress) onProgress({ status: 'progress', progress: progress.progress || 0, file: file, loaded: progress.loaded, total: progress.total });
                  const recognizeBtn = document.getElementById('recognizeSegmentBtn');
                  if (recognizeBtn) {
                    recognizeBtn.innerHTML = `<span>⏳</span> 下载模型 ${percent}%`;
                    recognizeBtn.disabled = true;
                  }
                  const autoBtn = document.getElementById('autoGenerateBtn');
                  if (autoBtn && autoBtn.textContent.includes('模型')) {
                    autoBtn.innerHTML = `<span>⏳</span> 下载模型 ${percent}%`;
                  }
                }
              } else if (progress.status === 'loading') {
                console.log('[Whisper] 正在加载模型到内存...');
                if (onProgress) onProgress({ status: 'loading', name: progress.name || '' });
                const recognizeBtn = document.getElementById('recognizeSegmentBtn');
                if (recognizeBtn) {
                  recognizeBtn.innerHTML = '<span>⏳</span> 加载模型中...';
                }
                const autoBtn = document.getElementById('autoGenerateBtn');
                if (autoBtn && autoBtn.textContent.includes('模型')) {
                  autoBtn.innerHTML = '<span>⏳</span> 加载模型中...';
                }
              }
            },
            ...source.config
          };

          this.whisperPipeline = await pipeline(
            'automatic-speech-recognition',
            'Xenova/whisper-tiny',
            modelOptions
          );

          // 清除超时检测
          if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null; }

          console.log('[Whisper] ✅ 模型加载成功');
          if (onProgress) onProgress({ status: 'ready' });
          VibeApp.showToast('语音模型加载成功', 'success');

          // 恢复按钮
          const btn = document.getElementById('recognizeSegmentBtn');
          if (btn) {
            btn.innerHTML = '<span class="btn-icon icon-20" data-icon="mic"></span><span>识别区间</span>';
            btn.disabled = false;
          }

          return this.whisperPipeline;

        } catch (error) {
          if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null; }
          console.error(`[Whisper] 加载失败 (${source.name} 第 ${attempt} 次):`, error.message);

          // 特殊错误处理
          if (error.message.includes('超时') || error.message.includes('timeout')) {
            console.warn('[Whisper] 下载超时，尝试下一个CDN源...');
            break; // 超时直接试下一个源
          }

          if (error.message.includes('404') || error.message.includes('Not Found')) {
            console.warn('[Whisper] 文件不存在，尝试下一个CDN源...');
            break; // 404 直接试下一个源
          }

          if (error.message.includes('CORS') || error.message.includes('cross-origin')) {
            console.warn('[Whisper] CORS 问题，尝试下一个CDN源...');
            break; // CORS 直接试下一个源
          }

          if (attempt < maxRetries) {
            console.log('[Whisper] 等待2秒后重试...');
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }
    }

    // 所有源都失败
    const btn = document.getElementById('recognizeSegmentBtn');
    if (btn) {
      btn.innerHTML = '<span class="btn-icon icon-20" data-icon="mic"></span><span>识别区间</span>';
      btn.disabled = false;
    }

    throw new Error('语音模型加载失败，请检查网络连接或稍后重试');
  },

  /**
   * 将音频 Blob 解码为 Float32Array 供 Whisper 使用
   */
  async decodeAudioForWhisper(audioBlob) {
    console.log('[Whisper] 解码音频数据...');

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      throw new Error('浏览器不支持 Web Audio API');
    }

    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new AudioContext();

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // 重采样到 16000Hz（如果需要）
      let targetBuffer;
      if (audioBuffer.sampleRate === 16000) {
        targetBuffer = audioBuffer;
      } else {
        console.log(`[Whisper] 重采样: ${audioBuffer.sampleRate}Hz → 16000Hz`);
        const offlineCtx = new OfflineAudioContext(1, audioBuffer.length * 16000 / audioBuffer.sampleRate, 16000);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start(0);
        targetBuffer = await offlineCtx.startRendering();
      }

      // 获取第一声道数据
      const channelData = targetBuffer.getChannelData(0);

      console.log('[Whisper] 音频解码完成，采样率:', targetBuffer.sampleRate, 'Hz, 时长:', (channelData.length / 16000).toFixed(2), '秒');

      await audioContext.close();
      return channelData;

    } catch (error) {
      try { await audioContext.close(); } catch(e) {}
      throw error;
    }
  },

  /**
   * 识别区间语音
   */
  async recognizeSegment() {
    console.log('[Recognize] ========== 识别区间语音 ==========');

    // 检查是否有视频
    if (!this.videoUrl || !this.videoFile) {
      VibeApp.showToast('请先导入视频', 'error');
      return;
    }

    // 检查是否有标记区间
    if (this.markedStartTime === null || this.markedEndTime === null) {
      VibeApp.showToast('请先标记开始和结束时间', 'error');
      return;
    }

    const startTime = Math.min(this.markedStartTime, this.markedEndTime);
    const endTime = Math.max(this.markedStartTime, this.markedEndTime);
    const duration = endTime - startTime;

    if (duration < 0.5) {
      VibeApp.showToast('区间太短了（至少需要0.5秒）', 'error');
      return;
    }

    if (duration > 60) {
      VibeApp.showToast('区间太长了（建议不超过60秒）', 'error');
      return;
    }

    const recognizeBtn = document.getElementById('recognizeSegmentBtn');
    const originalBtnText = recognizeBtn?.innerHTML;

    try {
      // 1. 提取区间音频
      console.log('[Recognize] 步骤1: 提取区间音频');
      if (recognizeBtn) {
        recognizeBtn.innerHTML = '<span>⏳</span> 提取音频中...';
        recognizeBtn.disabled = true;
      }

      const audioBlob = await this.extractSegmentAudio(startTime, endTime);
      console.log('[Recognize] 音频提取成功，大小:', audioBlob.size, '字节');

      if (!audioBlob || audioBlob.size === 0) {
        throw new Error('音频片段为空');
      }

      // 2. 加载 Whisper 模型
      console.log('[Recognize] 步骤2: 加载语音模型');
      if (recognizeBtn) {
        recognizeBtn.innerHTML = '<span>⏳</span> 加载模型中...';
      }

      const pipeline = await this.loadWhisperModel();
      if (!pipeline) {
        throw new Error('模型加载失败');
      }

      // 3. 解码音频
      console.log('[Recognize] 步骤3: 解码音频');
      if (recognizeBtn) {
        recognizeBtn.innerHTML = '<span>⏳</span> 解码音频中...';
      }

      const audioData = await this.decodeAudioForWhisper(audioBlob);

      if (audioData.length === 0) {
        throw new Error('音频数据为空');
      }

      // 4. 进行识别
      console.log('[Recognize] 步骤4: 语音识别中...');
      if (recognizeBtn) {
        recognizeBtn.innerHTML = '<span>⏳</span> 识别中...';
      }

      // 获取当前配置参数
      const langSelect = document.getElementById('recognizeLang');
      const tempSlider = document.getElementById('recognizeTemperature');
      const beamSlider = document.getElementById('recognizeBeamSize');
      const penaltySlider = document.getElementById('recognizeRepetitionPenalty');

      const whisperLangMap = {
        'zh': 'zh', 'en': 'en', 'ja': 'ja', 'ko': 'ko',
        'fr': 'fr', 'de': 'de', 'es': 'es'
      };
      const selectedLang = langSelect?.value || this.recognizeLanguage || 'zh';
      const whisperLang = whisperLangMap[selectedLang] || selectedLang;

      const recognizeParams = {
        language: whisperLang,
        temperature: parseFloat(tempSlider?.value || '0.0'),
        beam_size: parseInt(beamSlider?.value || '5'),
        repetition_penalty: parseFloat(penaltySlider?.value || '1.0'),
        task: 'transcribe',
      };

      console.log('[Recognize] 使用语言:', whisperLang, '参数:', recognizeParams);

      const result = await pipeline(audioData, recognizeParams);

      console.log('[Recognize] ✅ 识别结果:', result.text);

      const recognizedText = (result.text || '').trim();

      if (!recognizedText) {
        VibeApp.showToast('未识别到语音内容', 'info');
        return;
      }

      // 5. 填入当前字幕（或新建字幕）
      if (this.selectedSubtitleIndex >= 0 && this.subtitles[this.selectedSubtitleIndex]) {
        this.subtitles[this.selectedSubtitleIndex].originalText = recognizedText;
        console.log('[Recognize] 已填入选中字幕的原文');
      } else {
        // 新建一条字幕
        const newSubtitle = {
          id: Date.now() + Math.random(),
          startTime: startTime,
          endTime: endTime,
          originalText: recognizedText,
          translatedText: '',
          translationSource: null,
          style: null,
          isLoading: false,
          track: this.currentTrack || 'main'
        };
        this.subtitles.push(newSubtitle);
        this.sortSubtitles();
        this.selectedSubtitleIndex = this.subtitles.findIndex(s => s.id === newSubtitle.id);
        console.log('[Recognize] 已新建字幕');
      }

      this.renderTrackTabs();
      this.renderTimeline();
      this.updateUI();
      this.saveSubtitles();

      VibeApp.showToast('识别成功', 'success');

    } catch (error) {
      console.error('[Recognize] ❌ 识别失败:', error);
      console.error('[Recognize] 错误详情:', error.stack || error.message);
      VibeApp.showToast('识别失败: ' + error.message, 'error');
    } finally {
      // 恢复按钮
      if (recognizeBtn) {
        recognizeBtn.innerHTML = originalBtnText || '<span class="btn-icon icon-20" data-icon="mic"></span><span>识别区间</span>';
        recognizeBtn.disabled = false;
      }
    }
  },
  
  async bufferToWav(audioBuffer, sampleRate) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleCount = audioBuffer.length;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = sampleCount * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    let offset = 44;
    const channelData = audioBuffer.getChannelData(0);
    
    for (let i = 0; i < sampleCount; i++) {
      let sample = Math.max(-1, Math.min(1, channelData[i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
  },
  
  // 使用 FFmpeg.wasm 切割指定区间音频
  async cutAudioWithFFmpeg(videoFile, startTime, duration) {
    if (!this.ffmpeg) {
      let FFmpeg;
      
      if (!window.FFmpegWASM) {
        const script = document.createElement('script');
        script.src = '/public/ffmpeg/ffmpeg.min.js';
        script.async = false;
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = () => reject(new Error('FFmpeg 加载失败'));
          document.head.appendChild(script);
        });
      }
      
      FFmpeg = window.FFmpegWASM.FFmpeg;
      
      this.ffmpeg = new FFmpeg();
      await this.ffmpeg.load({
        coreURL: '/public/ffmpeg/ffmpeg-core.js',
        wasmURL: '/public/ffmpeg/ffmpeg-core.wasm'
      });
    }
    
    let fileData;
    if (typeof videoFile === 'string') {
      fileData = await fetch(videoFile).then(r => r.arrayBuffer());
    } else if (videoFile instanceof File || videoFile instanceof Blob) {
      fileData = await videoFile.arrayBuffer();
    } else {
      throw new Error('不支持的文件类型');
    }
    await this.ffmpeg.writeFile('input.mp4', new Uint8Array(fileData));
    
    await this.ffmpeg.exec([
      '-i', 'input.mp4',
      '-ss', startTime.toString(),
      '-t', duration.toString(),
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-f', 'wav',
      'output.wav'
    ]);
    
    const audioData = await this.ffmpeg.readFile('output.wav');
    return new Blob([audioData.buffer], { type: 'audio/wav' });
  },
  
  // 加载 Vosk 模型
  async loadVoskModel() {
    if (this.voskModel) {
      return this.voskModel;
    }
    
    console.log('[Vosk] Loading Vosk model...');
    
    if (!window.Vosk) {
      const script = document.createElement('script');
      script.src = '/public/vosk/vosk.js';
      script.async = false;
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = () => reject(new Error('Vosk 加载失败'));
        document.head.appendChild(script);
      });
    }
    
    const { Model } = window.Vosk;
    
    const langMap = {
      'zh': '/public/models/vosk/zh-cn',
      'en': '/public/models/vosk/en-us',
      'ja': '/public/models/vosk/ja',
      'ko': '/public/models/vosk/ko'
    };
    
    const modelUrl = langMap[this.recognizeLanguage] || langMap['zh'];
    
    this.voskModel = new Model(modelUrl);
    console.log('[Vosk] Model loaded successfully from local');
    
    return this.voskModel;
  },
  
  // 使用 Vosk 识别音频（支持分段和时间戳）
  async transcribeWithVosk(audioBlob) {
    if (!this.voskModel) {
      await this.loadVoskModel();
    }
    
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    const { Recognizer } = window.Vosk;
    const recognizer = new Recognizer({
      model: this.voskModel,
      sampleRate: audioBuffer.sampleRate,
      grammar: null,
      maxAlternatives: 1
    });
    
    const results = [];
    const channelData = audioBuffer.getChannelData(0);
    const chunkSize = Math.floor(audioBuffer.sampleRate * 0.5);
    const sampleRate = audioBuffer.sampleRate;
    let currentTime = 0;
    
    for (let i = 0; i < channelData.length; i += chunkSize) {
      const chunk = channelData.slice(i, Math.min(i + chunkSize, channelData.length));
      const isFinal = i + chunkSize >= channelData.length;
      
      const result = recognizer.acceptWaveform(chunk);
      if (result && result.text && result.text.trim()) {
        results.push({
          text: result.text,
          startTime: currentTime,
          endTime: currentTime + chunk.length / sampleRate
        });
      }
      
      currentTime += chunk.length / sampleRate;
      
      if (isFinal) {
        const finalResult = recognizer.finalResult();
        if (finalResult && finalResult.text && finalResult.text.trim()) {
          results.push({
            text: finalResult.text,
            startTime: currentTime - 0.5,
            endTime: currentTime
          });
        }
      }
    }
    
    recognizer.free();
    audioContext.close();
    
    return results;
  },
  
  // 解析 Vosk 识别结果，生成字幕列表
  parseVoskResult(voskResults, audioBlob) {
    const results = [];
    
    if (Array.isArray(voskResults)) {
      voskResults.forEach((item, index) => {
        if (item.text && item.text.trim()) {
          results.push({
            text: item.text.trim(),
            startTime: item.startTime || index * 3,
            endTime: item.endTime || (index + 1) * 3
          });
        }
      });
    } else if (typeof voskResults === 'string' && voskResults.trim()) {
      const sentences = voskResults.trim().split(/[。！？.!?]/).filter(s => s.trim());
      const duration = audioBlob.size / (16000 * 2);
      const avgDuration = duration / Math.max(sentences.length, 1);
      
      sentences.forEach((sentence, index) => {
        if (sentence.trim()) {
          results.push({
            text: sentence.trim(),
            startTime: index * avgDuration,
            endTime: (index + 1) * avgDuration
          });
        }
      });
    }
    
    return results;
  },
  
  // 将WAV Blob转换为Float32Array（供Whisper识别）
  async blobToFloat32Array(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      // 获取第一个声道的数据
      const channelData = audioBuffer.getChannelData(0);
      return channelData;
    } finally {
      audioContext.close();
    }
  },
  
  // 前端截取指定区间的音频
  async extractAudioSegment(startTime, endTime) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    
    if (!AudioContextClass) {
      throw new Error('浏览器不支持AudioContext');
    }
    
    const audioContext = new AudioContextClass();
    const sampleRate = 16000;
    
    try {
      // 使用 fetch 获取视频文件
      const fileUrl = URL.createObjectURL(this.videoFile);
      
      console.log('[Extract] Fetching video from blob URL...');
      
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch video file');
      }
      
      const arrayBuffer = await response.arrayBuffer();
      console.log('[Extract] Decoding audio data...');
      
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      console.log('[Extract] Audio decoded, sample rate:', audioBuffer.sampleRate);
      
      // 获取原始采样率
      const originalSampleRate = audioBuffer.sampleRate;
      
      // 计算时间范围内的样本
      const startSample = Math.floor(startTime * originalSampleRate);
      const endSample = Math.min(Math.floor(endTime * originalSampleRate), audioBuffer.length);
      const segmentLength = endSample - startSample;
      
      if (segmentLength <= 0) {
        URL.revokeObjectURL(fileUrl);
        audioContext.close();
        throw new Error('无效的时间范围');
      }
      
      // 创建新的 buffer 存储片段
      const segmentBuffer = audioContext.createBuffer(
        1,
        segmentLength,
        originalSampleRate
      );
      
      // 复制音频数据
      const sourceData = audioBuffer.getChannelData(0);
      const segmentData = segmentBuffer.getChannelData(0);
      for (let i = 0; i < segmentLength; i++) {
        segmentData[i] = sourceData[startSample + i] || 0;
      }
      
      // 如果需要重采样
      if (originalSampleRate !== sampleRate) {
        console.log('[Extract] Resampling from', originalSampleRate, 'to', sampleRate);
        const resampledData = await this.resampleAudioBuffer(audioContext, segmentBuffer, sampleRate);
        URL.revokeObjectURL(fileUrl);
        audioContext.close();
        // 返回 WAV Blob
        return this.float32ArrayToWavBlob(resampledData, sampleRate);
      } else {
        URL.revokeObjectURL(fileUrl);
        audioContext.close();
        // 返回 WAV Blob
        return this.float32ArrayToWavBlob(segmentData, originalSampleRate);
      }
      
    } catch (error) {
      console.error('[Extract] Error:', error);
      audioContext.close();
      throw new Error('音频解码失败: ' + error.message);
    }
  },
  
  // 重采样音频buffer（异步）
  async resampleAudioBuffer(audioContext, buffer, targetSampleRate) {
    const numberOfChannels = 1;
    const duration = buffer.duration;
    const targetLength = Math.ceil(duration * targetSampleRate);
    
    console.log('[Resample] Creating OfflineAudioContext for', targetLength, 'samples at', targetSampleRate, 'Hz');
    
    const offlineContext = new OfflineAudioContext(
      numberOfChannels,
      targetLength,
      targetSampleRate
    );
    
    const source = offlineContext.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineContext.destination);
    source.start(0);
    
    // startRendering 返回 Promise
    const renderedBuffer = await offlineContext.startRendering();
    console.log('[Resample] Rendering complete, length:', renderedBuffer.length);
    
    return renderedBuffer.getChannelData(0);
  },
  
  // 将AudioBuffer转换为WAV格式的Blob
  bufferToWav(buffer) {
    const sampleRate = buffer.sampleRate;
    const numberOfChannels = buffer.numberOfChannels;
    const length = buffer.length * numberOfChannels * 2 + 44;
    const bufferArray = new ArrayBuffer(length);
    const view = new DataView(bufferArray);
    
    // WAV header
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + buffer.length * numberOfChannels * 2, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2 * numberOfChannels, true);
    view.setUint16(32, numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, buffer.length * numberOfChannels * 2, true);
    
    // Audio data
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
        view.setInt16(offset, sample * 0x7FFF, true);
        offset += 2;
      }
    }
    
    return new Blob([bufferArray], { type: 'audio/wav' });
  },
  
  // 写入字符串到DataView
  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  },
  
  // 将 Float32Array 转换为 WAV Blob
  float32ArrayToWavBlob(float32Array, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const dataLength = float32Array.length * bytesPerSample * numChannels;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    
    let offset = 0;
    
    // RIFF header
    this.writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, 36 + dataLength, true); offset += 4;
    this.writeString(view, offset, 'WAVE'); offset += 4;
    
    // fmt chunk
    this.writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4; // chunk size
    view.setUint16(offset, 1, true); offset += 2; // audio format (PCM)
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, sampleRate * bytesPerSample * numChannels, true); offset += 4;
    view.setUint16(offset, bytesPerSample * numChannels, true); offset += 2; // block align
    view.setUint16(offset, bitsPerSample, true); offset += 2;
    
    // data chunk
    this.writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, dataLength, true); offset += 4;
    
    // Write samples
    for (let i = 0; i < float32Array.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, Math.round(intSample), true);
      offset += 2;
    }
    
    console.log('[WAV] Created WAV blob, size:', buffer.byteLength, 'bytes, samples:', float32Array.length, 'duration:', float32Array.length / sampleRate, 's');
    return new Blob([buffer], { type: 'audio/wav' });
  },

  // ========== 音频导出功能 ==========

  /**
   * 导出纯音频
   * 从当前视频提取音频并下载为 WAV 文件
   */
  async exportAudio() {
    const video = document.getElementById('subtitleVideo');
    // 综合判断视频是否就绪：src、source 子元素、videoFile、videoUrl
    const sourceEl = video?.querySelector('source');
    const hasVideoSrc = video && (video.src || (sourceEl && sourceEl.src) || this.videoUrl || this.videoFile);
    if (!hasVideoSrc) {
      VibeApp.showToast('请先导入视频', 'error');
      return;
    }

    VibeApp.showToast('正在提取音频...', 'info');

    try {
      // 优先使用 videoFile（File 对象），避免 fetch blob URL 的跨域问题
      let arrayBuffer;
      if (this.videoFile) {
        arrayBuffer = await this.videoFile.arrayBuffer();
      } else {
        const videoSrc = video.src || (sourceEl && sourceEl.src) || this.videoUrl;
        const response = await fetch(videoSrc);
        arrayBuffer = await response.arrayBuffer();
      }

      // 使用 Web Audio API 提取音频
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // 转换为 WAV 格式
      const wavBlob = this.audioBufferToWav(audioBuffer);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (this.videoFile?.name || 'audio').replace(/\.[^.]+$/, '') + '_audio.wav';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      VibeApp.showToast('音频导出成功', 'success');
    } catch (error) {
      console.error('Audio export error:', error);

      // 备用方案：使用 MediaRecorder 录制
      try {
        await this.exportAudioWithMediaRecorder();
      } catch (err2) {
        console.error('MediaRecorder export failed:', err2);
        VibeApp.showToast('音频导出失败: ' + (err2.message || err2), 'error');
      }
    }
  },

  /**
   * 导出整片视频（烧录字幕）
   * 使用 canvas 渲染视频帧 + 字幕，再用 MediaRecorder 录制成视频文件
   * @param {string} format - 'mp4' 或 'webm'
   */
  async exportVideoWithSubtitles(format = 'webm') {
    const video = document.getElementById('subtitleVideo');
    // 综合判断视频是否就绪：src、source 子元素、videoFile、readyState
    const sourceEl = video?.querySelector('source');
    const hasVideoSrc = video && (video.src || (sourceEl && sourceEl.src) || this.videoUrl || this.videoFile);
    if (!hasVideoSrc) {
      VibeApp.showToast('请先导入视频', 'error');
      return;
    }
    if (this.subtitles.length === 0) {
      VibeApp.showToast('没有字幕可烧录', 'info');
      return;
    }
    // 若 src 未设置到 video 元素（仅 videoFile 存在），先临时设置
    if (video && !video.src && this.videoUrl) {
      video.src = this.videoUrl;
    }
    // 等待视频可播放
    if (video && video.readyState < 2) {
      VibeApp.showToast('视频正在加载，请稍候再试...', 'info');
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('视频加载超时')), 15000);
          video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
          video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('视频加载失败')); }, { once: true });
          video.load();
        });
      } catch (e) {
        VibeApp.showToast(e.message, 'error');
        return;
      }
    }

    // 检查 MediaRecorder 支持
    if (typeof MediaRecorder === 'undefined') {
      VibeApp.showToast('当前浏览器不支持视频录制，请使用 Chrome/Edge', 'error');
      return;
    }

    // 选择最优 mimeType
    const mimeCandidates = format === 'mp4'
      ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus']
      : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    let mimeType = null;
    for (const m of mimeCandidates) {
      if (MediaRecorder.isTypeSupported(m)) { mimeType = m; break; }
    }
    if (!mimeType) {
      VibeApp.showToast('当前浏览器不支持所选视频编码，已回退到 WebM', 'info');
      mimeType = 'video/webm';
      format = 'webm';
    }

    // 弹出导出选项
    const confirmed = await this._showVideoExportConfirm(format, mimeType);
    if (!confirmed) return;

    VibeApp.showToast('开始录制视频，请等待完成...', 'info');

    try {
      const canvas = document.createElement('canvas');
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      // 创建视频流（canvas 视频 + 原视频音频）
      const canvasStream = canvas.captureStream(30);
      const videoStream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
      const audioTracks = videoStream ? videoStream.getAudioTracks() : [];
      audioTracks.forEach(track => canvasStream.addTrack(track));

      const recorder = new MediaRecorder(canvasStream, {
        mimeType,
        videoBitsPerSecond: 4_000_000,
        audioBitsPerSecond: 128_000
      });

      const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      const recordingDone = new Promise((resolve) => {
        recorder.onstop = () => resolve();
      });

      // 创建进度条
      const progressOverlay = this._createExportProgress(video.duration);

      // 静音播放（不输出原视频声音，只录制到流中）
      const originalMuted = video.muted;
      const originalVolume = video.volume;
      video.muted = true;
      video.volume = 0;

      recorder.start(100);
      video.currentTime = 0;
      await new Promise(r => setTimeout(r, 100));
      await video.play();

      let rafId = null;
      const renderFrame = () => {
        if (video.paused || video.ended) {
          // 仍在录制则停止
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        // 绘制视频帧
        ctx.drawImage(video, 0, 0, w, h);

        // 绘制当前时间点的字幕
        const t = video.currentTime;
        const active = this.subtitles.filter(s => t >= s.startTime && t <= s.endTime);
        this._drawSubtitlesToCanvas(ctx, active, w, h);

        // 更新进度
        if (progressOverlay) {
          const pct = Math.min(100, (t / video.duration) * 100);
          progressOverlay.update(pct);
        }

        rafId = requestAnimationFrame(renderFrame);
      };
      rafId = requestAnimationFrame(renderFrame);

      // 视频结束后停止
      const onEnded = async () => {
        cancelAnimationFrame(rafId);
        // 绘制最后一帧
        ctx.drawImage(video, 0, 0, w, h);
        if (recorder.state !== 'inactive') recorder.stop();
        await recordingDone;
        video.muted = originalMuted;
        video.volume = originalVolume;
        video.removeEventListener('ended', onEnded);
        if (progressOverlay) progressOverlay.close();

        const blob = new Blob(chunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (this.videoFile?.name || 'project').replace(/\.[^.]+$/, '') + `_subtitled.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        VibeApp.showToast(`视频导出成功（${(blob.size / 1024 / 1024).toFixed(1)} MB）`, 'success');
      };
      video.addEventListener('ended', onEnded);

      // 失败兜底：用户手动停止
      video.addEventListener('pause', function onPause() {
        if (video.ended) return;
        // 不在中间暂停时停止录制（防止用户误操作）
      });

    } catch (error) {
      console.error('Video export error:', error);
      VibeApp.showToast('视频导出失败: ' + (error.message || error), 'error');
    }
  },

  /**
   * 在 canvas 上绘制字幕（按轨道位置区分顶部/底部）
   */
  _drawSubtitlesToCanvas(ctx, subtitles, canvasW, canvasH) {
    if (!subtitles || subtitles.length === 0) return;

    const globalStyle = this.globalStyleSettings || {};

    // 按轨道分组
    const trackGroups = {};
    subtitles.forEach(sub => {
      const trackId = sub.track || 'main';
      if (!trackGroups[trackId]) trackGroups[trackId] = [];
      trackGroups[trackId].push(sub);
    });

    // 先绘制底部轨道（按 trackDefinitions 顺序），再绘制顶部轨道
    const allTracks = this.getAllTracks();
    const bottomTracks = allTracks.filter(t => t.position !== 'top');
    const topTracks = allTracks.filter(t => t.position === 'top');

    let bottomYOffset = 0;
    let topYOffset = 0;

    const drawGroup = (track, subs, position) => {
      const trackStyle = track.style || {};
      const fontSize = parseInt(trackStyle.fontSize || globalStyle.fontSize || 24);
      const fontFamily = trackStyle.fontFamily || globalStyle.fontFamily || 'sans-serif';
      const primaryColor = trackStyle.primaryColor || globalStyle.primaryColor || '#FFFFFF';
      const outlineColor = trackStyle.outlineColor || globalStyle.outlineColor || '#000000';
      const outlineWidth = parseInt(trackStyle.outlineWidth || globalStyle.outlineWidth || 2);
      const marginV = parseInt(globalStyle.marginV || 30);
      const italic = trackStyle.italic;
      const bold = trackStyle.bold !== false;

      ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontSize * 2}px ${fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      let yOffset = position === 'top' ? topYOffset : bottomYOffset;

      for (const sub of subs) {
        const texts = [];
        const displayMode = sub.displayMode || globalStyle.displayMode || 'both';
        if (sub.originalText && (displayMode === 'both' || displayMode === 'original')) {
          texts.push({ text: sub.originalText, color: primaryColor });
        }
        if (sub.translatedText && (displayMode === 'both' || displayMode === 'translated')) {
          const transColor = trackStyle.translatedColor || globalStyle.translatedColor || '#FFFF00';
          texts.push({ text: sub.translatedText, color: transColor });
        }

        for (const { text, color } of texts) {
          const lines = this._wrapText(ctx, text, canvasW * 0.9);
          const lineHeight = fontSize * 2 * 1.3;
          const blockHeight = lines.length * lineHeight;

          let baseY;
          if (position === 'top') {
            baseY = marginV * 2 + yOffset;
          } else {
            baseY = canvasH - marginV * 2 - blockHeight - yOffset;
          }

          for (let i = 0; i < lines.length; i++) {
            const y = baseY + i * lineHeight + lineHeight / 2;
            const x = canvasW / 2;
            ctx.lineJoin = 'round';
            ctx.lineWidth = outlineWidth * 2;
            ctx.strokeStyle = outlineColor;
            ctx.strokeText(lines[i], x, y);
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            ctx.fillStyle = color;
            ctx.fillText(lines[i], x, y);
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
          }
          yOffset += blockHeight + 10;
        }
      }

      if (position === 'top') topYOffset = yOffset;
      else bottomYOffset = yOffset;
    };

    // 先底部轨道
    for (const track of bottomTracks) {
      const subs = trackGroups[track.id] || [];
      if (subs.length > 0 && track.enabled !== false) drawGroup(track, subs, 'bottom');
    }
    // 再顶部轨道
    for (const track of topTracks) {
      const subs = trackGroups[track.id] || [];
      if (subs.length > 0 && track.enabled !== false) drawGroup(track, subs, 'top');
    }
  },

  /**
   * 文本换行（按 canvas 宽度）
   */
  _wrapText(ctx, text, maxWidth) {
    const lines = [];
    // 按已有换行符分割
    const paragraphs = text.split('\n');
    for (const para of paragraphs) {
      if (!para) continue;
      let current = '';
      for (const ch of para) {
        const test = current + ch;
        if (ctx.measureText(test).width > maxWidth && current) {
          lines.push(current);
          current = ch;
        } else {
          current = test;
        }
      }
      if (current) lines.push(current);
    }
    return lines.length > 0 ? lines : [''];
  },

  /**
   * 显示视频导出确认弹窗
   */
  async _showVideoExportConfirm(format, mimeType) {
    return new Promise(resolve => {
      const existing = document.getElementById('videoExportConfirm');
      if (existing) existing.remove();
      const modal = document.createElement('div');
      modal.id = 'videoExportConfirm';
      modal.className = 'modal-overlay show';
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 480px;">
          <button class="modal-close-btn" onclick="document.getElementById('videoExportConfirm').remove(); window._videoExportConfirmResolve(false);">✕</button>
          <h3 style="margin-bottom: 16px;">🎬 导出整片视频</h3>
          <div style="font-size: 13px; line-height: 1.7; color: var(--text-secondary); margin-bottom: 16px;">
            <p>将导出 <strong style="color: var(--primary-color);">${format.toUpperCase()}</strong> 视频文件，烧录当前所有字幕到视频画面中。</p>
            <p>编码: <code style="background: var(--bg-secondary); padding: 2px 6px; border-radius: 3px;">${mimeType}</code></p>
            <p style="color: var(--warning-color);">⚠️ 注意事项：</p>
            <ul style="margin-left: 20px; margin-top: 8px;">
              <li>导出过程将自动播放视频并实时录制，<strong>请勿关闭或切换页面</strong></li>
              <li>导出时长与视频时长一致（实时录制）</li>
              <li>字幕样式使用当前全局样式设置</li>
              <li>大视频文件导出可能占用较多内存</li>
            </ul>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="document.getElementById('videoExportConfirm').remove(); window._videoExportConfirmResolve(false);">取消</button>
            <button class="btn btn-primary" onclick="document.getElementById('videoExportConfirm').remove(); window._videoExportConfirmResolve(true);">开始导出</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      window._videoExportConfirmResolve = (v) => { resolve(v); delete window._videoExportConfirmResolve; };
    });
  },

  /**
   * 创建导出进度条
   */
  _createExportProgress(totalDuration) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7); z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      flex-direction: column; gap: 20px; color: white;
    `;
    overlay.innerHTML = `
      <div style="font-size: 24px;">🎬 视频录制中...</div>
      <div style="width: 60%; max-width: 500px;">
        <div style="background: rgba(255,255,255,0.2); height: 16px; border-radius: 8px; overflow: hidden;">
          <div class="export-progress-fill" style="background: linear-gradient(90deg, #165dff, #4d9fff); height: 100%; width: 0%; transition: width 0.2s;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 12px;">
          <span class="export-progress-text">0%</span>
          <span class="export-progress-time">0:00 / 0:00</span>
        </div>
      </div>
      <div style="font-size: 12px; color: rgba(255,255,255,0.7);">请勿关闭或切换页面</div>
    `;
    document.body.appendChild(overlay);

    const formatTime = (s) => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    return {
      update(pct) {
        const fill = overlay.querySelector('.export-progress-fill');
        const text = overlay.querySelector('.export-progress-text');
        const time = overlay.querySelector('.export-progress-time');
        if (fill) fill.style.width = pct + '%';
        if (text) text.textContent = pct.toFixed(1) + '%';
        if (time) time.textContent = `${formatTime(pct/100*totalDuration)} / ${formatTime(totalDuration)}`;
      },
      close() { overlay.remove(); }
    };
  },

  /**
   * 备用方案：使用 MediaRecorder 录制音频
   */
  async exportAudioWithMediaRecorder() {
    const video = document.getElementById('subtitleVideo');
    const stream = video.captureStream();
    const audioTracks = stream.getAudioTracks();

    if (audioTracks.length === 0) {
      throw new Error('视频中未检测到音频轨道');
    }

    const audioStream = new MediaStream(audioTracks);
    const recorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
    const chunks = [];

    return new Promise((resolve, reject) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (this.videoFile?.name || 'audio').replace(/\.[^.]+$/, '') + '_audio.webm';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        VibeApp.showToast('音频导出成功', 'success');
        resolve();
      };
      recorder.onerror = reject;

      recorder.start();
      // 录制视频时长的音频
      video.currentTime = 0;
      video.play();

      const checkEnd = setInterval(() => {
        if (video.ended) {
          clearInterval(checkEnd);
          recorder.stop();
          video.pause();
        }
      }, 200);
    });
  },

  /**
   * AudioBuffer 转 WAV Blob
   */
  audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const frames = buffer.length;
    const dataSize = frames * blockAlign;
    const bufferSize = 44 + dataSize;
    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);

    // WAV 文件头
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // 写入音频数据
    const channels = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(buffer.getChannelData(ch));
    }

    let offset = 44;
    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  },

  // ========== 视频裁切功能 ==========

  /**
   * 显示视频裁切弹窗
   */
  showVideoTrimDialog() {
    const video = document.getElementById('subtitleVideo');
    if (!video || !video.src) {
      VibeApp.showToast('请先导入视频', 'error');
      return;
    }

    const duration = video.duration;
    const current = video.currentTime;

    let modal = document.getElementById('videoTrimModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'videoTrimModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
          <button class="modal-close-btn" onclick="document.getElementById('videoTrimModal').classList.remove('show')">✕</button>
          <h3 style="margin-bottom: 16px;">✂️ 视频裁切</h3>
          <div class="trim-info">
            <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">
              设置裁切的起止时间，裁切后可下载视频片段
            </p>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>开始时间</label>
              <input type="number" id="trimStart" class="form-input" value="${Math.floor(current)}" min="0" max="${Math.floor(duration)}" step="0.1">
              <span style="font-size: 11px; color: var(--text-tertiary);">秒</span>
            </div>
            <div class="form-group">
              <label>结束时间</label>
              <input type="number" id="trimEnd" class="form-input" value="${Math.floor(duration)}" min="0" max="${Math.floor(duration)}" step="0.1">
              <span style="font-size: 11px; color: var(--text-tertiary);">秒</span>
            </div>
          </div>
          <div class="form-group">
            <label>预览</label>
            <div class="trim-preview">
              <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.previewTrim()">▶️ 预览片段</button>
              <span id="trimDuration" style="font-size: 12px; color: var(--text-tertiary);"></span>
            </div>
          </div>
          <div class="form-group">
            <label>导出格式</label>
            <select id="trimFormat" class="lang-select">
              <option value="webm">WebM (推荐，速度快)</option>
              <option value="audio">仅音频 (WAV)</option>
            </select>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="document.getElementById('videoTrimModal').classList.remove('show')">取消</button>
            <button class="btn btn-primary" onclick="VibeSubtitles.executeTrim()">🎬 导出片段</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // 输入变化时更新时长显示
      const startInput = document.getElementById('trimStart');
      const endInput = document.getElementById('trimEnd');
      const durationSpan = document.getElementById('trimDuration');
      const updateDuration = () => {
        const start = parseFloat(startInput.value) || 0;
        const end = parseFloat(endInput.value) || 0;
        const dur = end - start;
        durationSpan.textContent = dur > 0 ? `片段时长: ${dur.toFixed(1)}秒` : '请设置有效时间';
      };
      startInput.addEventListener('input', updateDuration);
      endInput.addEventListener('input', updateDuration);
      updateDuration();
    } else {
      document.getElementById('trimStart').value = Math.floor(current);
      document.getElementById('trimEnd').value = Math.floor(duration);
    }

    modal.classList.add('show');
  },

  /**
   * 预览裁切片段
   */
  previewTrim() {
    const video = document.getElementById('subtitleVideo');
    const start = parseFloat(document.getElementById('trimStart').value);
    const end = parseFloat(document.getElementById('trimEnd').value);

    if (isNaN(start) || isNaN(end) || start >= end) {
      VibeApp.showToast('请设置有效的起止时间', 'error');
      return;
    }

    video.currentTime = start;
    video.play();

    const checkEnd = setInterval(() => {
      if (video.currentTime >= end) {
        video.pause();
        clearInterval(checkEnd);
      }
    }, 100);
  },

  /**
   * 执行裁切并导出
   */
  async executeTrim() {
    const video = document.getElementById('subtitleVideo');
    const start = parseFloat(document.getElementById('trimStart').value);
    const end = parseFloat(document.getElementById('trimEnd').value);
    const format = document.getElementById('trimFormat').value;

    if (isNaN(start) || isNaN(end) || start >= end) {
      VibeApp.showToast('请设置有效的起止时间', 'error');
      return;
    }

    if (end - start > 300) {
      if (!confirm('片段超过5分钟，导出可能需要较长时间。确定继续？')) return;
    }

    document.getElementById('videoTrimModal').classList.remove('show');
    VibeApp.showToast('正在导出片段...', 'info');

    try {
      if (format === 'audio') {
        // 仅导出音频片段
        await this.exportAudioSegment(start, end);
      } else {
        // 导出视频片段
        await this.exportVideoSegment(start, end);
      }
    } catch (error) {
      console.error('Trim export error:', error);
      VibeApp.showToast('导出失败: ' + (error.message || error), 'error');
    }
  },

  /**
   * 导出视频片段
   */
  async exportVideoSegment(start, end) {
    const video = document.getElementById('subtitleVideo');
    const stream = video.captureStream();
    const combinedStream = new MediaStream([
      ...stream.getVideoTracks(),
      ...stream.getAudioTracks()
    ]);

    const recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm' });
    const chunks = [];

    return new Promise((resolve, reject) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (this.videoFile?.name || 'video').replace(/\.[^.]+$/, '') + `_trim_${start}-${end}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        VibeApp.showToast('视频片段导出成功', 'success');
        resolve();
      };
      recorder.onerror = reject;

      // 跳到开始位置
      video.currentTime = start;
      video.playbackRate = 1; // 确保正常倍速录制

      video.addEventListener('seeked', function onSeeked() {
        video.removeEventListener('seeked', onSeeked);
        recorder.start();
        video.play();

        const checkEnd = setInterval(() => {
          if (video.currentTime >= end || video.ended) {
            clearInterval(checkEnd);
            recorder.stop();
            video.pause();
          }
        }, 100);
      }, { once: true });
    });
  },

  /**
   * 导出音频片段
   */
  async exportAudioSegment(start, end) {
    const video = document.getElementById('subtitleVideo');
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const response = await fetch(video.src);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.floor(end * sampleRate);
    const length = endSample - startSample;

    const segmentBuffer = audioContext.createBuffer(
      audioBuffer.numberOfChannels,
      length,
      sampleRate
    );

    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const sourceData = audioBuffer.getChannelData(ch);
      const targetData = segmentBuffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        targetData[i] = sourceData[startSample + i];
      }
    }

    const wavBlob = this.audioBufferToWav(segmentBuffer);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (this.videoFile?.name || 'audio').replace(/\.[^.]+$/, '') + `_segment_${start}-${end}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    VibeApp.showToast('音频片段导出成功', 'success');
  },

  // ========== 质检校对工具 ==========

  /**
   * 显示质检校对弹窗
   */
  showQADialog() {
    if (this.subtitles.length === 0) {
      VibeApp.showToast('没有字幕可检查', 'info');
      return;
    }

    const existing = document.getElementById('qaDialogModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'qaDialogModal';
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 720px; max-height: 80vh; display: flex; flex-direction: column;">
        <button class="modal-close-btn" onclick="document.getElementById('qaDialogModal').remove()">✕</button>
        <h3 style="margin-bottom: 12px;">🔍 质检校对工具</h3>
        <div class="qa-tabs">
          <button class="qa-tab active" onclick="VibeSubtitles.runQACheck('all')">全部检查</button>
          <button class="qa-tab" onclick="VibeSubtitles.runQACheck('typos')">错别字</button>
          <button class="qa-tab" onclick="VibeSubtitles.runQACheck('punctuation')">标点符号</button>
          <button class="qa-tab" onclick="VibeSubtitles.runQACheck('numbers')">数字单位</button>
          <button class="qa-tab" onclick="VibeSubtitles.runQACheck('consistency')">一致性</button>
          <button class="qa-tab" onclick="VibeSubtitles.runQACheck('timing')">时间轴</button>
        </div>
        <div id="qaResults" class="qa-results" style="flex: 1; overflow-y: auto; padding: 12px;">
          <p style="color: var(--text-tertiary); text-align: center; padding: 40px 0;">点击上方按钮开始检查</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('qaDialogModal').remove()">关闭</button>
          <button class="btn btn-primary" onclick="VibeSubtitles.runQACheck('all')">🔍 开始检查</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  /**
   * 运行质检检查
   */
  runQACheck(type) {
    // 更新标签状态
    document.querySelectorAll('.qa-tab').forEach(t => t.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');

    const results = [];
    const subtitles = this.subtitles;

    subtitles.forEach((subtitle, index) => {
      if (type === 'all' || type === 'typos') {
        results.push(...this.checkTypos(subtitle, index));
      }
      if (type === 'all' || type === 'punctuation') {
        results.push(...this.checkPunctuation(subtitle, index));
      }
      if (type === 'all' || type === 'numbers') {
        results.push(...this.checkNumbers(subtitle, index));
      }
      if (type === 'all' || type === 'consistency') {
        results.push(...this.checkConsistency(subtitle, index, subtitles));
      }
      if (type === 'all' || type === 'timing') {
        results.push(...this.checkTiming(subtitle, index, subtitles));
      }
    });

    this.renderQAResults(results, type);
  },

  /**
   * 错别字检查
   */
  checkTypos(subtitle, index) {
    const issues = [];
    const texts = [subtitle.originalText, subtitle.translatedText].filter(t => t);

    // 常见错别字词典
    const typoDict = {
      ' zhong ': ' 中 ', ' de ': ' 的 ',
      ' zai ': ' 在 ', ' le ': ' 了 ',
      // 中文常见错别字
      '帐号': '账号', '帐户': '账户',
      '登陆': '登录', '登陆过': '登录过',
      '另人': '令人', '因该': '应该',
      '做为': '作为', '象': '像',
      '既使': '即使', '哪怕': '哪怕',
      '等等等': '等等', '。。。': '…',
      '，，': '，', '。。': '。',
      '！！': '！', '？？': '？',
      '的的': '的', '了了': '了',
      '是是': '是', '在在': '在',
      '中英文': '中英文',
      'english': 'English',
      'chinese': 'Chinese',
      'japanese': 'Japanese',
      'america': 'America',
      'europe': 'Europe',
      'beijing': 'Beijing',
      'shanghai': 'Shanghai'
    };

    texts.forEach((text, textIdx) => {
      const field = textIdx === 0 ? '原文' : '译文';
      // 检查重复字符
      const dupCharRegex = /(.)\1{2,}/g;
      let match;
      while ((match = dupCharRegex.exec(text)) !== null) {
        if (!['…', '—', '-'].includes(match[1])) {
          issues.push({
            type: '重复字符',
            level: 'warning',
            index: index,
            field: field,
            text: text,
            message: `连续重复字符"${match[1]}"出现${match[0].length}次`,
            suggestion: match[1].repeat(Math.min(2, match[0].length)),
            fixType: 'replace',
            findText: match[0],
            replaceText: match[1].repeat(Math.min(2, match[0].length))
          });
        }
      }

      // 检查常见错别字
      for (const [wrong, right] of Object.entries(typoDict)) {
        if (text.includes(wrong) && wrong !== right) {
          issues.push({
            type: '错别字',
            level: 'error',
            index: index,
            field: field,
            text: text,
            message: `可能错别字"${wrong}"`,
            suggestion: right,
            fixType: 'replace',
            findText: wrong,
            replaceText: right
          });
        }
      }

      // 英文首字母大写检查（句首）
      if (textIdx === 1) { // 译文
        const sentences = text.split(/([.!?。！？])/);
        for (let i = 0; i < sentences.length; i++) {
          const sentence = sentences[i];
          const trimmed = sentence.trim();
          if (trimmed && /^[a-z]/.test(trimmed)) {
            const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
            issues.push({
              type: '大小写',
              level: 'warning',
              index: index,
              field: field,
              text: text,
              message: `句首字母未大写: "${trimmed.substr(0, 10)}..."`,
              suggestion: capitalized,
              fixType: 'replace',
              findText: trimmed,
              replaceText: capitalized
            });
          }
        }
      }
    });

    return issues;
  },

  /**
   * 标点符号检查
   */
  checkPunctuation(subtitle, index) {
    const issues = [];
    const texts = [
      { text: subtitle.originalText, field: '原文' },
      { text: subtitle.translatedText, field: '译文' }
    ];

    texts.forEach(({ text, field }) => {
      if (!text) return;

      const hasChinese = /[\u4e00-\u9fa5]/.test(text);

      // ===== 1. 中文文本中出现英文标点（最常见，最严格）=====
      if (hasChinese) {
        // 中文标点对应表
        const punctMap = {
          ',': '，', '.': '。', ';': '；', ':': '：', '!': '！', '?': '？'
        };
        // 检测：中文文本中任何英文标点（但忽略数字小数点如 1.5、3.14，URL、英文句子内的标点）
        // 排除：纯英文片段中的标点（如 "Hello, world."）、版本号 1.5、URL
        // 命中：标点位于中文字符相邻处，或独立使用
        const englishPunctMatches = [];
        // 找出所有英文标点的位置
        const punctRegex = /([,;:!?])/g;
        let m;
        while ((m = punctRegex.exec(text)) !== null) {
          const pos = m.index;
          const punct = m[1];
          const before = text[pos - 1] || '';
          const after = text[pos + 1] || '';
          // 跳过：前后都是英文/数字的情况（视为英文片段）
          if (/[a-zA-Z0-9]/.test(before) && /[a-zA-Z0-9]/.test(after)) continue;
          // 跳过：前后都是英文字符（英文短语内）
          if (/[a-zA-Z]/.test(before) && /[a-zA-Z]/.test(after)) continue;
          // 命中：前后至少有一个中文字符
          if (/[\u4e00-\u9fa5]/.test(before) || /[\u4e00-\u9fa5]/.test(after)) {
            englishPunctMatches.push({ punct, pos, before, after });
          }
        }
        // 单独检测句号 . （排除小数和缩写）
        const periodRegex = /\./g;
        while ((m = periodRegex.exec(text)) !== null) {
          const pos = m.index;
          const before = text[pos - 1] || '';
          const after = text[pos + 1] || '';
          // 跳过小数：数字.数字
          if (/\d/.test(before) && /\d/.test(after)) continue;
          // 跳过英文缩写：U.S.A.、e.g.
          if (/[a-zA-Z]/.test(before) && /[a-zA-Z]/.test(after)) continue;
          // 命中：前后是中文
          if (/[\u4e00-\u9fa5]/.test(before) || /[\u4e00-\u9fa5]/.test(after)) {
            englishPunctMatches.push({ punct: '.', pos, before, after });
          }
        }

        if (englishPunctMatches.length > 0) {
          // 构建修复：将所有命中位置的英文标点替换为中文标点
          let fixed = '';
          let lastIdx = 0;
          englishPunctMatches.forEach(({ pos, punct }) => {
            fixed += text.substring(lastIdx, pos) + (punctMap[punct] || punct);
            lastIdx = pos + 1;
          });
          fixed += text.substring(lastIdx);

          const punctList = [...new Set(englishPunctMatches.map(m => m.punct))].join('、');
          issues.push({
            type: '标点混用',
            level: 'warning',
            index: index,
            field: field,
            text: text,
            message: `中文文本中混用了英文标点: ${punctList}（共${englishPunctMatches.length}处）`,
            suggestion: '改为中文标点（，。；：！？）',
            fixType: 'replace',
            findText: text,
            replaceText: fixed
          });
        }
      }

      // ===== 2. 英文文本中使用了中文标点 =====
      if (!hasChinese && /[，。；：！？、]/.test(text)) {
        const reverseMap = {
          '，': ',', '。': '.', '；': ';', '：': ':', '！': '!', '？': '?', '、': ','
        };
        let fixed = text;
        let hasFix = false;
        for (const [zh, en] of Object.entries(reverseMap)) {
          if (fixed.includes(zh)) {
            const before = fixed;
            fixed = fixed.split(zh).join(en);
            if (before !== fixed) hasFix = true;
          }
        }
        issues.push({
          type: '标点混用',
          level: 'warning',
          index: index,
          field: field,
          text: text,
          message: '英文文本中使用了中文标点',
          suggestion: '改为英文标点',
          fixType: hasFix ? 'replace' : null,
          findText: text,
          replaceText: hasFix ? fixed : null
        });
      }

      // ===== 3. 标点后缺少空格（英文）=====
      if (!hasChinese) {
        const missSpace = text.match(/[.,;:!?][a-zA-Z]/g);
        if (missSpace) {
          let fixed = text.replace(/([.,;:!?])([a-zA-Z])/g, '$1 $2');
          issues.push({
            type: '格式问题',
            level: 'info',
            index: index,
            field: field,
            text: text,
            message: '标点后缺少空格',
            suggestion: '英文标点后加空格',
            fixType: 'replace',
            findText: text,
            replaceText: fixed
          });
        }
      }

      // ===== 4. 引号不配对 =====
      const quotes = text.match(/["""''']/g);
      if (quotes && quotes.length % 2 !== 0) {
        issues.push({
          type: '标点错误',
          level: 'error',
          index: index,
          field: field,
          text: text,
          message: '引号未配对',
          suggestion: '检查引号是否成对',
          fixType: null
        });
      }

      // ===== 5. 括号不配对 =====
      const openParen = (text.match(/[(（]/g) || []).length;
      const closeParen = (text.match(/[)）]/g) || []).length;
      if (openParen !== closeParen) {
        issues.push({
          type: '标点错误',
          level: 'error',
          index: index,
          field: field,
          text: text,
          message: `括号未配对（${openParen}个左括号, ${closeParen}个右括号）`,
          suggestion: '检查括号是否成对',
          fixType: null
        });
      }

      // ===== 6. 连续标点（可修复：去重）=====
      if (/，{2,}|。{2,}|！{2,}|？{2,}|；{2,}|：{2,}|,{2,}|!{2,}|\?{2,}|;{2,}|:{2,}|\.{3,}/.test(text)) {
        const fixed = text
          .replace(/，{2,}/g, '，').replace(/。{2,}/g, '。')
          .replace(/！{2,}/g, '！').replace(/？{2,}/g, '？')
          .replace(/；{2,}/g, '；').replace(/：{2,}/g, '：')
          .replace(/,{2,}/g, ',').replace(/!{2,}/g, '!')
          .replace(/\?{2,}/g, '?').replace(/;{2,}/g, ';')
          .replace(/:{2,}/g, ':');
        issues.push({
          type: '格式问题',
          level: 'warning',
          index: index,
          field: field,
          text: text,
          message: '存在连续重复标点',
          suggestion: '清理多余标点',
          fixType: 'replace',
          findText: text,
          replaceText: fixed
        });
      }

      // ===== 7. 句末缺少标点（仅译文）=====
      if (field === '译文' && text.trim().length > 0) {
        const lastChar = text.trim().slice(-1);
        const hasEndPunct = /[。！？.!?,;:？!?，；：]/.test(lastChar) ||
                           /[""')）】」』$%#]/.test(lastChar) ||
                           /[a-zA-Z0-9\u4e00-\u9fa5]$/.test(lastChar) === false;
        if (!hasEndPunct && /[\u4e00-\u9fa5a-zA-Z0-9]$/.test(text.trim())) {
          // 句末是中英文字符，但没标点
          const suggestPunct = hasChinese ? '。' : '.';
          issues.push({
            type: '缺失标点',
            level: 'info',
            index: index,
            field: field,
            text: text,
            message: '句末可能缺少结束标点',
            suggestion: `建议添加 "${suggestPunct}"`,
            fixType: 'replace',
            findText: text,
            replaceText: text.trim() + suggestPunct
          });
        }
      }

      // ===== 8. 双空格 / 中英文之间多余空格 =====
      if (/  +/.test(text)) {
        const fixed = text.replace(/  +/g, ' ');
        issues.push({
          type: '格式问题',
          level: 'info',
          index: index,
          field: field,
          text: text,
          message: '存在连续空格',
          suggestion: '合并为单个空格',
          fixType: 'replace',
          findText: text,
          replaceText: fixed
        });
      }

      // ===== 9. 中英文之间缺少空格（英文片段和中文相邻）=====
      // 仅当英文片段长度 >= 2 时才建议加空格（避免对单字母误判）
      if (hasChinese) {
        const missSpaceZhEn = text.match(/[\u4e00-\u9fa5][a-zA-Z]{2,}/g) || text.match(/[a-zA-Z]{2,}[\u4e00-\u9fa5]/g);
        if (missSpaceZhEn && missSpaceZhEn.length > 0) {
          let fixed = text
            .replace(/([\u4e00-\u9fa5])([a-zA-Z]{2,})/g, '$1 $2')
            .replace(/([a-zA-Z]{2,})([\u4e00-\u9fa5])/g, '$1 $2');
          if (fixed !== text) {
            issues.push({
              type: '格式问题',
              level: 'info',
              index: index,
              field: field,
              text: text,
              message: '中英文之间缺少空格',
              suggestion: '中英文之间加空格提升可读性',
              fixType: 'replace',
              findText: text,
              replaceText: fixed
            });
          }
        }
      }

      // ===== 10. 中文文本中使用了英文引号 =====
      if (hasChinese && /[""]/.test(text)) {
        const fixed = text.replace(/"/g, '"').replace(/"/g, '"');
        if (fixed !== text) {
          issues.push({
            type: '标点混用',
            level: 'info',
            index: index,
            field: field,
            text: text,
            message: '中文文本中使用了英文引号',
            suggestion: '建议使用中文引号 "" 或 ""',
            fixType: 'replace',
            findText: text,
            replaceText: fixed
          });
        }
      }
    });

    return issues;
  },

  /**
   * 数字单位检查和转换
   */
  checkNumbers(subtitle, index) {
    const issues = [];

    [subtitle.originalText, subtitle.translatedText].forEach((text, textIdx) => {
      if (!text) return;
      const field = textIdx === 0 ? '原文' : '译文';

      // 检查英尺→米
      const feetMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:feet|ft|英尺)/gi);
      if (feetMatch) {
        feetMatch.forEach(match => {
          const num = parseFloat(match.match(/\d+(?:\.\d+)?/)[0]);
          const meters = (num * 0.3048).toFixed(2);
          const replacement = `${meters}米`;
          issues.push({
            type: '单位转换',
            level: 'info',
            index: index,
            field: field,
            text: text,
            message: `英制单位: "${match}"`,
            suggestion: replacement,
            fixType: 'replace',
            findText: match,
            replaceText: replacement
          });
        });
      }

      // 英里→公里
      const mileMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:miles?|mi|英里)/gi);
      if (mileMatch) {
        mileMatch.forEach(match => {
          const num = parseFloat(match.match(/\d+(?:\.\d+)?/)[0]);
          const km = (num * 1.60934).toFixed(2);
          const replacement = `${km}公里`;
          issues.push({
            type: '单位转换',
            level: 'info',
            index: index,
            field: field,
            text: text,
            message: `英制单位: "${match}"`,
            suggestion: replacement,
            fixType: 'replace',
            findText: match,
            replaceText: replacement
          });
        });
      }

      // 美元→人民币
      const dollarMatch = text.match(/\$(\d+(?:,\d{3})*(?:\.\d+)?)/g);
      if (dollarMatch) {
        dollarMatch.forEach(match => {
          const num = parseFloat(match.replace(/[$,]/g, ''));
          const rmb = (num * 7.25).toFixed(2);
          const replacement = `${rmb}元`;
          issues.push({
            type: '货币转换',
            level: 'info',
            index: index,
            field: field,
            text: text,
            message: `美元: "${match}"`,
            suggestion: `约${rmb}人民币 (汇率7.25)`,
            fixType: 'replace',
            findText: match,
            replaceText: replacement
          });
        });
      }

      // 欧元→人民币
      const euroMatch = text.match(/€(\d+(?:,\d{3})*(?:\.\d+)?)/g);
      if (euroMatch) {
        euroMatch.forEach(match => {
          const num = parseFloat(match.replace(/[€,]/g, ''));
          const rmb = (num * 7.85).toFixed(2);
          const replacement = `${rmb}元`;
          issues.push({
            type: '货币转换',
            level: 'info',
            index: index,
            field: field,
            text: text,
            message: `欧元: "${match}"`,
            suggestion: `约${rmb}人民币 (汇率7.85)`,
            fixType: 'replace',
            findText: match,
            replaceText: replacement
          });
        });
      }

      // 华氏度→摄氏度
      const fahrMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:°?F|华氏度)/gi);
      if (fahrMatch) {
        fahrMatch.forEach(match => {
          const num = parseFloat(match.match(/\d+(?:\.\d+)?/)[0]);
          const celsius = ((num - 32) * 5 / 9).toFixed(1);
          const replacement = `${celsius}°C`;
          issues.push({
            type: '单位转换',
            level: 'info',
            index: index,
            field: field,
            text: text,
            message: `华氏温度: "${match}"`,
            suggestion: replacement,
            fixType: 'replace',
            findText: match,
            replaceText: replacement
          });
        });
      }

      // 磅→公斤
      const poundMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:pounds?|lbs?|磅)/gi);
      if (poundMatch) {
        poundMatch.forEach(match => {
          const num = parseFloat(match.match(/\d+(?:\.\d+)?/)[0]);
          const kg = (num * 0.453592).toFixed(2);
          const replacement = `${kg}公斤`;
          issues.push({
            type: '单位转换',
            level: 'info',
            index: index,
            field: field,
            text: text,
            message: `英制单位: "${match}"`,
            suggestion: replacement,
            fixType: 'replace',
            findText: match,
            replaceText: replacement
          });
        });
      }

      // 数字格式不一致（中文中用了英文千分位）
      if (/[\u4e00-\u9fa5]/.test(text)) {
        const numFormat = text.match(/\d{1,3}(,\d{3})+/g);
        if (numFormat) {
          numFormat.forEach(match => {
            issues.push({
              type: '数字格式',
              level: 'warning',
              index: index,
              field: field,
              text: text,
              message: `中文中使用英文千分位: "${match}"`,
              suggestion: match.replace(/,/g, '')
            });
          });
        }
      }
    });

    return issues;
  },

  /**
   * 一致性检查
   */
  checkConsistency(subtitle, index, allSubtitles) {
    const issues = [];

    if (!subtitle.translatedText) return issues;

    // 检查同一原文是否有不同译文
    const sameOriginal = allSubtitles.filter(s =>
      s.originalText === subtitle.originalText &&
      s.translatedText &&
      s.translatedText !== subtitle.translatedText
    );

    if (sameOriginal.length > 0) {
      issues.push({
        type: '一致性',
        level: 'warning',
        index: index,
        field: '译文',
        text: subtitle.translatedText,
        message: `同一原文有不同译文: "${sameOriginal[0].translatedText}"`,
        suggestion: '建议统一译法'
      });
    }

    // 检查术语一致性
    if (window.VibeCorpus) {
      const terms = VibeCorpus.findTermsInText(subtitle.originalText, 'all', true);
      terms.forEach(termInfo => {
        if (!subtitle.translatedText.includes(termInfo.targetText)) {
          issues.push({
            type: '术语一致',
            level: 'warning',
            index: index,
            field: '译文',
            text: subtitle.translatedText,
            message: `强制术语"${termInfo.term}"未使用标准译法`,
            suggestion: termInfo.targetText
          });
        }
      });
    }

    return issues;
  },

  /**
   * 时间轴检查
   */
  checkTiming(subtitle, index, allSubtitles) {
    const issues = [];
    const duration = subtitle.endTime - subtitle.startTime;

    // 时长过短（可修复：延长至1秒）
    if (duration < 0.5 && duration >= 0) {
      const newEnd = subtitle.startTime + 1;
      issues.push({
        type: '时间轴',
        level: 'warning',
        index: index,
        field: '时间',
        text: `${this.formatTime(subtitle.startTime)} - ${this.formatTime(subtitle.endTime)}`,
        message: `显示时长过短: ${duration.toFixed(2)}秒`,
        suggestion: '建议至少1秒',
        fixType: 'timing',
        timingFix: { field: 'endTime', value: newEnd }
      });
    }

    // 时长过长
    if (duration > 10) {
      issues.push({
        type: '时间轴',
        level: 'info',
        index: index,
        field: '时间',
        text: `${this.formatTime(subtitle.startTime)} - ${this.formatTime(subtitle.endTime)}`,
        message: `显示时长较长: ${duration.toFixed(2)}秒`,
        suggestion: '检查是否需要拆分',
        fixType: null
      });
    }

    // 开始时间大于结束时间（可修复：交换）
    if (subtitle.startTime > subtitle.endTime) {
      issues.push({
        type: '时间轴',
        level: 'error',
        index: index,
        field: '时间',
        text: '',
        message: '开始时间大于结束时间',
        suggestion: '修正时间轴',
        fixType: 'timing-swap',
        timingFix: { startTime: subtitle.endTime, endTime: subtitle.startTime }
      });
    }

    // 字幕阅读速度（CPS）
    const charCount = (subtitle.originalText || '').replace(/\s/g, '').length;
    if (duration > 0 && charCount / duration > 8) {
      // 可修复：按 8 字/秒 反推所需时长
      const requiredDuration = charCount / 8;
      const newEnd = subtitle.startTime + requiredDuration;
      issues.push({
        type: '阅读速度',
        level: 'warning',
        index: index,
        field: '原文',
        text: subtitle.originalText,
        message: `阅读速度过快: ${(charCount / duration).toFixed(1)}字/秒`,
        suggestion: `建议不超过8字/秒 (延长至${requiredDuration.toFixed(1)}秒)`,
        fixType: 'timing',
        timingFix: { field: 'endTime', value: newEnd }
      });
    }

    // 与下一条字幕时间重叠（可修复：将结束时间设为下一条开始时间）
    if (index < allSubtitles.length - 1) {
      const next = allSubtitles[index + 1];
      if (subtitle.endTime > next.startTime && subtitle.track === (next.track || 'main')) {
        const overlap = subtitle.endTime - next.startTime;
        issues.push({
          type: '时间轴',
          level: 'warning',
          index: index,
          field: '时间',
          text: '',
          message: `与第${index + 2}条字幕时间重叠 ${overlap.toFixed(2)}秒`,
          suggestion: '调整结束时间',
          fixType: 'timing',
          timingFix: { field: 'endTime', value: next.startTime }
        });
      }
    }

    return issues;
  },

  /**
   * 渲染质检结果
   */
  renderQAResults(results, type) {
    const container = document.getElementById('qaResults');
    if (!container) return;

    // 存储当前结果供修复按钮使用
    this._lastQAResults = results;
    this._lastQAType = type;

    if (results.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 0; color: var(--success-color);">
          <div style="font-size: 48px; margin-bottom: 12px;">✓</div>
          <p style="font-size: 16px; font-weight: 600;">未发现问题</p>
          <p style="font-size: 13px; color: var(--text-tertiary);">所有字幕通过了${type === 'all' ? '全部' : type}检查</p>
        </div>
      `;
      return;
    }

    // 按严重程度分组
    const errors = results.filter(r => r.level === 'error');
    const warnings = results.filter(r => r.level === 'warning');
    const infos = results.filter(r => r.level === 'info');
    // 可修复项
    const fixable = results.filter(r => r.fixType === 'replace' || r.fixType === 'timing' || r.fixType === 'timing-swap');

    container.innerHTML = `
      <div class="qa-summary">
        <span class="qa-stat error">错误 ${errors.length}</span>
        <span class="qa-stat warning">警告 ${warnings.length}</span>
        <span class="qa-stat info">提示 ${infos.length}</span>
        <span class="qa-stat total">共 ${results.length} 项</span>
        ${fixable.length > 0 ? `<button class="btn btn-primary btn-sm qa-fix-all-btn" onclick="VibeSubtitles.applyAllQAFixes()">✅ 一键修复全部 (${fixable.length})</button>` : ''}
      </div>
      <div class="qa-list">
        ${results.map((r, i) => {
          const canFix = r.fixType === 'replace' || r.fixType === 'timing' || r.fixType === 'timing-swap';
          return `
            <div class="qa-item ${r.level}" onclick="VibeSubtitles.jumpToSubtitle(${r.index})">
              <span class="qa-item-type">${r.type}</span>
              <span class="qa-item-index">#${r.index + 1}</span>
              <span class="qa-item-field">${r.field}</span>
              <span class="qa-item-message">${this.escapeHtml(r.message)}</span>
              ${r.suggestion ? `<span class="qa-item-suggestion">建议: ${this.escapeHtml(r.suggestion)}</span>` : ''}
              ${canFix ? `<button class="btn btn-primary btn-sm qa-fix-btn" onclick="event.stopPropagation(); VibeSubtitles.applyQAFix(${i})" title="应用修复">🔧 修复</button>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  /**
   * 应用单个质检修复
   */
  applyQAFix(resultIndex) {
    const results = this._lastQAResults || [];
    const issue = results[resultIndex];
    if (!issue || !issue.fixType) {
      VibeApp.showToast('该问题无法自动修复', 'info');
      return;
    }

    const subtitle = this.subtitles[issue.index];
    if (!subtitle) {
      VibeApp.showToast('找不到对应字幕', 'error');
      return;
    }

    try {
      if (issue.fixType === 'replace') {
        // 文本替换
        const fieldKey = issue.field === '原文' ? 'originalText' : 'translatedText';
        const oldText = subtitle[fieldKey] || '';
        const findText = issue.findText;
        const replaceText = issue.replaceText;
        if (!findText || replaceText === null || replaceText === undefined) {
          VibeApp.showToast('修复信息缺失', 'error');
          return;
        }
        const newText = oldText.split(findText).join(replaceText);
        if (newText === oldText) {
          VibeApp.showToast('未发现需要替换的内容', 'info');
          return;
        }
        subtitle[fieldKey] = newText;
      } else if (issue.fixType === 'timing' && issue.timingFix) {
        // 时间修复
        const fix = issue.timingFix;
        if (fix.field === 'endTime') {
          subtitle.endTime = fix.value;
        } else if (fix.field === 'startTime') {
          subtitle.startTime = fix.value;
        }
      } else if (issue.fixType === 'timing-swap' && issue.timingFix) {
        // 时间交换
        subtitle.startTime = issue.timingFix.startTime;
        subtitle.endTime = issue.timingFix.endTime;
      } else {
        VibeApp.showToast('不支持的修复类型', 'info');
        return;
      }

      this.renderTimeline();
      this.updateUI();
      this.saveSubtitles();
      VibeApp.showToast(`#${issue.index + 1} 已修复: ${issue.type}`, 'success');

      // 重新运行检查
      const lastType = this._lastQAType || 'all';
      setTimeout(() => this.runQACheck(lastType), 200);
    } catch (err) {
      console.error('QA fix error:', err);
      VibeApp.showToast('修复失败: ' + err.message, 'error');
    }
  },

  /**
   * 一键修复所有可修复的问题
   */
  applyAllQAFixes() {
    const results = this._lastQAResults || [];
    const fixable = results.filter(r =>
      r.fixType === 'replace' || r.fixType === 'timing' || r.fixType === 'timing-swap'
    );
    if (fixable.length === 0) {
      VibeApp.showToast('没有可自动修复的问题', 'info');
      return;
    }

    let fixedCount = 0;
    let skipped = 0;
    // 按 index 分组，避免同一字幕被多次修改时出现冲突
    const byIndex = {};
    fixable.forEach(issue => {
      if (!byIndex[issue.index]) byIndex[issue.index] = [];
      byIndex[issue.index].push(issue);
    });

    Object.keys(byIndex).forEach(idxStr => {
      const idx = parseInt(idxStr);
      const subtitle = this.subtitles[idx];
      if (!subtitle) { skipped += byIndex[idx].length; return; }

      byIndex[idx].forEach(issue => {
        try {
          if (issue.fixType === 'replace') {
            const fieldKey = issue.field === '原文' ? 'originalText' : 'translatedText';
            const oldText = subtitle[fieldKey] || '';
            if (issue.findText && issue.replaceText !== null && issue.replaceText !== undefined) {
              const newText = oldText.split(issue.findText).join(issue.replaceText);
              if (newText !== oldText) {
                subtitle[fieldKey] = newText;
                fixedCount++;
              } else {
                skipped++;
              }
            } else {
              skipped++;
            }
          } else if (issue.fixType === 'timing' && issue.timingFix) {
            const fix = issue.timingFix;
            if (fix.field === 'endTime') subtitle.endTime = fix.value;
            else if (fix.field === 'startTime') subtitle.startTime = fix.value;
            fixedCount++;
          } else if (issue.fixType === 'timing-swap' && issue.timingFix) {
            subtitle.startTime = issue.timingFix.startTime;
            subtitle.endTime = issue.timingFix.endTime;
            fixedCount++;
          } else {
            skipped++;
          }
        } catch (e) {
          skipped++;
        }
      });
    });

    this.sortSubtitles();
    this.renderTimeline();
    this.updateUI();
    this.saveSubtitles();
    VibeApp.showToast(`已修复 ${fixedCount} 项（跳过 ${skipped} 项）`, 'success');

    // 重新运行检查
    const lastType = this._lastQAType || 'all';
    setTimeout(() => this.runQACheck(lastType), 200);
  },

  // ========== 统计报表 ==========

  /**
   * 显示统计报表弹窗
   */
  showStatsDialog() {
    if (this.subtitles.length === 0) {
      VibeApp.showToast('没有字幕可统计', 'info');
      return;
    }

    const existing = document.getElementById('statsDialogModal');
    if (existing) existing.remove();

    const stats = this.calculateStats();
    const progressColor = parseFloat(stats.completionRate) >= 80 ? 'var(--success-color)' :
                          parseFloat(stats.completionRate) >= 50 ? 'var(--warning-color)' :
                          'var(--danger-color)';

    const modal = document.createElement('div');
    modal.id = 'statsDialogModal';
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content stats-modal-content">
        <button class="modal-close-btn" onclick="document.getElementById('statsDialogModal').remove()">✕</button>
        <h3 style="margin-bottom: 16px;">📊 字幕统计报表</h3>

        <!-- 总进度条 -->
        <div class="stats-overall-progress">
          <div class="stats-progress-header">
            <span class="stats-progress-title">🎯 总进度</span>
            <span class="stats-progress-value" style="color: ${progressColor};">${stats.completionRate}%</span>
          </div>
          <div class="stats-progress-bar">
            <div class="stats-progress-fill" style="width: ${stats.completionRate}%; background-color: ${progressColor};"></div>
          </div>
          <div class="stats-progress-detail">
            已翻译 <strong>${stats.translatedCount}</strong> / ${stats.totalCount} 条
            · 待翻译 <strong>${stats.untranslatedCount}</strong> 条
          </div>
        </div>

        <!-- 基础信息卡片 -->
        <h4 class="stats-section-title">📋 基础信息</h4>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon">📝</div>
            <div class="stat-value">${stats.totalCount}</div>
            <div class="stat-label">字幕总条数</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">⏱️</div>
            <div class="stat-value">${stats.totalDuration}</div>
            <div class="stat-label">字幕总时长</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">🎬</div>
            <div class="stat-value">${stats.videoDuration}</div>
            <div class="stat-label">视频时长</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">📊</div>
            <div class="stat-value">${stats.coverageRate}%</div>
            <div class="stat-label">字幕覆盖率</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">✓</div>
            <div class="stat-value">${stats.translatedCount}</div>
            <div class="stat-label">已翻译条数</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">⏳</div>
            <div class="stat-value">${stats.untranslatedCount}</div>
            <div class="stat-label">未翻译条数</div>
          </div>
        </div>

        <!-- 字数统计 -->
        <h4 class="stats-section-title">✍️ 字数统计</h4>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon">📄</div>
            <div class="stat-value">${stats.originalChars}</div>
            <div class="stat-label">原文总字数</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">🌐</div>
            <div class="stat-value">${stats.translatedChars}</div>
            <div class="stat-label">译文总字数</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">⚖️</div>
            <div class="stat-value">${stats.charRatio}</div>
            <div class="stat-label">原:译 字数比</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon">📊</div>
            <div class="stat-value">${stats.avgCps}</div>
            <div class="stat-label">平均字/秒 (${stats.avgCpsStatus})</div>
          </div>
        </div>

        <!-- 详细统计表 -->
        <div class="stats-detail">
          <h4 class="stats-section-title">🔍 详细数据</h4>
          <table class="stats-table">
            <tr><td>最短字幕时长</td><td>${stats.minDuration}秒</td></tr>
            <tr><td>最长字幕时长</td><td>${stats.maxDuration}秒</td></tr>
            <tr><td>平均字幕时长</td><td>${stats.avgDuration}秒</td></tr>
            <tr><td>原文单条字数</td><td>最短 ${stats.minOriginalChars} / 最长 ${stats.maxOriginalChars} / 平均 ${stats.avgOriginalChars}</td></tr>
            <tr><td>译文单条字数</td><td>最短 ${stats.minTranslatedChars} / 最长 ${stats.maxTranslatedChars} / 平均 ${stats.avgTranslatedChars}</td></tr>
            <tr><td>CPS 区间</td><td>最小 ${stats.minCps} / 最大 ${stats.maxCps}</td></tr>
          </table>
        </div>

        <!-- 质量分析 -->
        <div class="stats-detail">
          <h4 class="stats-section-title">⚠️ 质量分析</h4>
          <table class="stats-table">
            <tr><td>字幕重叠数</td><td>${stats.overlapCount} 条</td></tr>
            <tr><td>时长过短 (&lt;1秒)</td><td>${stats.tooShortCount} 条</td></tr>
            <tr><td>时长过长 (&gt;10秒)</td><td>${stats.tooLongCount} 条</td></tr>
            <tr><td>CPS 偏高 (&gt;15)</td><td>${stats.highCpsCount} 条</td></tr>
            <tr><td>含单字样式</td><td>${stats.charStyledCount} 条</td></tr>
          </table>
        </div>

        <!-- 轨道分布 -->
        <div class="stats-tracks">
          <h4 class="stats-section-title">📁 轨道分布</h4>
          ${stats.trackStats.map(t => `
            <div class="track-stat-row">
              <span class="track-stat-name">${t.icon} ${t.name}</span>
              <span class="track-stat-count">${t.count} 条</span>
              <span class="track-stat-translated">已译 ${t.translated}</span>
              <span class="track-stat-chars">${t.chars} 字</span>
            </div>
          `).join('')}
        </div>

        <div class="modal-footer" style="margin-top: 20px;">
          <button class="btn btn-secondary" onclick="VibeSubtitles.exportStatsReport()">📄 导出报表</button>
          <button class="btn btn-primary" onclick="document.getElementById('statsDialogModal').remove()">关闭</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  /**
   * 计算统计数据
   */
  calculateStats() {
    const subs = this.subtitles;
    const totalCount = subs.length;

    let totalDurationSec = 0;
    let originalChars = 0;
    let translatedChars = 0;
    let translatedCount = 0;
    let untranslatedCount = 0;
    let durations = [];
    let originalCharCounts = [];
    let translatedCharCounts = [];
    let cpsValues = [];
    let overlapCount = 0;
    let tooShortCount = 0;       // 时长 < 1 秒
    let tooLongCount = 0;        // 时长 > 10 秒
    let highCpsCount = 0;       // CPS > 15（阅读过快）
    let qaIssueCount = 0;       // 质检问题数（占位）
    let charStyledCount = 0;    // 含单字样式的条数

    // 轨道统计
    const trackStats = this.trackDefinitions.map(t => ({
      ...t,
      count: 0,
      chars: 0,
      translated: 0
    }));

    // 视频总时长（用于覆盖率统计）
    let videoDuration = 0;
    const video = document.getElementById('subtitleVideo');
    if (video && video.duration && isFinite(video.duration)) {
      videoDuration = video.duration;
    }

    subs.forEach((subtitle, idx) => {
      const duration = subtitle.endTime - subtitle.startTime;
      totalDurationSec += duration;
      durations.push(duration);

      const origChars = (subtitle.originalText || '').replace(/\s/g, '').length;
      const transChars = (subtitle.translatedText || '').replace(/\s/g, '').length;
      originalChars += origChars;
      translatedChars += transChars;
      originalCharCounts.push(origChars);
      translatedCharCounts.push(transChars);

      if (subtitle.translatedText && subtitle.translatedText.trim()) {
        translatedCount++;
        if (duration > 0) {
          const cps = transChars / duration;
          cpsValues.push(cps);
          if (cps > 15) highCpsCount++;
        }
      } else {
        untranslatedCount++;
      }

      // 时长异常
      if (duration < 1) tooShortCount++;
      if (duration > 10) tooLongCount++;

      // 检测与下一条重叠
      if (idx < subs.length - 1) {
        const next = subs[idx + 1];
        if (subtitle.endTime > next.startTime + 0.01) overlapCount++;
      }

      // 字符样式
      if (subtitle.charStyles && (
        Object.keys(subtitle.charStyles.original || {}).length > 0 ||
        Object.keys(subtitle.charStyles.translated || {}).length > 0
      )) {
        charStyledCount++;
      }

      // 轨道统计
      const trackId = subtitle.track || 'main';
      const trackStat = trackStats.find(t => t.id === trackId);
      if (trackStat) {
        trackStat.count++;
        trackStat.chars += origChars + transChars;
        if (subtitle.translatedText && subtitle.translatedText.trim()) trackStat.translated++;
      }
    });

    const formatDuration = (sec) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      if (h > 0) return `${h}时${m}分${s}秒`;
      if (m > 0) return `${m}分${s}秒`;
      return `${s}秒`;
    };

    const avgCps = cpsValues.length > 0 ? (cpsValues.reduce((a, b) => a + b, 0) / cpsValues.length).toFixed(1) : '0';
    const maxCps = cpsValues.length > 0 ? Math.max(...cpsValues).toFixed(1) : '0';
    const minCps = cpsValues.length > 0 ? Math.min(...cpsValues).toFixed(1) : '0';

    // 视频覆盖率
    const coverageRate = videoDuration > 0 ? ((totalDurationSec / videoDuration) * 100).toFixed(1) : '0';
    const videoDurationFormatted = videoDuration > 0 ? formatDuration(videoDuration) : '未知';

    // 综合进度（翻译 + 质检）
    const translationProgress = totalCount > 0 ? (translatedCount / totalCount) * 100 : 0;
    const overallProgress = translationProgress.toFixed(1);

    return {
      totalCount,
      totalDuration: formatDuration(totalDurationSec),
      totalDurationSec,
      originalChars,
      translatedChars,
      avgCps,
      maxCps,
      minCps,
      translatedCount,
      untranslatedCount,
      completionRate: totalCount > 0 ? ((translatedCount / totalCount) * 100).toFixed(1) : '0',
      minDuration: durations.length > 0 ? Math.min(...durations).toFixed(2) : '0',
      maxDuration: durations.length > 0 ? Math.max(...durations).toFixed(2) : '0',
      avgDuration: durations.length > 0 ? (totalDurationSec / durations.length).toFixed(2) : '0',
      minOriginalChars: originalCharCounts.length > 0 ? Math.min(...originalCharCounts) : 0,
      maxOriginalChars: originalCharCounts.length > 0 ? Math.max(...originalCharCounts) : 0,
      minTranslatedChars: translatedCharCounts.length > 0 ? Math.min(...translatedCharCounts) : 0,
      maxTranslatedChars: translatedCharCounts.length > 0 ? Math.max(...translatedCharCounts) : 0,
      avgOriginalChars: originalCharCounts.length > 0 ? Math.round(originalChars / originalCharCounts.length) : 0,
      avgTranslatedChars: translatedCharCounts.length > 0 ? Math.round(translatedChars / translatedCharCounts.length) : 0,
      charRatio: translatedChars > 0 ? (originalChars / translatedChars).toFixed(2) + ':1' : '-',
      trackStats,
      // 新增详细指标
      videoDuration: videoDurationFormatted,
      coverageRate,
      overlapCount,
      tooShortCount,
      tooLongCount,
      highCpsCount,
      charStyledCount,
      overallProgress,
      avgCpsStatus: parseFloat(avgCps) > 12 ? '偏高' : (parseFloat(avgCps) > 8 ? '正常' : '偏慢')
    };
  },

  /**
   * 导出统计报表
   */
  exportStatsReport() {
    const stats = this.calculateStats();
    let report = `VibeTrans 字幕统计报表\n`;
    report += `生成时间: ${new Date().toLocaleString()}\n`;
    report += `${'='.repeat(50)}\n\n`;
    report += `【基本信息】\n`;
    report += `字幕总条数: ${stats.totalCount}\n`;
    report += `总时长: ${stats.totalDuration}\n`;
    report += `已翻译: ${stats.translatedCount}条 (${stats.completionRate}%)\n`;
    report += `未翻译: ${stats.untranslatedCount}条\n\n`;
    report += `【字数统计】\n`;
    report += `原文总字数: ${stats.originalChars}\n`;
    report += `译文总字数: ${stats.translatedChars}\n`;
    report += `字数比(原:译): ${stats.charRatio}\n`;
    report += `平均阅读速度: ${stats.avgCps}字/秒\n\n`;
    report += `【时长分析】\n`;
    report += `最短字幕: ${stats.minDuration}秒\n`;
    report += `最长字幕: ${stats.maxDuration}秒\n`;
    report += `平均时长: ${stats.avgDuration}秒\n\n`;
    report += `【轨道分布】\n`;
    stats.trackStats.forEach(t => {
      report += `${t.icon} ${t.name}: ${t.count}条, ${t.chars}字\n`;
    });

    this.downloadFile(report, `stats_report_${Date.now()}.txt`, 'text/plain;charset=utf-8');
    VibeApp.showToast('统计报表已导出', 'success');
  },

  // ========== 操作引导（新手引导） ==========

  guideSteps: [
    {
      title: '欢迎来到 VibeTrans',
      content: '这是一个集字幕制作、翻译、校对于一体的工具。让我带你快速了解核心功能！',
      icon: '👋',
      target: null
    },
    {
      title: '导入视频',
      content: '点击左侧「导入视频」按钮，加载你要制作字幕的视频文件。支持 MP4、WebM、MOV 等格式。',
      icon: '🎥',
      target: '#videoPlaceholder'
    },
    {
      title: '波形打轴',
      content: '播放视频，使用「🚩 标记开始」和「🏁 标记结束」标记每句字幕的时间点，然后点击「➕ 添加字幕」创建字幕条目。',
      icon: '🌊',
      target: '#markStart'
    },
    {
      title: '翻译字幕',
      content: '在字幕列表中输入原文后，点击「翻译」按钮使用机器翻译，或从翻译记忆库中匹配历史译文。',
      icon: '🌐',
      target: '#batchTranslate'
    },
    {
      title: '记忆库与语料库',
      content: '切换到「翻译记忆库」或「语料库」模块，管理历史译文和术语。导入 TMX 文件可与其他 CAT 工具互通。',
      icon: '📚',
      target: 'nav-item[data-module="memory"]'
    },
    {
      title: '质检校对',
      content: '使用「🔍 质检校对」检查错别字、标点、术语一致性。导出时选择适合的平台格式。',
      icon: '✨',
      target: '#qaCheckBtn'
    }
  ],

  guideCurrentStep: 0,

  /**
   * 启动新手引导
   */
  startGuide() {
    this.guideCurrentStep = 0;
    this.showGuideStep();
  },

  /**
   * 显示当前引导步骤
   */
  showGuideStep() {
    const existing = document.getElementById('guideOverlay');
    if (existing) existing.remove();

    const step = this.guideSteps[this.guideCurrentStep];
    if (!step) return;

    const overlay = document.createElement('div');
    overlay.id = 'guideOverlay';
    overlay.className = 'guide-overlay';

    // 高亮目标元素
    let targetEl = null;
    if (step.target) {
      targetEl = document.querySelector(step.target);
    }

    let highlightStyle = '';
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      highlightStyle = `
        top: ${rect.top - 4}px;
        left: ${rect.left - 4}px;
        width: ${rect.width + 8}px;
        height: ${rect.height + 8}px;
      `;
    }

    overlay.innerHTML = `
      ${targetEl ? `<div class="guide-highlight" style="${highlightStyle}"></div>` : ''}
      <div class="guide-tooltip ${targetEl ? '' : 'centered'}">
        <div class="guide-header">
          <span class="guide-icon">${step.icon}</span>
          <span class="guide-title">${step.title}</span>
          <span class="guide-step-count">${this.guideCurrentStep + 1}/${this.guideSteps.length}</span>
        </div>
        <div class="guide-content">${step.content}</div>
        <div class="guide-footer">
          <button class="btn btn-secondary btn-sm" onclick="VibeSubtitles.skipGuide()">跳过</button>
          <div class="guide-dots">
            ${this.guideSteps.map((_, i) => `
              <span class="guide-dot ${i === this.guideCurrentStep ? 'active' : ''}"></span>
            `).join('')}
          </div>
          <button class="btn btn-primary btn-sm" onclick="VibeSubtitles.nextGuideStep()">
            ${this.guideCurrentStep === this.guideSteps.length - 1 ? '完成' : '下一步'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 滚动到目标元素
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  },

  /**
   * 下一步引导
   */
  nextGuideStep() {
    this.guideCurrentStep++;
    if (this.guideCurrentStep >= this.guideSteps.length) {
      this.finishGuide();
    } else {
      this.showGuideStep();
    }
  },

  /**
   * 跳过引导
   */
  skipGuide() {
    this.finishGuide();
  },

  /**
   * 完成引导
   */
  finishGuide() {
    const overlay = document.getElementById('guideOverlay');
    if (overlay) overlay.remove();
    localStorage.setItem('vibetrans_guide_completed', 'true');
    // 显示功能介绍页面
    this.showFeatureOverview();
  },

  /**
   * 显示软件功能介绍页面
   */
  showFeatureOverview() {
    const existing = document.getElementById('featureOverviewModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'featureOverviewModal';
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content feature-overview-modal">
        <button class="modal-close-btn" onclick="document.getElementById('featureOverviewModal').remove()">✕</button>
        <div class="feature-overview-header">
          <h2>🎬 VibeTrans 功能总览</h2>
          <p>一站式双语字幕制作、翻译与校对工具</p>
        </div>
        <div class="feature-overview-body">
          <div class="feature-section">
            <h3>💡 核心功能</h3>
            <div class="feature-grid">
              <div class="feature-item">
                <span class="feature-icon">🎥</span>
                <div>
                  <strong>视频导入与波形打轴</strong>
                  <p>导入视频后自动生成波形图，可视化标记字幕时间点</p>
                </div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">🌐</span>
                <div>
                  <strong>智能翻译</strong>
                  <p>支持百度/有道/Google 翻译API，语料库+记忆库优先匹配</p>
                </div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">📝</span>
                <div>
                  <strong>多轨道字幕</strong>
                  <p>主对白、人名注释、剧情注释独立轨道，分层不干扰</p>
                </div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">📚</span>
                <div>
                  <strong>语料库管理</strong>
                  <p>导入导出 TMX/JSON/CSV，与其他 CAT 工具互通</p>
                </div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">🔗</span>
                <div>
                  <strong>语料清洗与对齐</strong>
                  <p>自动对齐原文译文，支持双击光标拆分、链接译文对</p>
                </div>
              </div>
              <div class="feature-item">
                <span class="feature-icon">📜</span>
                <div>
                  <strong>历史快照</strong>
                  <p>自动记录每步操作，支持回滚到任意历史版本</p>
                </div>
              </div>
            </div>
          </div>

          <div class="feature-section">
            <h3>⌨️ 快捷键</h3>
            <div class="shortcut-list">
              <div class="shortcut-item"><kbd>Space</kbd><span>播放/暂停视频</span></div>
              <div class="shortcut-item"><kbd>S</kbd><span>标记开始时间</span></div>
              <div class="shortcut-item"><kbd>E</kbd><span>标记结束时间</span></div>
              <div class="shortcut-item"><kbd>Enter</kbd><span>添加字幕</span></div>
              <div class="shortcut-item"><kbd>Ctrl</kbd>+<kbd>Enter</kbd><span>批量翻译</span></div>
              <div class="shortcut-item"><kbd>Ctrl</kbd>+<kbd>Z</kbd><span>撤销</span></div>
              <div class="shortcut-item"><kbd>Ctrl</kbd>+<kbd>S</kbd><span>保存项目</span></div>
              <div class="shortcut-item"><kbd>Esc</kbd><span>取消当前操作</span></div>
            </div>
          </div>

          <div class="feature-section">
            <h3>✨ 软件亮点</h3>
            <ul class="highlights-list">
              <li>🗂️ <strong>本地优先</strong>：所有数据存储在本地浏览器，不上传服务器，保护隐私</li>
              <li>🎨 <strong>样式自定义</strong>：全局样式模板 + 单条字幕样式微调</li>
              <li>🔍 <strong>智能质检</strong>：自动检查错别字、标点、术语一致性</li>
              <li>📤 <strong>多格式导出</strong>：SRT/ASS/VTT/JSON，适配各大视频平台</li>
              <li>🔄 <strong>翻译记忆</strong>：自动记忆翻译结果，重复内容无需重译</li>
              <li>📊 <strong>实时预览</strong>：字幕样式实时预览，所见即所得</li>
            </ul>
          </div>

          <div class="feature-section">
            <h3>🚀 快速上手</h3>
            <div class="quick-start-steps">
              <div class="qs-step"><span class="qs-num">1</span> 导入视频文件</div>
              <div class="qs-step"><span class="qs-num">2</span> 播放视频，标记时间点</div>
              <div class="qs-step"><span class="qs-num">3</span> 添加字幕原文</div>
              <div class="qs-step"><span class="qs-num">4</span> 一键批量翻译</div>
              <div class="qs-step"><span class="qs-num">5</span> 质检校对后导出</div>
            </div>
          </div>
        </div>
        <div class="feature-overview-footer">
          <button class="btn btn-primary" onclick="document.getElementById('featureOverviewModal').remove()">开始使用 →</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  /**
   * 检查是否需要显示引导（首次访问）
   */
  checkFirstVisit() {
    if (!localStorage.getItem('vibetrans_guide_completed') &&
        !localStorage.getItem('vibetrans_guide_skipped')) {
      setTimeout(() => {
        this.startGuide();
      }, 1000);
    }
  }
};

// 暴露模块
window.VibeSubtitles = VibeSubtitles;