/**
 * 应用主入口模块
 * 管理页面切换、全局事件和工具函数
 */
const VibeApp = {
  /**
   * 初始化应用
   */
  async init() {
    // 渲染所有 SVG 图标
    this.renderIcons();

    // 加载后端配置（如果可用）
    await this.loadServerConfig();

    // 初始化各模块
    VibeMemory.init();
    VibeCorpus.init();
    VibeSettings.init();
    VibeSubtitles.init();
    VibeProjects.init();
    VibeSnapshotUI.init();

    // 绑定导航切换事件
    this.bindNavigation();

    // 绑定侧边栏切换（响应式导航）
    this.bindSidebarToggle();

    // 绑定翻译模块事件
    this.bindTranslatorEvents();

    // 绑定记忆库事件
    this.bindMemoryEvents();

    // 绑定语料库事件
    this.bindCorpusEvents();

    // 更新存储使用量
    this.updateStorageUsage();

    // 设置字符计数
    this.setupCharCount();

    console.log('VibeTrans 智能翻译系统已初始化');
  },

  /**
   * 绑定导航切换事件
   */
  bindNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const moduleId = item.dataset.module;
        
        // 切换前关闭所有弹窗
        this.closeAllModals();
        
        // 更新导航状态
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');

        // 切换模块显示
        const modules = document.querySelectorAll('.module');
        modules.forEach(module => module.classList.remove('active'));
        
        const targetModule = document.getElementById(moduleId);
        if (targetModule) {
          targetModule.classList.add('active');
        }

        // 如果切换到记忆库，更新统计和列表
        if (moduleId === 'memory' && typeof VibeMemory !== 'undefined') {
          try {
            VibeMemory.renderCategories();
            VibeMemory.updateStats();
            VibeMemory.render();
          } catch(e) {}
        }

        // 如果切换到语料库，更新统计
        if (moduleId === 'corpus' && typeof VibeCorpus.updateStats === 'function') {
          try { VibeCorpus.updateStats(); } catch(e) {}
        }
      });
    });
    
    // 绑定字幕视图模式切换
    this.bindViewModeSwitch();
  },

  /**
   * 绑定侧边栏切换按钮
   * 桌面默认横向显示，点击切换为竖向侧边栏（适合宽屏或小屏）
   */
  bindSidebarToggle() {
    const toggleBtn = document.getElementById('sidebarToggle');
    const nav = document.getElementById('mainNav');
    if (!toggleBtn || !nav) return;

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.body.classList.toggle('sidebar-open');
    });

    // 点击导航项后自动收起侧边栏（移动端体验）
    nav.addEventListener('click', (e) => {
      if (e.target.closest('.nav-item') && window.innerWidth <= 768) {
        document.body.classList.remove('sidebar-open');
      }
    });

    // 点击页面其他位置收起侧边栏
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#sidebarToggle') && !e.target.closest('#mainNav')) {
        document.body.classList.remove('sidebar-open');
      }
    });
  },

  // 关闭所有弹窗
  closeAllModals() {
    const modals = document.querySelectorAll('.modal-overlay, .modal');
    modals.forEach(modal => {
      modal.classList.remove('show');
    });
    // 同时移除动态创建的弹窗
    const dynamicModals = document.querySelectorAll('.confirm-overlay, .batch-overlay, .find-overlay, .validate-overlay');
    dynamicModals.forEach(m => m.remove());
  },

  // 绑定视图模式切换
  bindViewModeSwitch() {
    const viewBtns = document.querySelectorAll('.view-mode-btn');
    viewBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        viewBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const timelineScroll = document.querySelector('.timeline-scroll');
        const dualEditView = document.getElementById('dualEditView');
        
        if (view === 'dual') {
          if (timelineScroll) timelineScroll.style.display = 'none';
          if (dualEditView) dualEditView.classList.add('active');
          if (VibeSubtitles.dualEditIndex < 0 && VibeSubtitles.subtitles.length > 0) {
            VibeSubtitles.dualEditIndex = 0;
          }
          VibeSubtitles.dualEditLoad();
        } else {
          if (timelineScroll) timelineScroll.style.display = '';
          if (dualEditView) dualEditView.classList.remove('active');
        }

        VibeSubtitles.viewMode = view;
        if (view !== 'dual') {
          VibeSubtitles.renderTimeline();
        }
      });
    });
  },

  /**
   * 绑定翻译模块事件
   */
  bindTranslatorEvents() {
    const translateBtn = document.getElementById('translateBtn');
    if (translateBtn) translateBtn.addEventListener('click', () => {
      VibeTranslator.translate();
    });

    const swapLang = document.getElementById('swapLang');
    if (swapLang) swapLang.addEventListener('click', () => {
      VibeTranslator.swapLanguages();
    });

    const copyResult = document.getElementById('copyResult');
    if (copyResult) copyResult.addEventListener('click', () => {
      VibeTranslator.copyResult();
    });

    const addToMemory = document.getElementById('addToMemory');
    if (addToMemory) addToMemory.addEventListener('click', () => {
      VibeTranslator.openSaveToMemory();
    });

    const addToCorpus = document.getElementById('addToCorpus');
    if (addToCorpus) addToCorpus.addEventListener('click', () => {
      VibeTranslator.openSaveToCorpus();
    });

    // 字符计数实时更新
    const sourceText = document.getElementById('sourceText');
    if (sourceText) sourceText.addEventListener('input', () => {
      VibeTranslator.updateCharCount();
    });

    // 译文框内容变化时更新入库按钮状态
    const targetText = document.getElementById('targetText');
    if (targetText) targetText.addEventListener('input', () => {
      VibeTranslator.toggleSaveButtons(!!targetText.value.trim());
    });

    // 入库弹窗遮罩点击关闭
    const saveMemoryModal = document.getElementById('saveMemoryModal');
    if (saveMemoryModal) saveMemoryModal.addEventListener('click', (e) => {
      if (e.target === saveMemoryModal) VibeTranslator.closeSaveModal('memory');
    });

    const saveCorpusModal = document.getElementById('saveCorpusModal');
    if (saveCorpusModal) saveCorpusModal.addEventListener('click', (e) => {
      if (e.target === saveCorpusModal) VibeTranslator.closeSaveModal('corpus');
    });
  },

  /**
   * 绑定记忆库事件
   */
  bindMemoryEvents() {
    const memorySearch = document.getElementById('memorySearch');
    if (memorySearch) memorySearch.addEventListener('input', (e) => {
      VibeMemory.setSearchQuery(e.target.value);
    });

    const memoryLangFilter = document.getElementById('memoryLangFilter');
    if (memoryLangFilter) memoryLangFilter.addEventListener('change', (e) => {
      VibeMemory.setLangFilter(e.target.value);
    });

    const exportMemory = document.getElementById('exportMemory');
    if (exportMemory) exportMemory.addEventListener('click', () => {
      const json = VibeMemory.export();
      if (json) {
        this.downloadFile(json, 'memory_export.json', 'application/json');
        this.showToast('记忆库导出成功', 'success');
      }
    });

    const importMemory = document.getElementById('importMemory');
    if (importMemory) importMemory.addEventListener('click', () => {
      const memoryFileInput = document.getElementById('memoryFileInput');
      if (memoryFileInput) memoryFileInput.click();
    });

    const memoryFileInput = document.getElementById('memoryFileInput');
    if (memoryFileInput) memoryFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const isTmx = file.name.toLowerCase().endsWith('.tmx') || file.name.toLowerCase().endsWith('.xml');
      const reader = new FileReader();
      reader.onload = (event) => {
        if (isTmx) {
          VibeMemory.importTmx(event.target.result);
        } else {
          const result = VibeMemory.import(event.target.result);
          if (result.success) {
            this.showToast(result.message, 'success');
          } else {
            this.showToast(result.message, 'error');
          }
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    const clearMemory = document.getElementById('clearMemory');
    if (clearMemory) clearMemory.addEventListener('click', () => {
      if (confirm('确定要清空所有翻译记忆吗？')) {
        VibeMemory.clear();
        this.showToast('记忆库已清空', 'success');
      }
    });
  },

  /**
   * 绑定语料库事件
   */
  bindCorpusEvents() {
    const addCorpusBtn = document.getElementById('addCorpusBtn');
    if (addCorpusBtn) addCorpusBtn.addEventListener('click', () => {
      const sourceText = document.getElementById('corpusSourceText')?.value || '';
      const targetText = document.getElementById('corpusTargetText')?.value || '';
      const sourceLang = document.getElementById('corpusSourceLang')?.value || 'en';
      const targetLang = document.getElementById('corpusTargetLang')?.value || 'zh';
      const tags = document.getElementById('corpusTags')?.value || '';

      if (!sourceText.trim() || !targetText.trim()) {
        this.showToast('请填写完整的双语文本', 'info');
        return;
      }

      VibeCorpus.add(sourceText, targetText, sourceLang, targetLang, tags);
      this.showToast('语料添加成功', 'success');

      const sourceTextEl = document.getElementById('corpusSourceText');
      const targetTextEl = document.getElementById('corpusTargetText');
      const tagsEl = document.getElementById('corpusTags');
      if (sourceTextEl) sourceTextEl.value = '';
      if (targetTextEl) targetTextEl.value = '';
      if (tagsEl) tagsEl.value = '';
    });

    const corpusSearch = document.getElementById('corpusSearch');
    if (corpusSearch) corpusSearch.addEventListener('input', (e) => {
      VibeCorpus.setSearchQuery(e.target.value);
    });

    const corpusLangFilter = document.getElementById('corpusLangFilter');
    if (corpusLangFilter) corpusLangFilter.addEventListener('change', (e) => {
      VibeCorpus.setLangFilter(e.target.value);
    });

    const uploadCorpusDoc = document.getElementById('uploadCorpusDoc');
    if (uploadCorpusDoc) uploadCorpusDoc.addEventListener('click', () => {
      const corpusDocInput = document.getElementById('corpusDocInput');
      if (corpusDocInput) corpusDocInput.click();
    });

    const corpusDocInput = document.getElementById('corpusDocInput');
    if (corpusDocInput) corpusDocInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      this.showLoading(true);
      
      try {
        const result = await VibeCorpus.parseDocument(file);
        this.showToast(result.message, result.success ? 'success' : 'error');
      } catch (error) {
        console.error('Upload error:', error);
        this.showToast('文件处理失败', 'error');
      } finally {
        this.showLoading(false);
        e.target.value = '';
      }
    });

    const exportCorpus = document.getElementById('exportCorpus');
    if (exportCorpus) exportCorpus.addEventListener('click', () => {
      const json = VibeCorpus.export();
      if (json) {
        this.downloadFile(json, 'corpus_export.json', 'application/json');
        this.showToast('语料库导出成功', 'success');
      }
    });

    const importCorpus = document.getElementById('importCorpus');
    if (importCorpus) importCorpus.addEventListener('click', () => {
      const corpusFileInput = document.getElementById('corpusFileInput');
      if (corpusFileInput) corpusFileInput.click();
    });

    const corpusFileInput = document.getElementById('corpusFileInput');
    if (corpusFileInput) corpusFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const result = VibeCorpus.import(event.target.result);
        if (result.success) {
          this.showToast(result.message, 'success');
        } else {
          this.showToast(result.message, 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    const clearCorpus = document.getElementById('clearCorpus');
    if (clearCorpus) clearCorpus.addEventListener('click', () => {
      if (confirm('确定要清空所有语料吗？')) {
        VibeCorpus.clear();
        this.showToast('语料库已清空', 'success');
      }
    });
  },

  /**
   * 关闭记忆库详情模态框
   */
  closeMemoryModal() {
    document.getElementById('memoryModal').classList.remove('show');
    VibeMemory.selectedItem = null;
  },

  /**
   * 使用记忆库条目
   */
  useMemoryItem() {
    if (!VibeMemory.selectedItem) return;

    const item = VibeMemory.selectedItem;
    document.getElementById('sourceText').value = item.sourceText;
    document.getElementById('sourceLang').value = item.sourceLang;
    document.getElementById('targetLang').value = item.targetLang;
    
    // 切换到翻译模块
    document.querySelector('[data-module="translator"]').click();
    
    this.closeMemoryModal();
    this.showToast('已加载到翻译面板', 'success');
  },

  /**
   * 删除记忆库条目
   */
  deleteMemoryItem() {
    if (!VibeMemory.selectedItem) return;

    if (confirm('确定要删除这条翻译记忆吗？')) {
      VibeMemory.remove(VibeMemory.selectedItem.id);
      this.closeMemoryModal();
      this.showToast('删除成功', 'success');
    }
  },

  /**
   * 设置字符计数
   */
  setupCharCount() {
    const sourceText = document.getElementById('sourceText');
    const sourceCount = document.getElementById('sourceCount');
    
    if (sourceText && sourceCount) {
      sourceText.addEventListener('input', () => {
        const count = sourceText.value.length;
        sourceCount.textContent = `${count} 字符`;
      });
    }
  },

  updateStorageUsage() {
    if (VibeSettings && typeof VibeSettings.updateStorageUsage === 'function') {
      try {
        VibeSettings.updateStorageUsage();
      } catch (e) {
        console.warn('updateStorageUsage failed:', e.message);
      }
    }
  },

  /**
   * 显示提示消息
   * @param {string} message - 提示消息
   * @param {string} type - 提示类型（success/error/info）
   */
  showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) {
      console.warn('Toast element not found');
      return;
    }
    const icon = toast.querySelector('.toast-icon');
    const msg = toast.querySelector('.toast-message');

    if (!msg) {
      console.warn('Toast message element not found');
      return;
    }

    msg.textContent = message;

    // 设置类型样式
    toast.className = `toast ${type}`;

    // 设置图标
    switch (type) {
      case 'success':
        icon.textContent = '✅';
        break;
      case 'error':
        icon.textContent = '❌';
        break;
      default:
        icon.textContent = 'ℹ️';
    }

    toast.classList.add('show');

    // 3秒后自动消失
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  },

  /**
   * 显示加载遮罩
   * @param {boolean} show - 是否显示
   */
  showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (!overlay) return;
    if (show) {
      overlay.classList.add('show');
    } else {
      overlay.classList.remove('show');
    }
  },

  /**
   * 从后端 /api/config 加载配置（如 .env 中可公开的部分）
   * 失败时静默降级（使用默认值），不影响前端运行
   */
  async loadServerConfig() {
    // 全局配置对象
    window.VibeConfig = {
      apiBaseUrl: '',
      whisperModel: 'Xenova/whisper-tiny',
      whisperCdn: 'https://cdn.jsdelivr.net/npm',
      voskCdn: 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist',
      defaultTranslator: 'mymemory',
      defaultSourceLang: 'en',
      defaultTargetLang: 'zh'
    };
    try {
      const res = await fetch('/api/config', { cache: 'no-cache' });
      if (res.ok) {
        const cfg = await res.json();
        Object.assign(window.VibeConfig, cfg);
      }
    } catch (e) {
      // 静默失败，使用默认配置
    }
  },

  /**
   * 下载文件
   * @param {string} content - 文件内容
   * @param {string} filename - 文件名
   * @param {string} type - MIME类型
   */
  downloadFile(content, filename, type = 'text/plain') {
    try {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.error('Download file error:', error);
      return false;
    }
  },

  /**
   * 渲染所有 SVG 图标（根据 data-icon 属性）
   */
  renderIcons() {
    if (typeof VibeIcons === 'undefined') return;

    const iconElements = document.querySelectorAll('[data-icon]');
    iconElements.forEach(el => {
      const iconName = el.getAttribute('data-icon');
      if (VibeIcons[iconName]) {
        el.innerHTML = VibeIcons[iconName];
      }
    });
  }
};

// 暴露模块
window.VibeApp = VibeApp;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  VibeApp.init();
});