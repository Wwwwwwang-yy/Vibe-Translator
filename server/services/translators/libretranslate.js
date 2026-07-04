/**
 * LibreTranslate 兜底免费翻译引擎
 * 作为 MyMemory 失败时的备用方案，无需密钥
 * 注意：公共端点有速率限制，仅作兜底使用
 */
const axios = require('axios');

// LibreTranslate 语言代码与通用代码基本一致
const LANG_MAP = {
  'zh': 'zh',
  'en': 'en',
  'ja': 'ja',
  'ko': 'ko',
  'fr': 'fr',
  'de': 'de',
  'es': 'es',
  'ru': 'ru',
  'pt': 'pt',
  'it': 'it'
};

/**
 * 调用 LibreTranslate 翻译
 * @param {string} text - 待翻译文本
 * @param {string} from - 源语言代码
 * @param {string} to - 目标语言代码
 * @returns {Promise<{translatedText: string, match: boolean}>}
 */
async function translate(text, from, to) {
  const sourceLang = LANG_MAP[from] || from;
  const targetLang = LANG_MAP[to] || to;

  // 公共端点列表，按优先级尝试
  const endpoints = [
    'https://libretranslate.com/translate',
    'https://translate.argosopentech.com/translate'
  ];

  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await axios.post(
        endpoint,
        {
          q: text,
          source: sourceLang,
          target: targetLang,
          format: 'text'
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000
        }
      );

      const data = response.data;

      if (data && data.translatedText) {
        return { translatedText: data.translatedText, match: false };
      }

      lastError = new Error('LibreTranslate 返回空结果');
    } catch (error) {
      lastError = error;
      // 继续尝试下一个端点
    }
  }

  throw lastError || new Error('LibreTranslate 所有端点均不可用');
}

module.exports = { translate };
