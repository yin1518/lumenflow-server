/**
 * LumenFlow 照明工程管理 - 云端同步后端服务
 * 功能：用户注册/登录、数据云端上传/下载（多设备同步）
 * 技术：Node.js + Express + SQLite / PostgreSQL 双模式
 *
 * 模式选择：
 *   - 设置环境变量 DATABASE_URL（PostgreSQL连接串）→ 使用 PostgreSQL（推荐用于 Render/Supabase）
 *   - 未设置 DATABASE_URL → 使用本地 SQLite（适合自建服务器）
 */

const express = require('express');
const cors = require('cors');
const CryptoJS = require('crypto-js');
const path = require('path');
const fs = require('fs');

// ===== 配置 =====
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'lumenflow.db');
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'lumenflow_sync_secret_2026';
const DATABASE_URL = process.env.DATABASE_URL || '';
const IS_PG = !!DATABASE_URL;

// ===== 数据库初始化 =====
let db = null;
let pgPool = null;

// 统一查询：SQLite 用 ? 占位符，PostgreSQL 用 $1,$2 占位符
function toPgSql(sql, params) {
  if (!IS_PG) return { sql, params };
  let index = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++index}`);
  return { sql: pgSql, params };
}

async function initDb() {
  if (IS_PG) {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_sync_at TEXT
      );
      CREATE TABLE IF NOT EXISTS user_data (
        user_id TEXT PRIMARY KEY,
        projects TEXT DEFAULT '[]',
        tasks TEXT DEFAULT '[]',
        fixtures TEXT DEFAULT '[]',
        activities TEXT DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
    `);
    console.log('  [数据库] PostgreSQL 已连接');
  } else {
    const Database = require('better-sqlite3');
    if (!fs.existsSync(path.join(__dirname, 'data'))) {
      fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_sync_at TEXT
      );
      CREATE TABLE IF NOT EXISTS user_data (
        user_id TEXT PRIMARY KEY,
        projects TEXT DEFAULT '[]',
        tasks TEXT DEFAULT '[]',
        fixtures TEXT DEFAULT '[]',
        activities TEXT DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
    `);
    console.log('  [数据库] SQLite 已就绪 (' + DB_PATH + ')');
  }
}

// ===== 统一查询执行 =====
async function run(sql, params = []) {
  if (IS_PG) {
    const { sql: pgSql, params: pgParams } = toPgSql(sql, params);
    await pgPool.query(pgSql, pgParams);
    return;
  }
  db.prepare(sql).run(...params);
}

async function get(sql, params = []) {
  if (IS_PG) {
    const { sql: pgSql, params: pgParams } = toPgSql(sql, params);
    const result = await pgPool.query(pgSql, pgParams);
    return result.rows[0] || undefined;
  }
  return db.prepare(sql).get(...params);
}

async function runTx(operations) {
  // operations: [{ sql, params }]
  if (IS_PG) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      for (const op of operations) {
        const { sql: pgSql, params: pgParams } = toPgSql(op.sql, op.params);
        await client.query(pgSql, pgParams);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return;
  }
  const tx = db.transaction(() => {
    for (const op of operations) {
      db.prepare(op.sql).run(...op.params);
    }
  });
  tx();
}

// ===== 工具函数 =====
function generateId() {
  return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function hashPassword(password) {
  return CryptoJS.SHA256(password + TOKEN_SECRET).toString();
}

function generateToken(userId) {
  const payload = { userId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 }; // 30天有效
  return CryptoJS.AES.encrypt(JSON.stringify(payload), TOKEN_SECRET).toString();
}

function verifyToken(token) {
  try {
    const bytes = CryptoJS.AES.decrypt(token, TOKEN_SECRET);
    const payload = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
    if (payload.exp < Date.now()) return null;
    return payload.userId;
  } catch (e) {
    return null;
  }
}

// ===== 认证中间件 =====
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  if (!authHeader) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }
  const token = authHeader.replace('Bearer ', '');
  const userId = verifyToken(token);
  if (!userId) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
  req.userId = userId;
  next();
}

// ===== Express 应用 =====
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LumenFlow Sync Server',
    database: IS_PG ? 'PostgreSQL' : 'SQLite',
    time: new Date().toISOString(),
  });
});

// ===== 用户注册 =====
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    if (username.length < 2) {
      return res.status(400).json({ error: '用户名至少2个字符' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: '密码至少4个字符' });
    }

    const existing = await get('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    const userId = generateId();
    const now = new Date().toISOString();
    const passwordHash = hashPassword(password);

    await runTx([
      {
        sql: 'INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        params: [userId, username, email || null, passwordHash, now],
      },
      {
        sql: "INSERT INTO user_data (user_id, projects, tasks, fixtures, activities, updated_at) VALUES (?, '[]', '[]', '[]', '[]', ?)",
        params: [userId, now],
      },
    ]);

    const token = generateToken(userId);
    res.json({
      user: { id: userId, username, email: email || null, createdAt: now },
      token,
    });
  } catch (e) {
    console.error('[register]', e);
    res.status(500).json({ error: '服务器内部错误，请稍后重试' });
  }
});

// ===== 用户登录 =====
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    const user = await get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || user.password_hash !== hashPassword(password)) {
      return res.status(400).json({ error: '用户名或密码错误' });
    }

    const token = generateToken(user.id);
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.created_at,
        lastSyncAt: user.last_sync_at,
      },
      token,
    });
  } catch (e) {
    console.error('[login]', e);
    res.status(500).json({ error: '服务器内部错误，请稍后重试' });
  }
});

// ===== 上传数据到云端 =====
app.post('/api/sync/upload', authMiddleware, async (req, res) => {
  try {
    const { projects, tasks, fixtures, activities } = req.body;
    const userId = req.userId;
    const now = new Date().toISOString();

    await runTx([
      {
        sql: 'UPDATE user_data SET projects = ?, tasks = ?, fixtures = ?, activities = ?, updated_at = ? WHERE user_id = ?',
        params: [
          JSON.stringify(projects || []),
          JSON.stringify(tasks || []),
          JSON.stringify(fixtures || []),
          JSON.stringify(activities || []),
          now,
          userId,
        ],
      },
      {
        sql: 'UPDATE users SET last_sync_at = ? WHERE id = ?',
        params: [now, userId],
      },
    ]);

    res.json({ success: true, syncedAt: now, message: '数据已同步到云端' });
  } catch (e) {
    console.error('[upload]', e);
    res.status(500).json({ error: '上传失败，请稍后重试' });
  }
});

// ===== 从云端下载数据 =====
app.get('/api/sync/download', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const data = await get('SELECT * FROM user_data WHERE user_id = ?', [userId]);
    const user = await get('SELECT last_sync_at FROM users WHERE id = ?', [userId]);

    if (!data) {
      return res.json({
        projects: [],
        tasks: [],
        fixtures: [],
        activities: [],
        lastSyncAt: user?.last_sync_at || null,
      });
    }

    res.json({
      projects: JSON.parse(data.projects || '[]'),
      tasks: JSON.parse(data.tasks || '[]'),
      fixtures: JSON.parse(data.fixtures || '[]'),
      activities: JSON.parse(data.activities || '[]'),
      lastSyncAt: user?.last_sync_at || data.updated_at,
    });
  } catch (e) {
    console.error('[download]', e);
    res.status(500).json({ error: '下载失败，请稍后重试' });
  }
});

// ===== Vercel Serverless 导出 =====
let _dbReady = false;

module.exports = async (req, res) => {
  try {
    if (!_dbReady) {
      await initDb();
      _dbReady = true;
      console.log('LumenFlow 云端同步服务已启动');
    }
    app(req, res);
  } catch (e) {
    console.error('初始化失败：', e.message);
    res.status(500).json({ error: '服务器初始化失败，请检查 DATABASE_URL' });
  }
};

