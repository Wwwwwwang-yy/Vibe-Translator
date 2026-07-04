require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.static(path.join(__dirname, '..'), {
  maxAge: '0',
  etag: false
}));

app.use('/api/subtitle', require('./routes/subtitle'));
app.use('/api/translate', require('./routes/translate'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 公共配置端点：仅返回前端可安全读取的配置（不包含密钥）
app.get('/api/config', (req, res) => {
  res.json({
    apiBaseUrl: process.env.PUBLIC_API_BASE_URL || `http://localhost:${port}`,
    whisperModel: process.env.PUBLIC_WHISPER_MODEL || 'Xenova/whisper-tiny',
    whisperCdn: process.env.PUBLIC_WHISPER_CDN || 'https://cdn.jsdelivr.net/npm',
    voskCdn: process.env.PUBLIC_VOSK_CDN || 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist',
    defaultTranslator: process.env.DEFAULT_TRANSLATOR || 'mymemory',
    defaultSourceLang: process.env.DEFAULT_SOURCE_LANG || 'en',
    defaultTargetLang: process.env.DEFAULT_TARGET_LANG || 'zh'
  });
});

app.listen(port, () => {
  console.log(`VibeTrans Server running on http://localhost:${port}`);
});