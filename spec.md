# 修复模型下载地址 Spec

## Why
当前配置的Vosk和Whisper模型下载地址返回404错误，导致用户无法下载离线语音识别模型，无法使用离线语音识别功能。

## What Changes
- 修复Vosk模型的下载地址，使用官方可用的CDN地址
- 修复Whisper模型的下载地址，使用可用的镜像地址
- 优化错误提示，当所有下载源都失败时提供明确的解决方案

## Impact
- Affected specs: 语音识别离线模型下载功能
- Affected code: `js/model-cache.js`

## ADDED Requirements

### Requirement: 正确的模型下载地址
系统应提供真实可用的模型下载地址，所有配置的下载源必须经过验证可访问。

#### Scenario: Vosk模型下载成功
- **WHEN** 用户点击下载Vosk中文模型
- **THEN** 系统从有效的下载源开始下载，进度条显示真实进度
- **AND** 下载完成后模型成功缓存到IndexedDB

#### Scenario: Whisper模型下载成功
- **WHEN** 用户点击下载Whisper Base模型
- **THEN** 系统从有效的下载源开始下载，进度条显示真实进度
- **AND** 下载完成后模型成功缓存到IndexedDB

### Requirement: 下载源优先级配置
系统应按以下优先级尝试下载源：
1. 国内CDN镜像（jsDelivr/ghproxy等）
2. HuggingFace镜像（hf-mirror.com）
3. 官方源

## MODIFIED Requirements

### Requirement: Vosk模型地址配置
Vosk模型应使用以下经过验证的地址：

| 语言 | 模型ID | 主源地址 | 备源地址 |
|------|--------|----------|----------|
| 中文 | vosk-model-small-cn-0.22 | `https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip` | 官方源 |
| 英语 | vosk-model-small-en-us-0.15 | `https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip` | 官方源 |
| 日语 | vosk-model-small-ja-0.22 | `https://alphacephei.com/vosk/models/vosk-model-small-ja-0.22.zip` | 官方源 |
| 韩语 | vosk-model-small-ko-0.22 | `https://alphacephei.com/vosk/models/vosk-model-small-ko-0.22.zip` | 官方源 |

### Requirement: Whisper模型地址配置
Whisper模型应使用Transformers.js的在线加载方式，而非直接下载.bin文件：

| 模型 | 加载方式 | 模型名称 |
|------|----------|----------|
| Tiny | Transformers.js pipeline | `Xenova/whisper-tiny` |
| Base | Transformers.js pipeline | `Xenova/whisper-base` |
| Small | Transformers.js pipeline | `Xenova/whisper-small` |

**说明**: Whisper模型通过Transformers.js库自动从Hugging Face下载并缓存到浏览器，无需手动配置.bin文件下载地址。

## REMOVED Requirements

### Requirement: 无效的jsDelivr镜像地址
**Reason**: jsDelivr镜像地址配置错误（`/gh/alphacep/xxx`路径不存在），导致404错误
**Migration**: 改用官方alphacephei.com地址，该地址国内可正常访问

### Requirement: 无效的Whisper .bin文件下载
**Reason**: hf-mirror.com上的ggml-tiny.bin等文件链接不稳定，且jsDelivr上的地址不存在
**Migration**: 使用Transformers.js内置的模型加载机制，自动从Hugging Face CDN下载