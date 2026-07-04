/**
 * 设置模块
 * 管理翻译服务配置、API密钥、数据导出/重置
 */
const VibeSettings = {
  init() {
    this.loadSavedConfig();
    this.updateStorageUsage();
    this.bindEvents();
  },

  loadSavedConfig() {
    const saved = VibeStorage.get(VibeStorage.KEYS.SETTINGS, {
      service: 'free',
      apiKey: '',
      apiSecret: ''
    });

    const serviceRadios = document.querySelectorAll('input[name="translateService"]');
    serviceRadios.forEach(radio => {
      if (radio.value === saved.service) {
        radio.checked = true;
      }
    });

    const apiKeyInput = document.getElementById('apiKeyInput');
    if (apiKeyInput) apiKeyInput.value = saved.apiKey || '';
    const apiSecretInput = document.getElementById('apiSecretInput');
    if (apiSecretInput) apiSecretInput.value = saved.apiSecret || '';
  },

  bindEvents() {
    const saveBtn = document.getElementById('saveApiConfig');
    if (saveBtn) saveBtn.addEventListener('click', () => this.saveConfig());

    const exportBtn = document.getElementById('exportAllData');
    if (exportBtn) exportBtn.addEventListener('click', () => this.exportAllData());

    const clearBtn = document.getElementById('clearAllData');
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearAllData());
  },

  trackDeploy(platform) {
    console.log(`Deploy clicked: ${platform}`);
  },

  saveConfig() {
    const service = document.querySelector('input[name="translateService"]:checked');
    const apiKey = document.getElementById('apiKeyInput');
    const apiSecret = document.getElementById('apiSecretInput');

    if (!service || !apiKey || !apiSecret) {
      VibeApp.showToast('配置项不完整', 'error');
      return;
    }

    const settingsData = {
      service: service.value,
      apiKey: apiKey.value.trim(),
      apiSecret: apiSecret.value.trim()
    };

    const success = VibeStorage.set(VibeStorage.KEYS.SETTINGS, settingsData);

    if (success) {
      VibeApp.showToast('配置保存成功', 'success');
    } else {
      VibeApp.showToast('保存失败，请检查存储空间', 'error');
    }
  },

  exportAllData() {
    try {
      const data = {
        memory: VibeStorage.get(VibeStorage.KEYS.MEMORY, []),
        corpus: VibeStorage.get(VibeStorage.KEYS.CORPUS, []),
        settings: VibeStorage.get(VibeStorage.KEYS.SETTINGS, {}),
        stats: VibeStorage.get(VibeStorage.KEYS.STATS, {})
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vibetrans_export_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      VibeApp.showToast('数据导出成功', 'success');
    } catch (error) {
      console.error('Export error:', error);
      VibeApp.showToast('导出失败', 'error');
    }
  },

  clearAllData() {
    if (!confirm('确定要重置所有数据吗？此操作不可撤销。')) {
      return;
    }

    VibeStorage.clear();
    
    this.loadSavedConfig();
    this.updateStorageUsage();
    
    if (typeof VibeMemory.init === 'function') VibeMemory.init();
    if (typeof VibeCorpus.init === 'function') VibeCorpus.init();

    VibeApp.showToast('所有数据已重置', 'success');
  },

  updateStorageUsage() {
    const usage = VibeStorage.getUsage();
    const usageEl = document.getElementById('storageUsed');
    if (usageEl) {
      if (usage < 1024) {
        usageEl.textContent = `${usage} B`;
      } else if (usage < 1024 * 1024) {
        usageEl.textContent = `${(usage / 1024).toFixed(1)} KB`;
      } else {
        usageEl.textContent = `${(usage / (1024 * 1024)).toFixed(2)} MB`;
      }
    }
  }
};

window.VibeSettings = VibeSettings;
