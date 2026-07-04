/**
 * 统一翻译服务
 * 优先调用 MyMemory 免费API，失败时降级到 LibreTranslate 兜底
 * 两个API均无需密钥，完全免费
 *
 * 注意：MyMemory 和 LibreTranslate 均为海外服务，
 * 若部署在国内服务器访问慢，可考虑使用阿里云/百度翻译免费额度。
 */
const axios = require('axios');

// 语言代码映射
const LANG_MAP = {
  'zh': 'zh-CN',
  'en': 'en-US',
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
 * 调用 MyMemory 翻译
 * GET https://api.mymemory.translated.net/get
 */
async function translateWithMyMemory(text, from, to) {
  const sourceLang = LANG_MAP[from] || from;
  const targetLang = LANG_MAP[to] || to;
  const langpair = `${sourceLang}|${targetLang}`;

  const response = await axios.get('https://api.mymemory.translated.net/get', {
    params: { q: text, langpair },
    timeout: 15000
  });

  const data = response.data;

  if (data.responseStatus !== 200 || !data.responseData) {
    throw new Error(`MyMemory 返回异常: ${data.responseDetails || data.responseStatus}`);
  }

  return data.responseData.translatedText;
}

/**
 * 调用 LibreTranslate 兜底翻译
 * POST https://libretranslate.com/translate
 */
async function translateWithLibreTranslate(text, from, to) {
  const endpoints = [
    'https://libretranslate.com/translate',
    'https://translate.argosopentech.com/translate'
  ];

  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await axios.post(
        endpoint,
        { q: text, source: from, target: to, format: 'text' },
        { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
      );

      if (response.data && response.data.translatedText) {
        return response.data.translatedText;
      }
      lastError = new Error('LibreTranslate 返回空结果');
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('LibreTranslate 所有端点均不可用');
}

/**
 * 统一翻译入口
 * @param {string} text - 待翻译文本
 * @param {string} sourceLang - 源语言代码（zh/en/ja...）
 * @param {string} targetLang - 目标语言代码
 * @returns {Promise<string>} 翻译结果
 */
async function translate(text, sourceLang, targetLang) {
  // 1. 优先 MyMemory
  try {
    return await translateWithMyMemory(text, sourceLang, targetLang);
  } catch (err) {
    console.warn('[Translator] MyMemory 失败，降级到 LibreTranslate:', err.message);
  }

  // 2. 降级 LibreTranslate
  try {
    return await translateWithLibreTranslate(text, sourceLang, targetLang);
  } catch (err) {
    console.error('[Translator] LibreTranslate 也失败:', err.message);
  }

  // 3. 两个都不可用
  throw new Error('暂无可用免费翻译服务，请稍后重试');
}

module.exports = { translate };
