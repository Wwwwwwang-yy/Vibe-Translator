const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = process.env.UPLOAD_DIR || 'uploads/segments';

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024
  }
});

async function cleanupFiles(filePaths) {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.warn('[Cleanup] Failed to delete:', filePath, error.message);
    }
  }
}

// 仅切割音频，不进行识别（供前端降级方案使用）
router.post('/cut-audio', upload.single('video'), async (req, res) => {
  const startTime = parseFloat(req.body.startTime);
  const endTime = parseFloat(req.body.endTime);
  const filesToCleanup = [];
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: '必须提供视频文件' });
    }
    
    if (isNaN(startTime) || isNaN(endTime)) {
      return res.status(400).json({ error: 'startTime 和 endTime 必须是数字' });
    }
    
    if (endTime <= startTime) {
      return res.status(400).json({ error: '结束时间必须大于开始时间' });
    }
    
    const videoFile = req.file;
    filesToCleanup.push(videoFile.path);
    
    console.log('[CutAudio] Video file received:', videoFile.originalname, videoFile.size, 'bytes');
    
    try {
      const ffmpeg = require('fluent-ffmpeg');
      
      const audioOutputPath = path.join(uploadDir, `audio-${Date.now()}.wav`);
      filesToCleanup.push(audioOutputPath);
      
      await new Promise((resolve, reject) => {
        ffmpeg(videoFile.path)
          .setStartTime(startTime)
          .setDuration(endTime - startTime)
          .audioFrequency(16000)
          .audioChannels(1)
          .format('wav')
          .on('end', resolve)
          .on('error', reject)
          .save(audioOutputPath);
      });
      
      const audioBuffer = fs.readFileSync(audioOutputPath);
      const audioBase64 = 'data:audio/wav;base64,' + audioBuffer.toString('base64');
      
      console.log('[CutAudio] 切割成功，音频大小:', audioBuffer.length, 'bytes');
      
      res.json({ audioBase64: audioBase64 });
      
    } catch (ffmpegError) {
      console.error('[CutAudio] FFmpeg error:', ffmpegError.message);
      return res.status(500).json({ error: 'FFmpeg 不可用，请确保已安装' });
    }
    
  } catch (error) {
    console.error('[CutAudio] Error:', error);
    res.status(500).json({ error: error.message });
    
  } finally {
    await cleanupFiles(filesToCleanup);
  }
});

// 保留原有的识别接口（兼容旧版），但返回错误提示使用前端识别
router.post('/recognize-segment', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'audio', maxCount: 1 }
]), async (req, res) => {
  res.status(400).json({ error: '该接口已停用，请使用前端语音识别功能' });
});

module.exports = router;