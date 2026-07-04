$baseDir = "./public/models"

function Create-Directory {
    param([string]$path)
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
        Write-Host "Created directory: $path"
    }
}

Create-Directory (Join-Path $baseDir "vosk")

$models = @(
    @{
        Name = "vosk-model-small-cn-0.22"
        Url = "https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip"
        OutputDir = "zh-cn"
    },
    @{
        Name = "vosk-model-small-en-us-0.15"
        Url = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
        OutputDir = "en-us"
    }
)

foreach ($model in $models) {
    Write-Host ""
    Write-Host "Downloading $($model.Name)..."
    
    $zipPath = Join-Path $baseDir "vosk\$($model.Name).zip"
    $extractDir = Join-Path $baseDir "vosk\$($model.OutputDir)"
    
    if (-not (Test-Path $zipPath)) {
        Write-Host "  Downloading from: $($model.Url)"
        try {
            Invoke-WebRequest -Uri $model.Url -OutFile $zipPath -UseBasicParsing -TimeoutSec 300
            Write-Host "  Download completed"
        } catch {
            Write-Host "  Download FAILED: $_"
            continue
        }
    } else {
        Write-Host "  Zip file already exists"
    }
    
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
            Write-Host "  Already extracted"
        }
    }
}

Write-Host ""
Write-Host "Done!"
