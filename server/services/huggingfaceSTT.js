const axios = require('axios');

class HuggingFaceSTT {
  constructor() {
    this.apiUrl = 'https://api-inference.huggingface.co/models/openai/whisper-small';
    this.apiToken = process.env.HF_API_TOKEN;
    
    if (!this.apiToken) {
      console.warn('[HuggingFaceSTT] HF_API_TOKEN not set, will use public API');
    }
  }
  
  async transcribeAudio(audioBuffer, language = 'zh') {
    try {
      const headers = {
        'Authorization': this.apiToken ? `Bearer ${this.apiToken}` : `Bearer `,
        'Content-Type': 'audio/wav'
      };
      
      const params = {
        language: language,
        task: 'transcribe'
      };
      
      console.log('[HuggingFaceSTT] Sending request to API...');
      console.log('[HuggingFaceSTT] Audio buffer size:', audioBuffer.length, 'bytes');
      
      const response = await axios.post(
        this.apiUrl,
        audioBuffer,
        {
          headers: headers,
          params: params,
          timeout: 60000
        }
      );
      
      console.log('[HuggingFaceSTT] Response received:', response.status);
      console.log('[HuggingFaceSTT] Response data:', JSON.stringify(response.data));
      
      if (response.data && response.data.text) {
        return response.data.text.trim();
      }
      
      if (response.data && response.data.error) {
        throw new Error(response.data.error);
      }
      
      throw new Error('No text returned from API');
      
    } catch (error) {
      console.error('[HuggingFaceSTT] Transcription error:', error.message);
      console.error('[HuggingFaceSTT] Error details:', error.response?.data || error.code);
      
      if (error.response) {
        console.error('[HuggingFaceSTT] API response status:', error.response.status);
        console.error('[HuggingFaceSTT] API response data:', JSON.stringify(error.response.data));
        
        if (error.response.status === 401) {
          throw new Error('API Token无效或已过期，请检查.env文件中的HF_API_TOKEN配置');
        } else if (error.response.status === 403) {
          throw new Error('API访问被拒绝，请检查HF_API_TOKEN权限');
        } else if (error.response.status === 503) {
          throw new Error('模型正在加载中，请等待几秒后重试');
        } else if (error.response.data && error.response.data.error) {
          throw new Error(error.response.data.error);
        }
      }
      
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('无法连接到语音识别服务，请检查网络连接');
      }
      
      throw new Error('语音识别失败: ' + (error.response?.data?.error || error.message));
    }
  }
}

module.exports = new HuggingFaceSTT();
