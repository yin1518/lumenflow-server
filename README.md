# LumenFlow 云端同步后端服务

## 简介
LumenFlow照明工程管理系统的云端同步后端，支持多用户注册登录、数据云端上传下载，实现多设备数据同步。

## 技术栈
- Node.js + Express
- 数据库：**SQLite / PostgreSQL 双模式**（自动检测）
  - 设置环境变量 `DATABASE_URL` → 使用 PostgreSQL（推荐 Render/Supabase 部署）
  - 未设置 → 使用本地 SQLite（适合自建服务器）
- 密码 SHA256 加密，Token AES 加密（30天有效期）

## 功能
- 用户注册 / 登录
- 数据上传到云端（项目、任务、灯具、活动记录）
- 从云端下载数据
- Token认证（30天有效期）
- CORS跨域支持

## API接口

### 健康检查
`GET /api/health`

### 注册
`POST /api/register`
```json
{ "username": "test", "email": "test@example.com", "password": "123456" }
```

### 登录
`POST /api/login`
```json
{ "username": "test", "password": "123456" }
```

### 上传数据（需登录）
`POST /api/sync/upload`
Header: `Authorization: Bearer <token>`
```json
{ "projects": [], "tasks": [], "fixtures": [], "activities": [] }
```

### 下载数据（需登录）
`GET /api/sync/download`
Header: `Authorization: Bearer <token>`

## 部署方式一：自建服务器（SQLite模式）

```bash
# 1. 安装 Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 2. 安装依赖
npm install --production

# 3. 开放端口
ufw allow 3000/tcp

# 4. 启动
node server.js
```

后台运行：`nohup node server.js > lumenflow.log 2>&1 &`

数据存储在 `data/lumenflow.db`，定期备份此文件即可。

## 部署方式二：Render 免费托管（PostgreSQL模式）

**完整图文教程见《Render免费部署教程.md》，要点如下：**

1. 注册 GitHub，创建仓库 `lumenflow-server`，上传本项目所有文件（不含 node_modules、data）
2. 注册 Supabase，创建免费数据库，复制连接串作为 `DATABASE_URL`
3. 注册 Render，New Web Service → 连接 GitHub 仓库
4. 配置：
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Environment Variables:
     - `DATABASE_URL` = Supabase 连接串
     - `TOKEN_SECRET` = 随意一串随机字符
5. 部署完成后得到 `https://xxx.onrender.com`，APK 中填写此地址

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | 服务端口 | 3000 |
| DATABASE_URL | PostgreSQL连接串（设置后启用PG模式） | 无（SQLite） |
| TOKEN_SECRET | 加密密钥，生产环境务必设置 | 内置默认值 |

## 数据备份

- SQLite模式：备份 `data/lumenflow.db`
- PostgreSQL模式：数据在 Supabase 云端，免费版自动备份
