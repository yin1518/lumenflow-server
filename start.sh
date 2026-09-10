#!/bin/bash
# LumenFlow 云端同步服务 - 一键启动脚本
# 适用于 Ubuntu 22.04 / CentOS 7+ / Debian 11+

echo "========================================"
echo "  LumenFlow 云端同步服务 - 启动脚本"
echo "========================================"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[1/4] 未检测到 Node.js，正在安装..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "[1/4] Node.js 已安装: $(node -v)"
fi

# 安装依赖
echo "[2/4] 安装项目依赖..."
npm install --production

# 开放防火墙端口（Ubuntu ufw）
if command -v ufw &> /dev/null; then
    echo "[3/4] 开放防火墙端口 3000..."
    ufw allow 3000/tcp 2>/dev/null || true
fi

# 启动服务
echo "[4/4] 启动服务..."
echo ""
echo "服务启动成功！"
echo "  本地访问: http://localhost:3000/api/health"
echo "  外网访问: http://你的服务器公网IP:3000/api/health"
echo ""
echo "后台运行命令: nohup node server.js > lumenflow.log 2>&1 &"
echo "查看日志: tail -f lumenflow.log"
echo ""

node server.js
