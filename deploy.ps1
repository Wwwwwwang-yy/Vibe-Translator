# VibeTrans 一键部署脚本（PowerShell）
# 用法：
#   .\deploy.ps1 -Target vercel    # 部署到 Vercel
#   .\deploy.ps1 -Target render    # 部署到 Render
#   .\deploy.ps1 -Target local     # 本地启动
#   .\deploy.ps1 -Target docker    # 用 Docker 启动

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("vercel","render","local","docker")]
    [string]$Target = "local",

    [string]$RenderApiKey = "",
    [string]$VercelToken = ""
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $rootDir

function Write-Step($msg) { Write-Host "`n[*] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[X] $msg" -ForegroundColor Red }

# 1. 检查 .env 是否存在
Write-Step "检查 .env 配置"
if (-not (Test-Path ".env")) {
    Write-Warn2 ".env 不存在，从 .env.example 复制..."
    Copy-Item ".env.example" ".env"
    Write-Warn2 "请编辑 .env 填入 API 密钥后重新运行脚本"
    Write-Host "    notepad .env"
    exit 1
}
Write-Ok ".env 已存在"

# 2. 安装依赖
Write-Step "安装依赖"
if (-not (Test-Path "node_modules")) {
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Err "依赖安装失败"; exit 1 }
    Write-Ok "依赖安装完成"
} else {
    Write-Ok "node_modules 已存在，跳过"
}

# 3. 根据目标执行
switch ($Target) {
    "local" {
        Write-Step "本地启动"
        Write-Host "访问 http://localhost:3000"
        npm start
    }
    "vercel" {
        Write-Step "部署到 Vercel"
        # 检查 vercel CLI
        $vercel = Get-Command vercel -ErrorAction SilentlyContinue
        if (-not $vercel) {
            Write-Warn2 "未安装 vercel CLI，正在安装..."
            npm install -g vercel
            if ($LASTEXITCODE -ne 0) { Write-Err "vercel CLI 安装失败"; exit 1 }
        }
        if ($VercelToken) { $env:VERCEL_TOKEN = $VercelToken }
        # 部署
        vercel --prod --yes
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Vercel 部署完成"
            Write-Host "提示：在 Vercel 控制台设置环境变量（BAIDU_APP_ID 等）"
        } else {
            Write-Err "Vercel 部署失败"
            exit 1
        }
    }
    "render" {
        Write-Step "部署到 Render"
        # 检查 render CLI
        $render = Get-Command render -ErrorAction SilentlyContinue
        if (-not $render) {
            Write-Warn2 "未安装 render CLI，正在安装..."
            npm install -g @render-ecosystem/render-cli
        }
        if ($RenderApiKey) { $env:RENDER_API_KEY = $RenderApiKey }
        Write-Host "提示：使用 render.yaml 蓝图部署"
        Write-Host "  1. 推送代码到 GitHub/GitLab"
        Write-Host "  2. 在 Render 控制台选择 New > Blueprint"
        Write-Host "  3. 选择本仓库，Render 会自动读取 render.yaml"
        Write-Host "  4. 在 Render 控制台手动设置密钥环境变量"
        Write-Ok "render.yaml 已准备好，请按提示操作"
    }
    "docker" {
        Write-Step "Docker 部署"
        if (-not (Test-Path "Dockerfile")) {
            Write-Warn2 "Dockerfile 不存在，正在生成..."
            @"
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server/server.js"]
"@ | Out-File -FilePath "Dockerfile" -Encoding utf8
        }
        docker build -t vibetrans .
        if ($LASTEXITCODE -ne 0) { Write-Err "Docker 构建失败"; exit 1 }
        Write-Host "启动容器（端口 3000）..."
        docker run -d --name vibetrans -p 3000:3000 --env-file .env vibetrans
        Write-Ok "Docker 启动完成，访问 http://localhost:3000"
    }
}

Write-Step "完成"
Write-Host "VibeTrans 部署文档：" -ForegroundColor Cyan
Write-Host "  - Vercel: https://vercel.com/docs" -ForegroundColor Gray
Write-Host "  - Render: https://render.com/docs/blueprint-spec" -ForegroundColor Gray
Write-Host "  - 本地: http://localhost:3000" -ForegroundColor Gray
