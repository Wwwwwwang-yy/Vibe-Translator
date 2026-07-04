# Tasks

- [x] Task 1: 修复Vosk模型下载地址
  - [x] SubTask 1.1: 移除无效的jsDelivr镜像地址
  - [x] SubTask 1.2: 配置正确的官方alphacephei.com地址
  - [x] SubTask 1.3: 保持ghproxy镜像作为备用源（如可用）
  - [ ] SubTask 1.4: 测试验证下载地址可访问

- [x] Task 2: 修复Whisper模型加载方式
  - [x] SubTask 2.1: 移除无效的.bin文件下载地址配置
  - [x] SubTask 2.2: 使用Transformers.js内置模型加载
  - [x] SubTask 2.3: 更新模型列表显示，标注为"在线加载"

- [x] Task 3: 更新settings.js模型列表渲染
  - [x] SubTask 3.1: Vosk模型显示真实下载按钮
  - [x] SubTask 3.2: Whisper模型显示"在线加载"状态
  - [x] SubTask 3.3: 移除Whisper模型的本地导入按钮（改为在线加载）

- [x] Task 4: 更新speech-recognition.js Whisper实现
  - [x] SubTask 4.1: 使用Transformers.js pipeline加载模型
  - [x] SubTask 4.2: 模型自动缓存到浏览器Cache API
  - [x] SubTask 4.3: 首次加载显示进度提示
  - [x] SubTask 4.4: 移除对IndexedDB缓存检查的逻辑

# Task Dependencies
- Task 2 依赖 Task 1 完成（统一模型管理逻辑）
- Task 3 依赖 Task 1 和 Task 2 完成
- Task 4 依赖 Task 2 完成