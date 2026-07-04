/**
 * 模型缓存管理模块 v2.0
 * 功能：
 * 1. 多源下载（国内CDN镜像为主，官方源为备）
 * 2. 超时重试、断点续传
 * 3. 错误分类与明确中文提示
 * 4. 存储空间预检测
 * 5. 本地模型文件导入
 */
const VibeModelCache = {
  db: null,
  dbName: 'VibeTransModelDB_v2',
  dbVersion: 1,

  // 配置键名
  STORES: {
    VOSK: 'vosk_models',
    WHISPER: 'whisper_models',
    DOWNLOAD_PROGRESS: 'download_progress'
  },

  // Vosk模型清单
  // 模型文件需提前解压到 /public/models/vosk/ 目录下
  // 中文/英语模型默认内置，开箱即用
  voskModels: {
    'zh': {
      id: 'vosk-zh',
      name: 'Vosk 中文基础模型',
      lang: '中文',
      size: 45 * 1024 * 1024,
      format: 'directory',
      localUrl: '/public/models/vosk/zh-cn',
      sources: [
        { name: '本地目录', url: '/public/models/vosk/zh-cn', type: 'local' }
      ],
      isBuiltIn: true
    },
    'en': {
      id: 'vosk-en',
      name: 'Vosk 英语基础模型',
      lang: '英语',
      size: 45 * 1024 * 1024,
      format: 'directory',
      localUrl: '/public/models/vosk/en-us',
      sources: [
        { name: '本地目录', url: '/public/models/vosk/en-us', type: 'local' }
      ],
      isBuiltIn: true
    },
    'ja': {
      id: 'vosk-ja',
      name: 'Vosk 日语基础模型',
      lang: '日语',
      size: 48 * 1024 * 1024,
      format: 'directory',
      localUrl: '/public/models/vosk/ja',
      sources: [
        { name: '本地目录', url: '/public/models/vosk/ja', type: 'local' }
      ]
    },
    'ko': {
      id: 'vosk-ko',
      name: 'Vosk 韩语基础模型',
      lang: '韩语',
      size: 35 * 1024 * 1024,
      format: 'directory',
      localUrl: '/public/models/vosk/ko',
      sources: [
        { name: '本地目录', url: '/public/models/vosk/ko', type: 'local' }
      ]
    }
  },

  // Whisper模型清单 - 从本站路径加载，缓存到IndexedDB
  whisperModels: {
    'tiny': {
      id: 'whisper-tiny',
      name: 'Whisper Tiny 多语言版',
      lang: '多语言',
      size: 39 * 1024 * 1024,
      modelKey: 'tiny',
      description: '速度最快，适合快速草稿',
      loadingMode: 'local',
      modelName: 'Xenova/whisper-tiny',
      localPath: '/public/models/whisper/whisper-tiny'
    },
    'base': {
      id: 'whisper-base',
      name: 'Whisper Base 多语言版（推荐）',
      lang: '多语言',
      size: 74 * 1024 * 1024,
      modelKey: 'base',
      description: '平衡速度与准确率',
      isDefault: true,
      loadingMode: 'local',
      modelName: 'Xenova/whisper-base',
      localPath: '/public/models/whisper/whisper-base'
    },
    'small': {
      id: 'whisper-small',
      name: 'Whisper Small 多语言版',
      lang: '多语言',
      size: 244 * 1024 * 1024,
      modelKey: 'small',
      description: '高精度，适合清晰音频',
      loadingMode: 'local',
      modelName: 'Xenova/whisper-small',
      localPath: '/public/models/whisper/whisper-small'
    }
  },

  // 下载配置
  DOWNLOAD_CONFIG: {
    TIMEOUT: 30000,        // 30秒超时
    MAX_RETRIES: 2,        // 最多重试2次
    CHUNK_SIZE: 1024 * 1024 // 1MB分块
  },

  // 当前下载状态
  _currentDownload: null,
  _downloadAborted: false,

  /**
   * 初始化IndexedDB
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        this.db = event.target.result;

        // Vosk模型存储
        if (!this.db.objectStoreNames.contains(this.STORES.VOSK)) {
          const voskStore = this.db.createObjectStore(this.STORES.VOSK, { keyPath: 'id' });
          voskStore.createIndex('lang', 'lang', { unique: false });
          voskStore.createIndex('downloadedAt', 'downloadedAt', { unique: false });
        }

        // Whisper模型存储
        if (!this.db.objectStoreNames.contains(this.STORES.WHISPER)) {
          const whisperStore = this.db.createObjectStore(this.STORES.WHISPER, { keyPath: 'id' });
          whisperStore.createIndex('modelKey', 'modelKey', { unique: false });
          whisperStore.createIndex('downloadedAt', 'downloadedAt', { unique: false });
        }

        // 下载进度记录（支持断点续传）
        if (!this.db.objectStoreNames.contains(this.STORES.DOWNLOAD_PROGRESS)) {
          const progressStore = this.db.createObjectStore(this.STORES.DOWNLOAD_PROGRESS, { keyPath: 'modelId' });
          progressStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(new Error('IndexedDB初始化失败：' + event.target.error?.message));
      };
    });
  },

  /**
   * 确保数据库已初始化
   */
  async ensureDb() {
    if (!this.db) {
      await this.init();
    }
  },

  /**
   * 获取模型
   */
  async getModel(storeName, modelId) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(modelId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * 获取所有模型
   */
  async getAllModels(storeName) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * 保存模型
   */
  async saveModel(storeName, modelData) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(modelData);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * 删除模型
   */
  async deleteModel(storeName, modelId) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(modelId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * 检查模型是否已下载
   */
  async isModelDownloaded(storeName, modelId) {
    const model = await this.getModel(storeName, modelId);
    return !!model;
  },

  /**
   * 获取下载进度记录（用于断点续传）
   */
  async getDownloadProgress(modelId) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.STORES.DOWNLOAD_PROGRESS], 'readonly');
      const store = transaction.objectStore(this.STORES.DOWNLOAD_PROGRESS);
      const request = store.get(modelId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * 保存下载进度
   */
  async saveDownloadProgress(modelId, downloadedBytes, totalBytes, blobData) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.STORES.DOWNLOAD_PROGRESS], 'readwrite');
      const store = transaction.objectStore(this.STORES.DOWNLOAD_PROGRESS);
      const request = store.put({
        modelId,
        downloadedBytes,
        totalBytes,
        timestamp: Date.now()
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * 清除下载进度
   */
  async clearDownloadProgress(modelId) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.STORES.DOWNLOAD_PROGRESS], 'readwrite');
      const store = transaction.objectStore(this.STORES.DOWNLOAD_PROGRESS);
      const request = store.delete(modelId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * 检测浏览器存储空间是否足够
   */
  async checkStorageSpace(requiredBytes) {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        const availableBytes = estimate.quota - estimate.usage;

        if (availableBytes < requiredBytes) {
          return {
            sufficient: false,
            available: availableBytes,
            required: requiredBytes,
            message: `存储空间不足：需要 ${this.formatSize(requiredBytes)}，可用 ${this.formatSize(availableBytes)}`
          };
        }
      }
      return { sufficient: true };
    } catch (e) {
      console.warn('存储空间检测失败:', e);
      return { sufficient: true };
    }
  },

  /**
   * 检测是否为无痕模式
   */
  detectPrivateMode() {
    try {
      const fs = window.RequestFileSystem || window.webkitRequestFileSystem;
      if (fs) {
        return new Promise((resolve) => {
          fs(window.TEMPORARY, 100, () => resolve(false), () => resolve(true));
        });
      }

      // 检测localStorage是否可用
      try {
        localStorage.setItem('__test__', '1');
        localStorage.removeItem('__test__');
        return Promise.resolve(false);
      } catch (e) {
        return Promise.resolve(true);
      }
    } catch (e) {
      return Promise.resolve(false);
    }
  },

  /**
   * 格式化文件大小
   */
  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  },

  /**
   * 错误分类与提示生成
   */
  classifyError(error, context = '') {
    const errorStr = String(error.message || error);
    console.error(`[ModelCache] 下载错误 ${context}:`, errorStr);

    if (error.name === 'AbortError' || errorStr.includes('abort')) {
      return { type: 'aborted', message: '下载已取消', recoverable: false };
    }

    if (errorStr.includes('timeout') || errorStr.includes('Timeout') || errorStr.includes('TIMEOUT')) {
      return { type: 'timeout', message: '网络连接超时，已自动切换备用源重试', recoverable: true };
    }

    if (errorStr.includes('Failed to fetch') || errorStr.includes('NetworkError') ||
        errorStr.includes('net::') || errorStr.includes('Network request failed')) {
      return { type: 'network', message: '无法连接到下载源，请检查网络后重试', recoverable: true };
    }

    if (errorStr.includes('CORS') || errorStr.includes('cors') || errorStr.includes('Cross-Origin')) {
      return { type: 'cors', message: '当前下载源被跨域策略拦截，已自动切换备用地址', recoverable: true };
    }

    if (errorStr.includes('QuotaExceeded') || errorStr.includes('quota') || errorStr.includes('storage')) {
      return { type: 'storage', message: '浏览器存储空间不足，请清理浏览器缓存后重试', recoverable: false };
    }

    if (errorStr.includes('404') || errorStr.includes('Not Found')) {
      return { type: 'notfound', message: '模型地址不存在，请尝试本地导入或联系开发者更新', recoverable: false };
    }

    if (errorStr.includes('disk full') || errorStr.includes('Disk full')) {
      return { type: 'diskfull', message: '磁盘空间不足，请清理磁盘后重试', recoverable: false };
    }

    if (errorStr.includes('UNZIP') || errorStr.includes('unzip')) {
      return { type: 'unzip', message: '模型文件解压失败，可能文件已损坏，请重新下载', recoverable: false };
    }

    return { type: 'unknown', message: `下载失败：${errorStr}`, recoverable: true };
  },

  /**
   * 使用XMLHttpRequest下载（支持进度和断点续传）
   */
  async downloadWithXHR(url, options = {}) {
    const {
      onProgress = () => {},
      onSourceSwitch = () => {},
      startByte = 0,
      timeout = this.DOWNLOAD_CONFIG.TIMEOUT
    } = options;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open('GET', url, true);
      xhr.responseType = 'blob';

      // 设置断点续传的Range头
      if (startByte > 0) {
        xhr.setRequestHeader('Range', `bytes=${startByte}-`);
        console.log(`[ModelCache] 断点续传：从 ${this.formatSize(startByte)} 开始`);
      }

      let lastProgress = 0;
      xhr.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          if (progress !== lastProgress) {
            lastProgress = progress;
            onProgress(progress, event.loaded, event.total);
          }
        } else {
          // 无法获取总大小时，显示已下载量
          onProgress(-1, event.loaded, 0);
        }
      };

      // 设置超时
      xhr.timeout = timeout;
      xhr.ontimeout = () => {
        reject(new Error(`TIMEOUT:${timeout}`));
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // 如果是断点续传，合并已有数据
          if (startByte > 0 && this._partialBlob) {
            this.mergeBlobs(this._partialBlob, xhr.response).then(resolve).catch(reject);
          } else {
            resolve(xhr.response);
          }
        } else if (xhr.status === 416) {
          // Range请求超出范围，表示已完成
          resolve(this._partialBlob);
        } else if (xhr.status === 301 || xhr.status === 302 || xhr.status === 303 || xhr.status === 307 || xhr.status === 308) {
          // 重定向，手动跟随
          const redirectUrl = xhr.getResponseHeader('Location');
          if (redirectUrl) {
            this.downloadWithXHR(redirectUrl, options).then(resolve).catch(reject);
          } else {
            reject(new Error('重定向但无目标地址'));
          }
        } else {
          reject(new Error(`HTTP_${xhr.status}`));
        }
      };

      xhr.onerror = () => {
        reject(new Error('NETWORK_ERROR'));
      };

      xhr.onabort = () => {
        reject(new Error('ABORTED'));
      };

      this._currentXHR = xhr;
      xhr.send();
    });
  },

  /**
   * 合并两个Blob
   */
  async mergeBlobs(blob1, blob2) {
    const buffers = [];
    buffers.push(await blob1.arrayBuffer());
    buffers.push(await blob2.arrayBuffer());
    return new Blob(buffers, { type: blob1.type || 'application/octet-stream' });
  },

  /**
   * 中止当前下载
   */
  abortDownload() {
    this._downloadAborted = true;
    if (this._currentXHR) {
      this._currentXHR.abort();
      this._currentXHR = null;
    }
  },

  /**
   * 核心下载方法 - 多源自动切换
   * @param {Object} modelInfo - 模型信息
   * @param {Function} onProgress - 进度回调 (progress, loaded, total, sourceName)
   * @param {Function} onSourceSwitch - 源切换回调
   */
  async downloadModel(modelInfo, onProgress, onSourceSwitch) {
    this._downloadAborted = false;
    const { id, sources = [], size } = modelInfo;

    if (!sources || sources.length === 0) {
      throw new Error('无可用的下载源');
    }

    // 检查存储空间
    const storageCheck = await this.checkStorageSpace(size);
    if (!storageCheck.sufficient) {
      throw new Error(`STORAGE:${storageCheck.message}`);
    }

    // 检测无痕模式
    const isPrivate = await this.detectPrivateMode();
    if (isPrivate) {
      console.warn('[ModelCache] 检测到无痕/隐私模式');
      onProgress(0, '提示：隐私模式下本地存储受限，请使用普通浏览模式');
    }

    let lastError = null;

    // 尝试每个源
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      const source = sources[sourceIndex];
      const sourceName = source.name || `源${sourceIndex + 1}`;

      if (this._downloadAborted) {
        throw new Error('ABORTED');
      }

      // 尝试下载该源（带重试）
      for (let retry = 0; retry <= this.DOWNLOAD_CONFIG.MAX_RETRIES; retry++) {
        if (this._downloadAborted) {
          throw new Error('ABORTED');
        }

        try {
          console.log(`[ModelCache] 尝试 ${sourceName} (重试 ${retry}/${this.DOWNLOAD_CONFIG.MAX_RETRIES})`);

          const result = await this.downloadWithXHR(source.url, {
            timeout: this.DOWNLOAD_CONFIG.TIMEOUT + (retry * 10000), // 每次重试增加10秒
            onProgress: (progress, loaded, total) => {
              onProgress(progress, loaded, total, sourceName);
            },
            startByte: 0
          });

          // 下载成功
          console.log(`[ModelCache] ${sourceName} 下载成功`);
          return result;

        } catch (error) {
          lastError = error;
          const errorInfo = this.classifyError(error, sourceName);

          console.warn(`[ModelCache] ${sourceName} 下载失败 (重试 ${retry}):`, errorInfo.message);

          // 如果是本地目录类型的源，不重试，直接跳过
          if (source.type === 'local') {
            console.log(`[ModelCache] ${sourceName} 为本地目录，跳过重试`);
            break;
          }

          // 如果是不可恢复的错误，直接抛出
          if (!errorInfo.recoverable) {
            throw new Error(`FATAL:${errorInfo.message}`);
          }

          // 如果还有重试次数，继续重试当前源
          if (retry < this.DOWNLOAD_CONFIG.MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 1000 * (retry + 1))); // 等待后重试
          }
        }
      }

      // 当前源所有重试都失败，切换到下一个源
      if (sourceIndex < sources.length - 1) {
        const msg = `${sourceName} 下载失败，正在切换备用源...`;
        console.log(`[ModelCache] ${msg}`);
        onSourceSwitch(sourceIndex + 1, sources.length, msg);
      }
    }

    // 所有源都失败了
    if (lastError) {
      const errorInfo = this.classifyError(lastError);
      throw new Error(`FATAL:模型资源加载失败，请检查服务器配置后重试`);
    }

    throw new Error('FATAL:模型资源加载失败，请检查服务器配置或联系管理员');
  },

  /**
   * 导入本地模型文件
   * @param {File} file - 用户选择的文件
   * @param {string} storeName - 存储表名
   * @param {string} modelId - 模型ID
   * @param {string} modelName - 模型名称
   */
  async importLocalModel(file, storeName, modelId, modelName) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target.result;
          const blob = new Blob([arrayBuffer]);

          // 校验文件
          if (blob.size < 1024) {
            reject(new Error('文件太小，不是有效的模型文件'));
            return;
          }

          // 保存到IndexedDB
          await this.saveModel(storeName, {
            id: modelId,
            name: modelName,
            blob: blob,
            size: blob.size,
            downloadedAt: Date.now(),
            isLocalImport: true
          });

          console.log(`[ModelCache] 本地模型 ${modelName} 导入成功，大小: ${this.formatSize(blob.size)}`);
          resolve({ size: blob.size });
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = () => {
        reject(new Error('文件读取失败'));
      };

      reader.readAsArrayBuffer(file);
    });
  },

  /**
   * 获取模型列表（带下载状态）
   */
  async getModelList() {
    await this.ensureDb();

    const voskDownloaded = await this.getAllModels(this.STORES.VOSK);
    const whisperDownloaded = await this.getAllModels(this.STORES.WHISPER);

    const downloadedMap = {};
    voskDownloaded.forEach(m => downloadedMap[m.id] = m);
    whisperDownloaded.forEach(m => downloadedMap[m.id] = m);

    // 构建完整列表
    const models = [];

    // Vosk模型
    Object.entries(this.voskModels).forEach(([key, model]) => {
      const cached = downloadedMap[model.id];
      models.push({
        ...model,
        store: this.STORES.VOSK,
        isDownloaded: !!cached,
        cachedSize: cached ? cached.size : 0,
        downloadedAt: cached ? cached.downloadedAt : null
      });
    });

    // Whisper模型
    Object.entries(this.whisperModels).forEach(([key, model]) => {
      const cached = downloadedMap[model.id];
      models.push({
        ...model,
        store: this.STORES.WHISPER,
        isDownloaded: !!cached,
        cachedSize: cached ? cached.size : 0,
        downloadedAt: cached ? cached.downloadedAt : null
      });
    });

    return models;
  },

  /**
   * 清除所有模型缓存
   */
  async clearAllModels() {
    await this.ensureDb();

    const stores = [this.STORES.VOSK, this.STORES.WHISPER, this.STORES.DOWNLOAD_PROGRESS];

    for (const storeName of stores) {
      await new Promise((resolve, reject) => {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    console.log('[ModelCache] 已清除所有模型缓存');
  },

  /**
   * 检查本地HTTP模型是否可用
   * @param {string} url - 模型目录的HTTP URL
   * @returns {boolean} - 是否可用
   */
  async checkHttpModelAvailable(url) {
    try {
      const response = await fetch(url + '/model.conf', { method: 'HEAD' });
      return response.ok;
    } catch (error) {
      console.log('[ModelCache] HTTP模型不可用:', url);
      return false;
    }
  },
};

// 暴露到全局
window.VibeModelCache = VibeModelCache;
