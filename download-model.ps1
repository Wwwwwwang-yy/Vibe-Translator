$baseDir = "./public/models"

function Download-File {
    param([string]$url, [string]$outputPath)
    
    if (Test-Path $outputPath) {
        Write-Host "  Already exists, skipping..."
        return $true
    }
    
    Write-Host "  Downloading: $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $outputPath -UseBasicParsing
        Write-Host "  OK"
        return $true
    } catch {
        Write-Host "  FAILED: $_"
        return $false
    }
}

function Create-Directory {
    param([string]$path)
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
        Write-Host "Created directory: $path"
    }
}

Write-Host "=========================================="
Write-Host "  VibeTrans Model Download Script"
Write-Host "=========================================="

Create-Directory (Join-Path $baseDir "vosk")
Create-Directory (Join-Path $baseDir "whisper")

Write-Host ""
Write-Host "[1] Downloading Vosk Models..."
Write-Host ""

$voskModels = @(
    @{
        Name = "vosk-model-small-cn-0.22"
        Url = "https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip"
        OutputDir = "zh-cn"
    },
    @{
        Name = "vosk-model-small-en-us-0.15"
        Url = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
        OutputDir = "en-us"
    },
    @{
        Name = "vosk-model-small-ja-0.22"
        Url = "https://alphacephei.com/vosk/models/vosk-model-small-ja-0.22.zip"
        OutputDir = "ja"
    },
    @{
        Name = "vosk-model-small-ko-0.22"
        Url = "https://alphacephei.com/vosk/models/vosk-model-small-ko-0.22.zip"
        OutputDir = "ko"
    }
)

foreach ($model in $voskModels) {
    Write-Host ""
    Write-Host "Downloading $($model.Name)..."
    
    $zipPath = Join-Path $baseDir "vosk\$($model.Name).zip"
    $extractDir = Join-Path $baseDir "vosk\$($model.OutputDir)"
    
    Download-File -url $model.Url -outputPath $zipPath
    
    if (Test-Path $zipPath) {
        if (-not (Test-Path $extractDir)) {
            Write-Host "  Extracting..."
            try {
                Expand-Archive -Path $zipPath -DestinationPath (Join-Path $baseDir "vosk") -Force
                Rename-Item -Path (Join-Path $baseDir "vosk\$($model.Name)") -NewName $model.OutputDir -Force
                Write-Host "  Extracted to: $extractDir"
            } catch {
                Write-Host "  Extraction FAILED: $_"
            }
        } else {
            Write-Host "  Already extracted, skipping..."
        }
    }
}

Write-Host ""
Write-Host "[2] Downloading Whisper Models..."
Write-Host ""

$whisperModels = @(
    @{
        Name = "whisper-base"
        Url = "https://huggingface.co/Xenova/whisper-base/resolve/main/"
        Files = @("config.json", "preprocessor_config.json", "pytorch_model.bin")
    },
    @{
        Name = "whisper-tiny"
        Url = "https://huggingface.co/Xenova/whisper-tiny/resolve/main/"
        Files = @("config.json", "preprocessor_config.json", "pytorch_model.bin")
    },
    @{
        Name = "whisper-small"
        Url = "https://huggingface.co/Xenova/whisper-small/resolve/main/"
        Files = @("config.json", "preprocessor_config.json", "pytorch_model.bin")
    }
)

foreach ($model in $whisperModels) {
    Write-Host ""
    Write-Host "Downloading $($model.Name)..."
    
    $modelDir = Join-Path $baseDir "whisper\$($model.Name)"
    Create-Directory $modelDir
    
    foreach ($file in $model.Files) {
        $fileUrl = $model.Url + $file
        $outputPath = Join-Path $modelDir $file
        Download-File -url $fileUrl -outputPath $outputPath
    }
}

Write-Host ""
Write-Host "=========================================="
Write-Host "  Download Complete!"
Write-Host "=========================================="
Write-Host ""
Write-Host "Models are now in:"
Write-Host "  - Vosk: $baseDir/vosk/"
Write-Host "  - Whisper: $baseDir/whisper/"
Write-Host ""
Write-Host "Note: Whisper models require Transformers.js to load."
Write-Host "Run the web app and select the model, it will be cached locally."