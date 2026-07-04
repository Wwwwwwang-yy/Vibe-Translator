/**
 * 百度翻译引擎
 * 需要用户提供 APP ID 与密钥（在百度翻译开放平台免费创建应用获取）
 * 文档：https://fanyi-api.baidu.com/doc/21
 */
const axios = require('axios');
const crypto = require('crypto');

// 通用语言代码 -> 百度语言代码映射
// 百度大部分与通用代码一致，仅个别需调整
const LANG_MAP = {
  'zh': 'zh',
  'en': 'en',
  'ja': 'jp',
  'ko': 'kor',
  'fr': 'fra',
  'de': 'de',
  'es': 'spa',
  'ru': 'ru',
  'pt': 'pt',
  'it': 'it'
};

/**
 * 生成百度翻译签名
 * sign = md5(appid + q + salt + key)
 */
function makeSign(appId, query, salt, key) {
  const raw = appId + query + salt + key;
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex');
}

/**
 * 调用百度翻译
 * @param {string} text - 待翻译文本
 * @param {string} from - 源语言代码（zh/en/ja...）
 * @param {string} to - 目标语言代码
 * @param {string} appId - 百度翻译 APP ID
 * @param {string} key - 百度翻译密钥
 * @returns {Promise<{translatedText: string, match: boolean}>}
 */
async function translate(text, from, to, appId, key) {
  if (!appId || !key) {
    throw new Error('缺少百度翻译 APP ID 或密钥');
  }

  const sourceLang = LANG_MAP[from] || from;
  const targetLang = LANG_MAP[to] || to;
  const salt = String(Date.now());
  const sign = makeSign(appId, text, salt, key);

  const response = await axios.post(
    'https://fanyi-api.baidu.com/api/trans/vip/translate',
    null,
    {
      params: {
        q: text,
        from: sourceLang,
        to: targetLang,
        appid: appId,
        salt: salt,
        sign: sign
      },
      timeout: 15000
    }
  );

  const data = response.data;

  if (data.error_code) {
    throw new Error(`百度翻译错误[${data.error_code}]: ${data.error_msg}`);
  }

  if (!data.trans_result || data.trans_result.length === 0) {
    throw new Error('百度翻译返回空结果');
  }

  // 百度返回的是分段数组，按换行拼接
  const translatedText = data.trans_result.map(item => item.dst).join('\n');

  return { translatedText, match: false };
}

module.exports = { translate };
