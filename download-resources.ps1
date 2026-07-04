$baseDir = "./public"

Write-Host "========================================="
Write-Host "VibeTrans Static Resources Download Script"
Write-Host "========================================="
Write-Host ""

function Download-File {
    param(
        [string]$url,
        [string]$outputPath
    )
    
    Write-Host "Downloading: $url"
    
    try {
        Invoke-WebRequest -Uri $url -OutFile $outputPath -UseBasicParsing -TimeoutSec 120
        Write-Host "  OK"
        return $true
    } catch {
        Write-Host "  FAILED: $_"
        return $false
    }
}

function Test-FileExists {
    param([string]$path)
    if (Test-Path $path) {
        $size = (Get-Item $path).Length
        if ($size -gt 0) {
            Write-Host "  SKIP (already exists, $size bytes)"
            return $true
        }
    }
    return $false
}

Write-Host "[1/5] Downloading FFmpeg core files..."
$ffmpegDir = Join-Path $baseDir "ffmpeg"
if (-not (Test-Path $ffmpegDir)) { New-Item -ItemType Directory -Path $ffmpegDir -Force }

$ffmpegCoreVer = "0.12.10"
$ffmpegVer = "0.12.20"
$utilVer = "0.12.2"

$unpkgBase = "https://unpkg.com"
$cdnjsBase = "https://cdnjs.cloudflare.com/ajax/libs"

if (-not (Test-FileExists (Join-Path $ffmpegDir "ffmpeg-core.js"))) {
    $success = Download-File -url "$unpkgBase/@ffmpeg/core@$ffmpegCoreVer/dist/ffmpeg-core.js" -outputPath (Join-Path $ffmpegDir "ffmpeg-core.js")
    if (-not $success) {
        Download-File -url "$cdnjsBase/ffmpeg-core/$ffmpegCoreVer/umd/ffmpeg-core.js" -outputPath (Join-Path $ffmpegDir "ffmpeg-core.js")
    }
}
if (-not (Test-FileExists (Join-Path $ffmpegDir "ffmpeg-core.wasm"))) {
    $success = Download-File -url "$unpkgBase/@ffmpeg/core@$ffmpegCoreVer/dist/ffmpeg-core.wasm" -outputPath (Join-Path $ffmpegDir "ffmpeg-core.wasm")
    if (-not $success) {
        Download-File -url "$cdnjsBase/ffmpeg-core/$ffmpegCoreVer/umd/ffmpeg-core.wasm" -outputPath (Join-Path $ffmpegDir "ffmpeg-core.wasm")
    }
}
if (-not (Test-FileExists (Join-Path $ffmpegDir "ffmpeg-core.worker.js"))) {
    $success = Download-File -url "$unpkgBase/@ffmpeg/core@$ffmpegCoreVer/dist/ffmpeg-core.worker.js" -outputPath (Join-Path $ffmpegDir "ffmpeg-core.worker.js")
    if (-not $success) {
        Download-File -url "$cdnjsBase/ffmpeg-core/$ffmpegCoreVer/umd/ffmpeg-core.worker.js" -outputPath (Join-Path $ffmpegDir "ffmpeg-core.worker.js")
    }
}

Write-Host ""
Write-Host "[2/5] Downloading FFmpeg main library (ESM version)..."
if (-not (Test-FileExists (Join-Path $ffmpegDir "ffmpeg.esm.js"))) {
    Download-File -url "$unpkgBase/@ffmpeg/ffmpeg@$ffmpegVer/dist/esm/ffmpeg.js" -outputPath (Join-Path $ffmpegDir "ffmpeg.esm.js")
}
if (-not (Test-FileExists (Join-Path $ffmpegDir "util.esm.js"))) {
    Download-File -url "$unpkgBase/@ffmpeg/util@$utilVer/dist/esm/util.js" -outputPath (Join-Path $ffmpegDir "util.esm.js")
}

Write-Host ""
Write-Host "[3/5] Downloading Wavesurfer.js..."
$wavesurferDir = Join-Path $baseDir "wavesurfer"
if (-not (Test-Path $wavesurferDir)) { New-Item -ItemType Directory -Path $wavesurferDir -Force }

$wavesurferVer = "7.8.4"
if (-not (Test-FileExists (Join-Path $wavesurferDir "wavesurfer.esm.js"))) {
    Download-File -url "$unpkgBase/wavesurfer.js@$wavesurferVer/dist/wavesurfer.esm.js" -outputPath (Join-Path $wavesurferDir "wavesurfer.esm.js")
}
if (-not (Test-FileExists (Join-Path $wavesurferDir "regions.esm.js"))) {
    Download-File -url "$unpkgBase/wavesurfer.js@$wavesurferVer/dist/plugins/regions.esm.js" -outputPath (Join-Path $wavesurferDir "regions.esm.js")
}

Write-Host ""
Write-Host "[4/5] Downloading Vosk Browser..."
$voskDir = Join-Path $baseDir "vosk"
if (-not (Test-Path $voskDir)) { New-Item -ItemType Directory -Path $voskDir -Force }

$voskVer = "0.0.8"
if (-not (Test-FileExists (Join-Path $voskDir "vosk.js"))) {
    Download-File -url "$unpkgBase/vosk-browser@$voskVer/dist/vosk.js" -outputPath (Join-Path $voskDir "vosk.js")
}

Write-Host ""
Write-Host "[5/5] Downloading Transformers.js..."
$transformersDir = Join-Path $baseDir "transformers"
if (-not (Test-Path $transformersDir)) { New-Item -ItemType Directory -Path $transformersDir -Force }

$transformersVer = "2.17.1"
if (-not (Test-FileExists (Join-Path $transformersDir "transformers.min.js"))) {
    Download-File -url "$unpkgBase/@xenova/transformers@$transformersVer/dist/transformers.min.js" -outputPath (Join-Path $transformersDir "transformers.min.js")
}

Write-Host ""
Write-Host "========================================="
Write-Host "Core library files downloaded!"
Write-Host "========================================="
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Download Vosk models manually:"
Write-Host "   Chinese model (~1.3GB):"
Write-Host "   https://alphacephei.com/vosk/models/vosk-model-small-zh-cn-0.22.zip"
Write-Host "   Extract to: public/models/vosk/zh-cn/"
Write-Host ""
Write-Host "   English model (~350MB):"
Write-Host "   https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
Write-Host "   Extract to: public/models/vosk/en-us/"
Write-Host ""
Write-Host "2. Run download-model.ps1 to download models automatically."
Write-Host ""
Write-Host "Files downloaded:"
Get-ChildItem -Path $baseDir -Recurse -File | ForEach-Object {
    $size = [math]::Round($_.Length / 1024, 1)
    Write-Host "  $($_.FullName.Replace((Resolve-Path $baseDir).Path, '')) ($size KB)"
}
