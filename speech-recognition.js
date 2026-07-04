const VibeSpeechRecognition = {
  CONFIG_KEY: 'asr.serviceType',

  async init() {
    console.log('[ASR] Voice recognition services have been removed. Only audio extraction is available.');
  },

  async recognize(audioBlob, language, onProgress) {
    console.warn('[ASR] Voice recognition has been removed. Please transcribe manually or use external tools.');
    throw new Error('语音识别功能已移除，请手动添加字幕');
  },

  async extractAudio(videoFile) {
    if (VibeAudioManager) {
      return await VibeAudioManager.extractAudio(videoFile);
    }
    throw new Error('音频管理器未初始化');
  }
};

window.VibeSpeechRecognition = VibeSpeechRecognition;