/**
 * 翻译路由
 * POST /api/translate  使用免费翻译引擎（MyMemory + LibreTranslate兜底）
 * 无需任何API密钥，零配置运行
 */
const express = require('express');
const router = express.Router();
const translator = require('../services/translator');

/**
 * POST /api/translate
 * 请求体：{ sourceText, sourceLang, targetLang }
 * 响应：{ translatedText, engine }
 */
router.post('/', async (req, res) => {
  try {
    const { sourceText, sourceLang, targetLang } = req.body;

    if (!sourceText || !sourceText.trim()) {
      return res.status(400).json({ error: '请提供待翻译文本' });
    }
    if (!sourceLang || !targetLang) {
      return res.status(400).json({ error: '请指定源语言和目标语言' });
    }

    const translatedText = await translator.translate(sourceText, sourceLang, targetLang);

    res.json({ translatedText, engine: 'free' });
  } catch (error) {
    console.error('[Translate] error:', error.message);
    res.status(500).json({
      error: error.message || '翻译失败',
      translatedText: null
    });
  }
});

module.exports = router;
