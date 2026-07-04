const axios = require('axios');

class BaiduSpeech {
  constructor() {
    this.apiKey = process.env.BAIDU_SPEECH_API_KEY;
    this.secretKey = process.env.BAIDU_SPEECH_SECRET_KEY;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.tokenUrl = 'https://aip.baidubce.com/oauth/2.0/token';
    this.recognizeUrl = 'https://vop.baidu.com/server_api';
  }

  async getAccessToken() {
    if (!this.apiKey || !this.secretKey) {
      throw new Error('请配置 BAIDU_SPEECH_API_KEY 和 BAIDU_SPEECH_SECRET_KEY');
    }

    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    console.log('[BaiduSpeech] 获取 Access Token...');

    try {
      const response = await axios.post(this.tokenUrl, null, {
        params: {
          grant_type: 'client_credentials',
          client_id: this.apiKey,
          client_secret: this.secretKey
        }
      });

      if (response.data.access_token) {
        this.token = response.data.access_token;
        this.tokenExpiresAt = Date.now() + (response.data.expires_in - 60) * 1000;
        console.log('[BaiduSpeech] Token 获取成功，有效期:', response.data.expires_in, '秒');
        return this.token;
      }

      throw new Error('获取 Token 失败: ' + JSON.stringify(response.data));

    } catch (error) {
      console.error('[BaiduSpeech] 获取 Token 错误:', error.message);
      throw new Error('获取百度语音 Token 失败: ' + error.message);
    }
  }

  async transcribeAudio(audioBuffer) {
    const token = await this.getAccessToken();
    
    console.log('[BaiduSpeech] 开始语音识别...');
    console.log('[BaiduSpeech] 音频数据大小:', audioBuffer.length, 'bytes');

    const base64Audio = audioBuffer.toString('base64');

    try {
      const response = await axios.post(this.recognizeUrl, {
        format: 'wav',
        rate: 16000,
        channel: 1,
        len: audioBuffer.length,
        speech: base64Audio,
        token: token,
        cuid: 'vibe-trans',
        lan: 'zh'
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log('[BaiduSpeech] 识别响应:', JSON.stringify(response.data));

      if (response.data.err_no === 0) {
        const result = response.data.result.join('');
        console.log('[BaiduSpeech] 识别成功:', result);
        return result;
      }

      const errorMap = {
        3301: '音频格式错误',
        3302: '音频编码错误',
        3303: '语音过长',
        3304: '语音数据为空',
        3305: '采样率错误',
        3307: '识别服务异常',
        3308: '音频数据过大',
        3309: '鉴权失败',
        3310: '不支持的语言',
        3311: '服务端忙',
        5000: '未知错误'
      };

      const errorMsg = errorMap[response.data.err_no] || response.data.err_msg || '识别失败';
      throw new Error(`百度语音识别失败 [${response.data.err_no}]: ${errorMsg}`);

    } catch (error) {
      console.error('[BaiduSpeech] 识别错误:', error.message);
      
      if (error.response && error.response.data) {
        console.error('[BaiduSpeech] 响应数据:', JSON.stringify(error.response.data));
      }
      
      throw new Error('语音识别失败: ' + error.message);
    }
  }
}

module.exports = new BaiduSpeech();