const VibeAudioManager = {
  audioBlob: null,
  audioUrl: null,
  wavesurfer: null,
  regionsPlugin: null,
  isExtracting: false,
  isWaveformReady: false,
  ffmpeg: null,
  ffmpegLoaded: false,
  ffmpegLoading: false,
  waveformContainerId: 'waveform',

  syncWithVideo: true,
  
  isMuted: false,
  currentVolume: 0.5,

  async init() {
    this.showWaveformPlaceholder();
    await this.preloadFFmpeg();
    this.checkTransformers();
  },

  checkTransformers() {
    if (typeof window.transformers !== 'undefined') {
      console.log('[AudioManager] Transformers.js loaded successfully');
      return true;
    } else {
      console.warn('[AudioManager] Transformers.js not loaded, attempting dynamic load...');
      this.loadTransformersDynamically();
      return false;
    }
  },

  async loadTransformersDynamically() {
    try {
      const script = document.createElement('script');
      script.src = '/public/transformers/transformers.min.js';
      script.async = false;

      await new Promise((resolve, reject) => {
        script.onload = () => {
          console.log('[AudioManager] Transformers.js loaded dynamically');
          resolve();
        };
        script.onerror = () => {
          console.error('[AudioManager] Failed to load Transformers.js dynamically');
          reject();
        };
        document.head.appendChild(script);
      });

      if (typeof window.transformers === 'undefined') {
        console.log('[AudioManager] Attempting to bind __webpack_exports__ to window');
        const injectScript = document.createElement('script');
        injectScript.textContent = `
          if (typeof __webpack_exports__ !== 'undefined') {
            window.transformers = __webpack_exports__;
            window.pipeline = __webpack_exports__.pipeline;
            window.loadTransformers = function() { return __webpack_exports__; };
            console.log('Transformers.js global variables bound successfully');
          }
        `;
        document.head.appendChild(injectScript);
        injectScript.remove();
      }

      if (typeof window.transformers !== 'undefined') {
        console.log('[AudioManager] Transformers.js is now available');
      }
    } catch (error) {
      console.error('[AudioManager] Dynamic load failed:', error);
    }
  },

  async preloadFFmpeg() {
    console.log('[AudioManager] Preloading FFmpeg...');
    try {
      const ffmpegModule = window.FFmpegWASM;
      if (!ffmpegModule || !ffmpegModule.FFmpeg) {
        console.warn('[AudioManager] FFmpegWASM not found, will use Web Audio API fallback');
        return;
      }

      const { FFmpeg } = ffmpegModule;
      this.ffmpeg = new FFmpeg();

      await this.ffmpeg.load({
        coreURL: '/public/ffmpeg/ffmpeg-core.js',
        wasmURL: '/public/ffmpeg/ffmpeg-core.wasm'
      });

      this.ffmpegLoaded = true;
      console.log('[AudioManager] FFmpeg preloaded successfully');
    } catch (error) {
      console.error('[AudioManager] FFmpeg preload failed:', error);
      console.warn('[AudioManager] Will use Web Audio API fallback for audio extraction');
    }
  },

  async extractAudio(videoFile, onProgress) {
    if (this.isExtracting) return this.audioBlob;
    
    this.isExtracting = true;
    this.showWaveformLoading();
    
    console.log('[AudioManager] 开始提取音频，文件:', videoFile.name, '大小:', videoFile.size);
    
    try {
      console.log('[AudioManager] 尝试方案1: Web Audio API + FileReader');
      if (onProgress) onProgress(5, '正在读取音频...');
      
      try {
        const wavBlob = await this.extractAudioFast(videoFile, onProgress);
        if (wavBlob && wavBlob.size > 0) {
          console.log('[AudioManager] 方案1成功，大小:', wavBlob.size);
          await this.processAudioResult(wavBlob, onProgress);
          return wavBlob;
        }
      } catch (e) {
        console.warn('[AudioManager] 方案1失败:', e.message);
      }

      // 方案2：使用 FFmpeg.wasm
      console.log('[AudioManager] 尝试方案2: FFmpeg.wasm');
      if (!this.ffmpegLoaded) {
        await this.preloadFFmpeg();
        if (!this.ffmpegLoaded) {
          throw new Error('FFmpeg未加载成功');
        }
      }

      if (onProgress) onProgress(10, '正在提取音频...');

      const arrayBuffer = await videoFile.arrayBuffer();
      const videoName = videoFile.name;
      
      this.ffmpeg.FS('writeFile', videoName, new Uint8Array(arrayBuffer));
      
      const outputName = 'audio.wav';
      
      await this.ffmpeg.run(
        '-i', videoName,
        '-ac', '1',
        '-ar', '16000',
        '-f', 'wav',
        outputName
      );
      
      const data = this.ffmpeg.FS('readFile', outputName);
      this.audioBlob = new Blob([data.buffer], { type: 'audio/wav' });
      
      this.ffmpeg.FS('unlink', videoName);
      this.ffmpeg.FS('unlink', outputName);

      if (!this.audioBlob || this.audioBlob.size === 0) {
        throw new Error('音频提取结果为空');
      }

      await this.processAudioResult(this.audioBlob, onProgress);
      return this.audioBlob;
      
    } catch (error) {
      console.error('[AudioManager] 音频提取失败:', error);
      this.showWaveformError('音频提取失败，请重新导入视频');
      throw new Error('音频提取失败: ' + error.message);
    } finally {
      this.isExtracting = false;
    }
  },

  /**
   * 仅供语音识别使用的音频提取（不影响现有波形）
   * 若已有 audioBlob 则直接复用，否则提取后不重新加载波形
   * @param {File} videoFile - 视频文件
   * @param {Function} onProgress - 进度回调
   * @returns {Promise<Blob>} 音频 Blob
   */
  async extractAudioForRecognition(videoFile, onProgress) {
    // 已有缓存直接复用
    if (this.audioBlob && this.audioBlob.size > 0) {
      console.log('[AudioManager] 复用已有音频，跳过提取');
      // 若 wavesurfer 未初始化或未加载音频，则补一次渲染（不破坏已有波形）
      if (!this.wavesurfer || !this.wavesurfer.isReady) {
        console.log('[AudioManager] 波形未就绪，补渲染波形');
        try {
          await this.initAndLoadWaveform(this.audioBlob);
        } catch (e) {
          console.warn('[AudioManager] 补渲染波形失败:', e.message);
        }
      }
      if (onProgress) onProgress(100, '使用已有音频');
      return this.audioBlob;
    }

    if (this.isExtracting) {
      // 等待已有提取完成
      let waited = 0;
      while (this.isExtracting && waited < 30000) {
        await new Promise(r => setTimeout(r, 200));
        waited += 200;
      }
      if (this.audioBlob) {
        // 同样补一次波形渲染
        if (!this.wavesurfer || !this.wavesurfer.isReady) {
          try { await this.initAndLoadWaveform(this.audioBlob); } catch(e) {}
        }
        return this.audioBlob;
      }
    }

    this.isExtracting = true;
    console.log('[AudioManager] 提取音频用于识别（首次提取后将渲染波形）');

    try {
      if (onProgress) onProgress(5, '正在读取音频...');

      // 仅提取，不调用 processAudioResult（避免重置波形）
      let wavBlob = null;
      try {
        wavBlob = await this.extractAudioFast(videoFile, onProgress);
      } catch (e) {
        console.warn('[AudioManager] 快速提取失败，尝试 FFmpeg:', e.message);
      }

      if (!wavBlob || wavBlob.size === 0) {
        // 回退到 FFmpeg
        if (!this.ffmpegLoaded) {
          await this.preloadFFmpeg();
        }
        if (onProgress) onProgress(30, 'FFmpeg 提取中...');
        const arrayBuffer = await videoFile.arrayBuffer();
        const videoName = videoFile.name;
        this.ffmpeg.FS('writeFile', videoName, new Uint8Array(arrayBuffer));
        await this.ffmpeg.run('-i', videoName, '-ac', '1', '-ar', '16000', '-f', 'wav', 'audio_rec.wav');
        const data = this.ffmpeg.FS('readFile', 'audio_rec.wav');
        wavBlob = new Blob([data.buffer], { type: 'audio/wav' });
        this.ffmpeg.FS('unlink', videoName);
        this.ffmpeg.FS('unlink', 'audio_rec.wav');
      }

      if (!wavBlob || wavBlob.size === 0) {
        throw new Error('音频提取结果为空');
      }

      // 缓存音频
      this.audioBlob = wavBlob;

      // 若 wavesurfer 还未加载音频，则首次渲染波形（不影响已存在的波形）
      if (!this.wavesurfer || !this.wavesurfer.isReady) {
        console.log('[AudioManager] 首次提取，渲染波形');
        try {
          await this.initAndLoadWaveform(wavBlob);
        } catch (e) {
          console.warn('[AudioManager] 波形渲染失败（不影响识别）:', e.message);
        }
      } else {
        console.log('[AudioManager] 波形已就绪，保持不变');
      }

      if (onProgress) onProgress(100, '音频就绪');
      return wavBlob;
    } catch (error) {
      console.error('[AudioManager] 识别用音频提取失败:', error);
      throw new Error('音频提取失败: ' + error.message);
    } finally {
      this.isExtracting = false;
    }
  },

  /**
   * 使用 Web Audio API 快速提取音频（最快方案）
   */
  async extractAudioFast(videoFile, onProgress) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      throw new Error('浏览器不支持 Web Audio API');
    }

    const audioContext = new AudioContext();

    try {
      // 读取文件并解码
      const arrayBuffer = await videoFile.arrayBuffer();
      
      if (onProgress) onProgress(30, '正在解码音频...');
      
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      if (onProgress) onProgress(60, '正在转换格式...');
      
      // 转换为单声道、16000Hz
      let targetBuffer = audioBuffer;
      
      // 需要重采样
      if (audioBuffer.sampleRate !== 16000) {
        console.log('[AudioManager] 重采样:', audioBuffer.sampleRate, '-> 16000');
        const offlineCtx = new OfflineAudioContext(1, audioBuffer.length * 16000 / audioBuffer.sampleRate, 16000);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start(0);
        targetBuffer = await offlineCtx.startRendering();
      }

      // 转换为单声道
      if (targetBuffer.numberOfChannels > 1) {
        console.log('[AudioManager] 转换为单声道');
        const monoBuffer = audioContext.createBuffer(1, targetBuffer.length, targetBuffer.sampleRate);
        const monoData = monoBuffer.getChannelData(0);
        const channelData = targetBuffer.getChannelData(0);
        for (let i = 0; i < channelData.length; i++) {
          monoData[i] = channelData[i];
        }
        targetBuffer = monoBuffer;
      }

      // 验证时长一致性（如果有视频元素）
      let finalBuffer = targetBuffer;
      if (VibeSubtitles && VibeSubtitles.videoElement && VibeSubtitles.videoElement.duration > 0) {
        const videoDuration = VibeSubtitles.videoElement.duration;
        const audioDuration = targetBuffer.duration;
        const durationDiff = Math.abs(videoDuration - audioDuration);
        
        console.log('[AudioManager] 视频时长:', videoDuration.toFixed(2), 's, 音频时长:', audioDuration.toFixed(2), 's, 差异:', durationDiff.toFixed(2), 's');
        
        if (durationDiff > 0.5) {
          console.warn('[AudioManager] 音频时长与视频不一致，调整音频时长');
          const targetLength = Math.round(videoDuration * 16000);
          if (targetLength !== targetBuffer.length) {
            finalBuffer = audioContext.createBuffer(1, targetLength, 16000);
            const sourceData = targetBuffer.getChannelData(0);
            const targetData = finalBuffer.getChannelData(0);
            const minLength = Math.min(sourceData.length, targetLength);
            for (let i = 0; i < minLength; i++) {
              targetData[i] = sourceData[i];
            }
          }
        }
      }

      // 转换为 WAV
      return this.bufferToWav(finalBuffer, 16000);

    } finally {
      try { await audioContext.close(); } catch(e) {}
    }
  },

  /**
   * 处理音频提取结果
   */
  async processAudioResult(wavBlob, onProgress) {
    this.audioBlob = wavBlob;

    if (onProgress) onProgress(90, '正在渲染波形...');

    await this.initAndLoadWaveform(wavBlob);

    if (onProgress) onProgress(100, '音频提取完成');

    if (VibeSubtitles && VibeSubtitles.onAudioReady) {
      VibeSubtitles.onAudioReady(wavBlob);
    }
  },

  /**
   * 将 AudioBuffer 转换为 WAV Blob
   */
  bufferToWav(audioBuffer, sampleRate) {
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

  async initAndLoadWaveform(audioBlob) {
    console.log('[AudioManager] initAndLoadWaveform 开始，audioBlob:', audioBlob ? audioBlob.size : 'null');
    
    if (!audioBlob || audioBlob.size === 0) {
      console.error('[AudioManager] 音频文件无效');
      this.showWaveformError('音频文件无效');
      return;
    }

    this.destroy();

    const container = document.getElementById(this.waveformContainerId);
    if (!container) {
      console.error('[AudioManager] 波形容器不存在');
      return;
    }

    console.log('[AudioManager] 波形容器:', container);
    
    container.innerHTML = '';

    try {
      let WaveSurfer = window.WaveSurfer;
      let RegionsPlugin = window.RegionsPlugin;
      
      console.log('[AudioManager] WaveSurfer 已存在:', !!WaveSurfer, 'RegionsPlugin 已存在:', !!RegionsPlugin);

      if (!WaveSurfer || !RegionsPlugin) {
        const wavesurferScript = document.createElement('script');
        wavesurferScript.src = '/public/wavesurfer/wavesurfer.min.js';
        wavesurferScript.async = false;

        const regionsScript = document.createElement('script');
        regionsScript.src = '/public/wavesurfer/regions.js';
        regionsScript.async = false;

        await new Promise((resolve, reject) => {
          let loadedCount = 0;
          const checkLoaded = () => {
            loadedCount++;
            if (loadedCount === 2) {
              WaveSurfer = window.WaveSurfer;
              RegionsPlugin = window.RegionsPlugin;
              if (WaveSurfer && RegionsPlugin) {
                resolve();
              } else {
                reject(new Error('WaveSurfer 加载失败'));
              }
            }
          };
          wavesurferScript.onload = checkLoaded;
          regionsScript.onload = checkLoaded;
          wavesurferScript.onerror = () => reject(new Error('wavesurfer.js 加载失败'));
          regionsScript.onerror = () => reject(new Error('regions.js 加载失败'));
          document.head.appendChild(wavesurferScript);
          document.head.appendChild(regionsScript);
        });
      }

      console.log('[AudioManager] WaveSurfer:', typeof WaveSurfer, 'RegionsPlugin:', typeof RegionsPlugin);

      const regionsInstance = RegionsPlugin.create();

      this.wavesurfer = WaveSurfer.create({
        container: container,
        waveColor: '#e5e7eb',
        progressColor: '#2563eb',
        cursorColor: '#1d4ed8',
        barWidth: 2,
        barGap: 1,
        height: 100,
        normalize: true,
        plugins: [
          regionsInstance
        ]
      });

      this.regionsPlugin = regionsInstance;

      this.wavesurfer.on('ready', () => {
        console.log('[AudioManager] 波形渲染完成');
        this.isWaveformReady = true;
        this.enableWaveformButtons();
        
        if (VibeSubtitles) {
          VibeSubtitles.onWaveformReady();
        }
        
        try {
          this.initTimeline();
        } catch (e) {
          console.error('[AudioManager] Timeline initialization error:', e);
        }
      });

      this.wavesurfer.on('error', (error) => {
        console.error('[AudioManager] 波形加载错误:', error);
        this.isWaveformReady = false;
        this.showWaveformError('音频加载失败，请重新导入视频');
        this.disableWaveformButtons();
      });

      this._syncingPosition = false;
      this._syncDirection = null;

      // 波形播放时持续同步视频位置（精确到0.1秒）
      this.wavesurfer.on('audioprocess', () => {
        if (this._syncingPosition) return;
        if (this.syncWithVideo && VibeSubtitles && VibeSubtitles.videoElement) {
          const wsTime = this.wavesurfer.getCurrentTime();
          const video = VibeSubtitles.videoElement;
          const videoTime = video.currentTime;
          const diff = Math.abs(videoTime - wsTime);

          if (diff > 0.1) {
            this._syncingPosition = true;
            this._syncDirection = 'ws-to-video';
            video.currentTime = wsTime;
            setTimeout(() => {
              this._syncingPosition = false;
              this._syncDirection = null;
            }, 100);
          }

          const videoRate = video.playbackRate;
          if (videoRate && videoRate !== this.wavesurfer.getPlaybackRate()) {
            this.wavesurfer.setPlaybackRate(videoRate, false);
          }
        }
        
        this.updateTimeline();
      });

      // 用户拖动波形进度条时，立即同步视频
      this.wavesurfer.on('seek', (time) => {
        if (this._syncingPosition) return;
        if (this.syncWithVideo && VibeSubtitles && VibeSubtitles.videoElement) {
          this._syncingPosition = true;
          this._syncDirection = 'ws-to-video';
          VibeSubtitles.videoElement.currentTime = time;
          setTimeout(() => {
            this._syncingPosition = false;
            this._syncDirection = null;
          }, 100);
        }
        
        this.updateTimeline();
      });

      // 波形播放状态变化时同步视频
      this.wavesurfer.on('play', () => {
        if (this._syncingPosition) return;
        if (this.syncWithVideo && VibeSubtitles && VibeSubtitles.videoElement) {
          const video = VibeSubtitles.videoElement;
          if (video.paused) {
            this._syncingPosition = true;
            this._syncDirection = 'ws-to-video';
            video.currentTime = this.wavesurfer.getCurrentTime();
            video.play().catch(() => {});
            setTimeout(() => {
              this._syncingPosition = false;
              this._syncDirection = null;
            }, 100);
          }
        }
      });

      this.wavesurfer.on('pause', () => {
        if (this._syncingPosition) return;
        if (this.syncWithVideo && VibeSubtitles && VibeSubtitles.videoElement) {
          const video = VibeSubtitles.videoElement;
          if (!video.paused) {
            video.pause();
          }
        }
      });

      // 监听视频事件来同步波形（含位置同步）
      if (VibeSubtitles && VibeSubtitles.videoElement) {
        const video = VibeSubtitles.videoElement;

        // 视频播放：波形跟随播放，先对齐位置
        video.addEventListener('play', () => {
          if (this._syncingPosition) return;
          if (this.syncWithVideo && this.wavesurfer && !this.wavesurfer.isPlaying()) {
            this._syncingPosition = true;
            this._syncDirection = 'video-to-ws';
            const videoTime = video.currentTime;
            const wsDuration = this.wavesurfer.getDuration();
            if (wsDuration > 0 && videoTime <= wsDuration) {
              this.wavesurfer.seekTo(videoTime / wsDuration);
            }
            setTimeout(() => {
              this._syncingPosition = false;
              this._syncDirection = null;
              if (this.syncWithVideo && this.wavesurfer) {
                this.wavesurfer.setPlaybackRate(video.playbackRate, false);
                this.wavesurfer.play();
              }
            }, 100);
          }
        });

        // 视频暂停：波形暂停
        video.addEventListener('pause', () => {
          if (this._syncingPosition) return;
          if (this.syncWithVideo && this.wavesurfer && this.wavesurfer.isPlaying()) {
            this.wavesurfer.pause();
          }
        });

        // 速率变化同步
        video.addEventListener('ratechange', () => {
          if (this.syncWithVideo && this.wavesurfer) {
            this.wavesurfer.setPlaybackRate(video.playbackRate, false);
          }
        });

        // 用户拖动视频进度条时，立即同步波形位置
        video.addEventListener('seeked', () => {
          if (this._syncingPosition || this._syncDirection === 'ws-to-video') return;
          if (this.syncWithVideo && this.wavesurfer) {
            const wsDuration = this.wavesurfer.getDuration();
            const videoTime = video.currentTime;
            if (wsDuration > 0 && videoTime <= wsDuration) {
              const wsTime = this.wavesurfer.getCurrentTime();
              if (Math.abs(wsTime - videoTime) > 0.1) {
                this._syncingPosition = true;
                this._syncDirection = 'video-to-ws';
                this.wavesurfer.seekTo(videoTime / wsDuration);
                setTimeout(() => {
                  this._syncingPosition = false;
                  this._syncDirection = null;
                }, 100);
              }
            }
          }
        });

        // 视频时间更新：定期检查位置偏移并同步（防止漂移）
        video.addEventListener('timeupdate', () => {
          if (this._syncingPosition || this._syncDirection === 'ws-to-video') return;
          if (this.syncWithVideo && this.wavesurfer && video.currentTime > 0) {
            const videoTime = video.currentTime;
            const wsTime = this.wavesurfer.getCurrentTime();
            const wsDuration = this.wavesurfer.getDuration();
            const diff = Math.abs(videoTime - wsTime);

            // 如果视频在播但波形没播，强制启动波形
            if (!video.paused && !this.wavesurfer.isPlaying()) {
              if (wsDuration > 0 && videoTime <= wsDuration) {
                this._syncingPosition = true;
                this._syncDirection = 'video-to-ws';
                this.wavesurfer.seekTo(videoTime / wsDuration);
                setTimeout(() => {
                  this._syncingPosition = false;
                  this._syncDirection = null;
                  if (this.syncWithVideo && this.wavesurfer) {
                    this.wavesurfer.setPlaybackRate(video.playbackRate, false);
                    this.wavesurfer.play();
                  }
                }, 100);
              }
            }
            // 如果位置偏差超过0.2秒，校正波形位置
            else if (diff > 0.2 && wsDuration > 0 && videoTime <= wsDuration) {
              this._syncingPosition = true;
              this._syncDirection = 'video-to-ws';
              this.wavesurfer.seekTo(videoTime / wsDuration);
              setTimeout(() => {
                this._syncingPosition = false;
                this._syncDirection = null;
              }, 100);
            }
          }
        });
      }

      if (this.audioUrl) {
        URL.revokeObjectURL(this.audioUrl);
      }
      this.audioUrl = URL.createObjectURL(audioBlob);
      
      this.wavesurfer.load(this.audioUrl);

    } catch (error) {
      console.error('[AudioManager] 波形初始化失败:', error);
      this.showWaveformError('波形初始化失败，请刷新页面重试');
    }
  },

  showWaveformLoading() {
    const container = document.getElementById(this.waveformContainerId);
    if (container) {
      container.innerHTML = `
        <div class="waveform-loading">
          <div class="loading-spinner"></div>
          <div class="loading-text">正在提取音频...</div>
        </div>
      `;
    }
  },

  showWaveformError(message) {
    const container = document.getElementById(this.waveformContainerId);
    if (container) {
      container.innerHTML = `
        <div class="waveform-error">
          <div class="error-icon">❌</div>
          <div class="error-message">${message}</div>
          <button class="btn btn-secondary btn-sm" onclick="VibeAudioManager.retryLoad()">重新加载</button>
        </div>
      `;
    }
    this.disableWaveformButtons();
  },

  showWaveformPlaceholder() {
    const container = document.getElementById(this.waveformContainerId);
    if (container) {
      container.innerHTML = `
        <div class="waveform-placeholder">
          <div class="placeholder-icon">🎵</div>
          <div class="placeholder-text">导入视频后自动渲染音频波形</div>
        </div>
      `;
    }
    this.disableWaveformButtons();
    
    const markStart = document.getElementById('markStart');
    const markEnd = document.getElementById('markEnd');
    if (markStart) markStart.disabled = false;
    if (markEnd) markEnd.disabled = false;
  },

  async retryLoad() {
    if (this.audioBlob) {
      await this.initAndLoadWaveform(this.audioBlob);
    }
  },

  enableWaveformButtons() {
    const playBtn = document.querySelector('.waveform-controls [onclick="VibeAudioManager.play()"]');
    const pauseBtn = document.querySelector('.waveform-controls [onclick="VibeAudioManager.pause()"]');
    const volumeSlider = document.getElementById('volumeSlider');
    const zoomInBtn = document.querySelector('.waveform-controls [onclick="VibeAudioManager.zoomIn()"]');
    const zoomOutBtn = document.querySelector('.waveform-controls [onclick="VibeAudioManager.zoomOut()"]');
    const resetBtn = document.querySelector('.waveform-controls [onclick="VibeAudioManager.resetZoom()"]');
    
    const markStart = document.getElementById('markStart');
    const markEnd = document.getElementById('markEnd');
    const addSubtitleBtn = document.getElementById('addSubtitleBtn');

    if (playBtn) playBtn.disabled = false;
    if (pauseBtn) pauseBtn.disabled = false;
    if (volumeSlider) volumeSlider.disabled = false;
    if (zoomInBtn) zoomInBtn.disabled = false;
    if (zoomOutBtn) zoomOutBtn.disabled = false;
    if (resetBtn) resetBtn.disabled = false;
    
    if (markStart) markStart.disabled = false;
    if (markEnd) markEnd.disabled = false;
    if (addSubtitleBtn) addSubtitleBtn.disabled = false;
    
    this.setVolume(this.currentVolume);
  },

  disableWaveformButtons() {
    const playBtn = document.querySelector('.waveform-controls [onclick="VibeAudioManager.play()"]');
    const pauseBtn = document.querySelector('.waveform-controls [onclick="VibeAudioManager.pause()"]');
    const volumeSlider = document.getElementById('volumeSlider');
    const zoomInBtn = document.querySelector('.waveform-controls [onclick="VibeAudioManager.zoomIn()"]');
    const zoomOutBtn = document.querySelector('.waveform-controls [onclick="VibeAudioManager.zoomOut()"]');
    const resetBtn = document.querySelector('.waveform-controls [onclick="VibeAudioManager.resetZoom()"]');
    
    const markStart = document.getElementById('markStart');
    const markEnd = document.getElementById('markEnd');
    const addSubtitleBtn = document.getElementById('addSubtitleBtn');

    if (playBtn) playBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = true;
    if (volumeSlider) volumeSlider.disabled = true;
    if (zoomInBtn) zoomInBtn.disabled = true;
    if (zoomOutBtn) zoomOutBtn.disabled = true;
    if (resetBtn) resetBtn.disabled = true;
    
    if (markStart) markStart.disabled = true;
    if (markEnd) markEnd.disabled = true;
    if (addSubtitleBtn) addSubtitleBtn.disabled = true;
  },

  toggleSync() {
    const wasSynced = this.syncWithVideo;
    this.syncWithVideo = !this.syncWithVideo;
    const btn = document.getElementById('syncToggleBtn');
    if (btn) {
      btn.classList.toggle('active', this.syncWithVideo);
      btn.textContent = this.syncWithVideo ? '🔗 同步' : '🔓 独立';
      btn.title = this.syncWithVideo ? '音波与视频同步播放（位置+速率+播放状态）' : '音波独立播放（点击切换为同步播放）';
    }

    if (this.syncWithVideo && !wasSynced) {
      // 从独立切换为同步：立即对齐位置
      if (this.wavesurfer && VibeSubtitles && VibeSubtitles.videoElement) {
        const video = VibeSubtitles.videoElement;
        const wsDuration = this.wavesurfer.getDuration();
        const videoTime = video.currentTime;
        const wsTime = this.wavesurfer.getCurrentTime();
        const diff = Math.abs(videoTime - wsTime);
        
        console.log('[AudioManager] 切换为同步模式 - 视频位置:', videoTime.toFixed(2), 's, 波形位置:', wsTime.toFixed(2), 's, 差异:', diff.toFixed(2), 's');
        
        if (wsDuration > 0 && videoTime <= wsDuration) {
          this._syncingPosition = true;
          this._syncDirection = 'video-to-ws';
          this.wavesurfer.seekTo(videoTime / wsDuration);
          setTimeout(() => {
            this._syncingPosition = false;
            this._syncDirection = null;
            if (this.syncWithVideo) {
              this.wavesurfer.setPlaybackRate(video.playbackRate, false);
              if (!video.paused && !this.wavesurfer.isPlaying()) {
                this.wavesurfer.play();
              } else if (video.paused && this.wavesurfer.isPlaying()) {
                this.wavesurfer.pause();
              }
            }
          }, 100);
        }
      }
    } else if (!this.syncWithVideo && wasSynced) {
      console.log('[AudioManager] 切换为独立模式，音波可独立播放');
    }
    return this.syncWithVideo;
  },

  play() {
    if (this.wavesurfer) {
      this.wavesurfer.play();
    }
  },

  pause() {
    if (this.wavesurfer) {
      this.wavesurfer.pause();
    }
  },

  togglePlay() {
    if (this.wavesurfer) {
      this.wavesurfer.playPause();
    }
  },

  zoomIn() {
    if (this.wavesurfer) {
      const currentZoom = this.wavesurfer.options.minPxPerSec || 50;
      this.wavesurfer.zoom(currentZoom * 1.5);
    }
  },

  zoomOut() {
    if (this.wavesurfer) {
      const currentZoom = this.wavesurfer.options.minPxPerSec || 50;
      this.wavesurfer.zoom(Math.max(1, currentZoom / 1.5));
    }
  },

  resetZoom() {
    if (this.wavesurfer) {
      this.wavesurfer.zoom(50);
    }
  },

  syncTime(time) {
    if (this.wavesurfer) {
      this.wavesurfer.seekTo(time / this.wavesurfer.getDuration());
    }
  },

  getDuration() {
    return this.wavesurfer ? this.wavesurfer.getDuration() : 0;
  },

  getCurrentTime() {
    return this.wavesurfer ? this.wavesurfer.getCurrentTime() : 0;
  },

  toggleVolume() {
    if (!this.wavesurfer) return;
    
    if (this.isMuted) {
      this.setVolume(this.currentVolume);
    } else {
      this.setVolume(0);
    }
    return !this.isMuted;
  },

  setVolume(value) {
    if (!this.wavesurfer) return;
    
    const clampedValue = Math.max(0, Math.min(1, value));
    this.wavesurfer.setVolume(clampedValue);
    this.currentVolume = clampedValue;
    this.isMuted = clampedValue === 0;
    
    const slider = document.getElementById('volumeSlider');
    const valueDisplay = document.getElementById('volumeValue');
    const icon = document.querySelector('.volume-icon');
    
    if (slider) {
      slider.value = Math.round(clampedValue * 100);
    }
    if (valueDisplay) {
      valueDisplay.textContent = `${Math.round(clampedValue * 100)}%`;
    }
    if (icon) {
      icon.textContent = this.isMuted ? '🔇' : (clampedValue < 0.5 ? '🔉' : '🔊');
    }
    
    console.log('[AudioManager] 音波音量:', Math.round(clampedValue * 100), '%');
  },

  initTimeline() {
    if (!this.wavesurfer) return;
    
    const duration = this.wavesurfer.getDuration();
    
    const totalTimeEl = document.getElementById('timelineTotalTime');
    if (totalTimeEl) {
      totalTimeEl.textContent = this.formatTime(duration, true);
    }
    
    const timelineProgress = document.querySelector('.timeline-progress');
    if (timelineProgress) {
      timelineProgress.addEventListener('click', (e) => {
        const rect = timelineProgress.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        this.timelineSeek(percent);
      });
      
      timelineProgress.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('timeline-handle') || 
            e.target.classList.contains('timeline-progress-bar')) {
          this._isDraggingTimeline = true;
        }
      });
    }
    
    const mouseMoveHandler = (e) => {
      if (!this._isDraggingTimeline) return;
      const timelineProgress = document.querySelector('.timeline-progress');
      if (!timelineProgress) return;
      
      const rect = timelineProgress.getBoundingClientRect();
      let percent = (e.clientX - rect.left) / rect.width;
      percent = Math.max(0, Math.min(1, percent));
      
      this.timelineSeek(percent);
    };
    
    const mouseUpHandler = () => {
      this._isDraggingTimeline = false;
    };
    
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
    
    this._timelineMouseMoveHandler = mouseMoveHandler;
    this._timelineMouseUpHandler = mouseUpHandler;
    
    this.updateTimelineLabels();
  },
  
  updateTimeline() {
    if (!this.wavesurfer) return;
    
    const currentTime = this.wavesurfer.getCurrentTime();
    const duration = this.wavesurfer.getDuration();
    
    if (duration <= 0) return;
    
    const percent = currentTime / duration;
    
    const progressBar = document.getElementById('timelineProgressBar');
    const handle = document.getElementById('timelineHandle');
    const currentTimeDisplay = document.getElementById('timelineCurrentTime');
    
    if (progressBar) {
      progressBar.style.width = `${percent * 100}%`;
    }
    
    if (handle) {
      handle.style.left = `${percent * 100}%`;
    }
    
    if (currentTimeDisplay) {
      currentTimeDisplay.textContent = this.formatTime(currentTime, true);
    }
    
    this.updateTimelineMarkers();
  },
  
  updateTimelineLabels() {
    if (!this.wavesurfer) return;
    
    const duration = this.wavesurfer.getDuration();
    const labelsContainer = document.getElementById('timelineLabels');
    
    if (!labelsContainer) return;
    
    let interval = 10;
    if (duration > 600) {
      interval = 30;
    } else if (duration > 120) {
      interval = 10;
    } else if (duration > 30) {
      interval = 5;
    } else {
      interval = 1;
    }
    
    const labels = [];
    for (let time = 0; time <= duration; time += interval) {
      const position = (time / duration) * 100;
      labels.push(`<span class="timeline-label" style="position: absolute; left: ${position}%; transform: translateX(-50%)">${this.formatTime(time)}</span>`);
    }
    
    labelsContainer.innerHTML = labels.join('');
  },
  
  updateTimelineMarkers() {
    if (!this.wavesurfer) return;
    
    const markersContainer = document.getElementById('timelineMarkers');
    if (!markersContainer) return;
    
    const duration = this.wavesurfer.getDuration();
    const regions = this.regionsPlugin && this.regionsPlugin.regions && this.regionsPlugin.regions.list ? 
      this.regionsPlugin.regions.list : [];
    const markers = [];
    
    regions.forEach((region) => {
      if (region && typeof region.start === 'number' && typeof region.end === 'number') {
        const startPosition = (region.start / duration) * 100;
        const endPosition = (region.end / duration) * 100;
        
        markers.push(`<div class="timeline-marker start" style="left: ${startPosition}%" title="开始: ${this.formatTime(region.start)}"></div>`);
        markers.push(`<div class="timeline-marker end" style="left: ${endPosition}%" title="结束: ${this.formatTime(region.end)}"></div>`);
      }
    });
    
    markersContainer.innerHTML = markers.join('');
  },
  
  timelineSeek(percent) {
    if (!this.wavesurfer) return;
    
    const duration = this.wavesurfer.getDuration();
    const time = percent * duration;
    
    this.wavesurfer.seekTo(percent);
    
    if (this.syncWithVideo && VibeSubtitles && VibeSubtitles.videoElement) {
      VibeSubtitles.videoElement.currentTime = time;
    }
    
    this.updateTimeline();
  },
  
  formatTime(seconds, showMs = false) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (showMs) {
      const ms = Math.floor((seconds % 1) * 100);
      if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
      }
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    }
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  },
  
  destroy() {
    if (this.wavesurfer) {
      this.wavesurfer.destroy();
      this.wavesurfer = null;
    }
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
    this.audioBlob = null;
    this.isWaveformReady = false;
    this.disableWaveformButtons();
    this._isDraggingTimeline = false;

    if (this._timelineMouseMoveHandler) {
      document.removeEventListener('mousemove', this._timelineMouseMoveHandler);
      this._timelineMouseMoveHandler = null;
    }
    if (this._timelineMouseUpHandler) {
      document.removeEventListener('mouseup', this._timelineMouseUpHandler);
      this._timelineMouseUpHandler = null;
    }

    const container = document.getElementById(this.waveformContainerId);
    if (container) {
      container.innerHTML = '';
    }
  }
};

window.VibeAudioManager = VibeAudioManager;

document.addEventListener('DOMContentLoaded', () => {
  VibeAudioManager.init();
});