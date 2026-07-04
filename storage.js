/**
 * 本地存储工具模块
 * 提供统一的 localStorage 操作接口，包含错误捕获和数据验证
 */
const VibeStorage = {
  // 存储键名常量
  KEYS: {
    MEMORY: 'vibetrans_memory',
    MEMORY_CATEGORIES: 'vibetrans_memory_categories',
    MEMORY_SETTINGS: 'vibetrans_memory_settings',
    CORPUS: 'vibetrans_corpus',
    SETTINGS: 'vibetrans_settings',
    SPEECH_SETTINGS: 'vibetrans_speech_settings',
    STATS: 'vibetrans_stats',
    PROJECTS: 'vibetrans_projects',
    TRANSLATE_ENGINE: 'vibetrans_translate_engine'
  },

  /**
   * 获取存储数据
   * @param {string} key - 存储键名
   * @param {*} defaultValue - 默认值
   * @returns {*} 解析后的数据
   */
  get(key, defaultValue = null) {
    try {
      const data = localStorage.getItem(key);
      if (data === null) return defaultValue;
      return JSON.parse(data);
    } catch (error) {
      console.error('Storage get error:', error);
      return defaultValue;
    }
  },

  /**
   * 存储数据
   * @param {string} key - 存储键名
   * @param {*} value - 要存储的数据
   * @returns {boolean} 是否成功
   */
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Storage set error:', error);
      return false;
    }
  },

  /**
   * 删除存储数据
   * @param {string} key - 存储键名
   * @returns {boolean} 是否成功
   */
  remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error('Storage remove error:', error);
      return false;
    }
  },

  /**
   * 清空所有存储数据
   * @returns {boolean} 是否成功
   */
  clear() {
    try {
      localStorage.clear();
      return true;
    } catch (error) {
      console.error('Storage clear error:', error);
      return false;
    }
  },

  /**
   * 获取存储使用量（字节）
   * @returns {number} 使用的字节数
   */
  getUsage() {
    try {
      const total = Object.keys(localStorage).reduce((acc, key) => {
        const value = localStorage.getItem(key);
        return acc + key.length + (value ? value.length : 0);
      }, 0);
      return total;
    } catch (error) {
      console.error('Storage usage error:', error);
      return 0;
    }
  },

  /**
   * 获取存储使用百分比
   * @returns {number} 百分比（0-100）
   */
  getUsagePercent() {
    const usage = this.getUsage();
    const maxSize = 5 * 1024 * 1024; // 5MB
    return Math.min((usage / maxSize) * 100, 100);
  },

  /**
   * 检查存储是否可用
   * @returns {boolean} 是否可用
   */
  isAvailable() {
    try {
      const testKey = '__vibetrans_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      return false;
    }
  },

  /**
   * 获取所有存储键
   * @returns {string[]} 所有键名
   */
  getAllKeys() {
    try {
      return Object.keys(localStorage).filter(key => key.startsWith('vibetrans_'));
    } catch (error) {
      console.error('Storage keys error:', error);
      return [];
    }
  }
};

// 暴露模块（供其他模块使用）
window.VibeStorage = VibeStorage;