/**
 * MyMemory 免费翻译引擎
 * 无需密钥，每天 5000 字符，国内大部分网络可直连
 * 文档：https://mymemory.translated.net/doc/spec.php
 */
const axios = require('axios');

// 通用语言代码 -> MyMemory 语言对映射
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
 * @param {string} text - 待翻译文本
 * @param {string} from - 源语言代码（zh/en/ja...）
 * @param {string} to - 目标语言代码
 * @returns {Promise<{translatedText: string, match: boolean}>}
 */
async function translate(text, from, to) {
  const sourceLang = LANG_MAP[from] || from;
  const targetLang = LANG_MAP[to] || to;
  const langpair = `${sourceLang}|${targetLang}`;

  const response = await axios.get('https://api.mymemory.translated.net/get', {
    params: {
      q: text,
      langpair: langpair
    },
    timeout: 15000
  });

  const data = response.data;

  if (data.responseStatus !== 200 || !data.responseData) {
    throw new Error(`MyMemory 返回异常: ${data.responseDetails || data.responseStatus}`);
  }

  const translatedText = data.responseData.translatedText;

  // match 标识是否命中记忆库（MyMemory 自带的翻译记忆）
  const match = !!(data.matches && data.matches.length > 0 && data.matches[0].match >= 90);

  return { translatedText, match };
}

module.exports = { translate };
