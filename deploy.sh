#!/bin/bash
# VibeTrans 一键部署脚本（Bash）
# 用法：
#   ./deploy.sh vercel    # 部署到 Vercel
#   ./deploy.sh render    # 部署到 Render
#   ./deploy.sh local     # 本地启动
#   ./deploy.sh docker     # 用 Docker 启动

set -e

TARGET="${1:-local}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# 颜色输出
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step()   { echo -e "\n${CYAN}[*] $1${NC}"; }
ok()     { echo -e "${GREEN}[OK] $1${NC}"; }
warn()   { echo -e "${YELLOW}[!] $1${NC}"; }
err()    { echo -e "${RED}[X] $1${NC}"; exit 1; }

# 1. 检查 .env
step "检查 .env 配置"
if [ ! -f ".env" ]; then
    warn ".env 不存在，从 .env.example 复制..."
    cp .env.example .env
    warn "请编辑 .env 填入 API 密钥后重新运行脚本"
    echo "    nano .env"
    exit 1
fi
ok ".env 已存在"

# 2. 安装依赖
step "安装依赖"
if [ ! -d "node_modules" ]; then
    npm install || err "依赖安装失败"
    ok "依赖安装完成"
else
    ok "node_modules 已存在，跳过"
fi

# 3. 根据目标执行
case "$TARGET" in
    local)
        step "本地启动"
        echo "访问 http://localhost:3000"
        npm start
        ;;
    vercel)
        step "部署到 Vercel"
        if ! command -v vercel &> /dev/null; then
            warn "未安装 vercel CLI，正在安装..."
            npm install -g vercel || err "vercel CLI 安装失败"
        fi
        vercel --prod --yes
        if [ $? -eq 0 ]; then
            ok "Vercel 部署完成"
            echo "提示：在 Vercel 控制台设置环境变量（BAIDU_APP_ID 等）"
        else
            err "Vercel 部署失败"
        fi
        ;;
    render)
        step "部署到 Render"
        echo "提示：使用 render.yaml 蓝图部署"
        echo "  1. 推送代码到 GitHub/GitLab"
        echo "  2. 在 Render 控制台选择 New > Blueprint"
        echo "  3. 选择本仓库，Render 会自动读取 render.yaml"
        echo "  4. 在 Render 控制台手动设置密钥环境变量"
        ok "render.yaml 已准备好，请按提示操作"
        ;;
    docker)
        step "Docker 部署"
        if [ ! -f "Dockerfile" ]; then
            warn "Dockerfile 不存在，正在生成..."
            cat > Dockerfile <<'DOCKERFILE'
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server/server.js"]
DOCKERFILE
        fi
        docker build -t vibetrans . || err "Docker 构建失败"
        echo "启动容器（端口 3000）..."
        docker run -d --name vibetrans -p 3000:3000 --env-file .env vibetrans
        ok "Docker 启动完成，访问 http://localhost:3000"
        ;;
    *)
        err "未知目标：$TARGET（可选：vercel | render | local | docker）"
        ;;
esac

step "完成"
echo -e "${CYAN}VibeTrans 部署文档：${NC}"
echo "  - Vercel: https://vercel.com/docs"
echo "  - Render: https://render.com/docs/blueprint-spec"
echo "  - 本地: http://localhost:3000"
