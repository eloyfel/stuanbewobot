require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'participants.json');

// Render sets RENDER_EXTERNAL_URL automatically to the service's public URL.
// On other hosts, set WEBHOOK_BASE_URL manually as an env var instead.
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_BASE_URL;
const WEBHOOK_PATH = '/bot-webhook';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // browser session cookie: 30 days
const CODE_LENGTH = 8;
// no 0/O or 1/l/I — avoids characters people confuse when retyping
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

if (!TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env — get one from @BotFather first.');
  process.exit(1);
}

// ---------- tiny JSON "database" ----------
// each user: { handle, telegramId, registeredAt, codeHash }
function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(list) {
  fs.writeFileSync(DB_FILE, JSON.stringify(list, null, 2));
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateAccessCode() {
  let code = '';
  const bytes = crypto.randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

// Creates (or rotates) the access code for a user and returns the plaintext
// code — the plaintext is only ever sent once, via Telegram, never stored.
function issueAccessCode(telegramId) {
  const list = loadDB();
  const idx = list.findIndex(u => u.telegramId === telegramId);
  if (idx === -1) return null;
  const code = generateAccessCode();
  list[idx].codeHash = hashCode(code);
  saveDB(list);
  return code;
}

function findUserByTelegramId(telegramId) {
  return loadDB().find(u => u.telegramId === telegramId);
}
function findUserByCode(code) {
  const hash = hashCode(code);
  return loadDB().find(u => u.codeHash === hash);
}

// ---------- in-memory state ----------
const botFlow = {}; // { [chatId]: { step, answer } } — captcha/registration in progress
const webSessions = {}; // { [token]: { telegramId, handle, expiresAt } }
const loginAttempts = {}; // { [ip]: { count, windowStart } } — brute-force guard

function isValidHandle(text) {
  return /^@?[A-Za-z0-9_]{1,15}$/.test(text.trim());
}
function normalizeHandle(text) {
  return text.trim().replace(/^@/, '');
}
function newCaptcha(chatId) {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  botFlow[chatId] = { step: 'captcha', answer: a + b };
  return `To register, just solve this: what's ${a} + ${b}?`;
}

// ---------- bot ----------
// webhook mode: Telegram pushes updates to us instead of us polling Telegram.
// This lets the app run on hosts that sleep when idle (like Render's free tier) —
// the incoming webhook request itself wakes the service back up.
const bot = new TelegramBot(TOKEN, { webHook: { port: false } });

if (PUBLIC_URL) {
  const fullWebhookUrl = `${PUBLIC_URL.replace(/\/$/, '')}${WEBHOOK_PATH}`;
  bot.setWebHook(fullWebhookUrl)
    .then(() => console.log(`Webhook set to ${fullWebhookUrl}`))
    .catch(err => console.error('Failed to set webhook:', err.message));
} else {
  console.warn(
    'No RENDER_EXTERNAL_URL or WEBHOOK_BASE_URL set — the bot will not receive Telegram updates until the webhook is registered.'
  );
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const existing = findUserByTelegramId(msg.from.id);
  if (existing) {
    const code = issueAccessCode(existing.telegramId);
    bot.sendMessage(chatId,
      `You're already registered as @${existing.handle}.\n\n` +
      `Your access code: ${code}\n` +
      `This logs you into the site — keep it like a password. Send /login anytime to get a new one (the old one stops working).`);
    return;
  }
  bot.sendMessage(chatId,
    "Welcome to STUAN BEWO 🤖\nLet's get you on the participant list.\n\n" +
    newCaptcha(chatId)
  );
});

bot.onText(/\/login/, (msg) => {
  const chatId = msg.chat.id;
  const existing = findUserByTelegramId(msg.from.id);
  if (!existing) {
    bot.sendMessage(chatId, "You're not registered yet — send /start first.");
    return;
  }
  const code = issueAccessCode(existing.telegramId);
  bot.sendMessage(chatId,
    `Your new access code: ${code}\n` +
    `Your previous code just stopped working. Keep this one like a password.`);
});

bot.on('message', (msg) => {
  if (!msg.text || msg.text.startsWith('/start') || msg.text.startsWith('/login')) return;
  const chatId = msg.chat.id;
  const flow = botFlow[chatId];
  const text = msg.text.trim();

  if (!flow) {
    bot.sendMessage(chatId, "Send /start to register, or /login if you're already registered.");
    return;
  }

  if (flow.step === 'captcha') {
    const guess = parseInt(text, 10);
    if (Number.isNaN(guess) || guess !== flow.answer) {
      bot.sendMessage(chatId, "Not quite. " + newCaptcha(chatId));
      return;
    }
    flow.step = 'awaiting_username';
    bot.sendMessage(chatId, "Correct ✅ Now send me your X (Twitter) username, e.g. @yourname");
    return;
  }

  if (flow.step === 'awaiting_username') {
    if (!isValidHandle(text)) {
      bot.sendMessage(chatId, "That doesn't look like a valid X username. Try again, e.g. @yourname");
      return;
    }
    const handle = normalizeHandle(text);
    const list = loadDB();

    if (list.some(p => p.handle.toLowerCase() === handle.toLowerCase())) {
      bot.sendMessage(chatId, `@${handle} is already registered by someone else.`);
      delete botFlow[chatId];
      return;
    }

    const code = generateAccessCode();
    list.push({
      handle,
      telegramId: msg.from.id,
      registeredAt: new Date().toISOString(),
      codeHash: hashCode(code)
    });
    saveDB(list);
    delete botFlow[chatId];

    bot.sendMessage(chatId,
      `You're registered as @${handle} 🎉 You'll show up on the site's participant list.\n\n` +
      `Your access code: ${code}\n` +
      `This logs you into the site — keep it like a password. Send /login anytime to get a new one (the old one stops working).`);
  }
});

// ---------- web server ----------
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/api/participants', (req, res) => {
  const list = loadDB().map(p => ({ handle: p.handle, registeredAt: p.registeredAt }));
  res.json(list);
});

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const attempt = loginAttempts[ip];

  if (attempt && now - attempt.windowStart < LOGIN_WINDOW_MS) {
    if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many attempts — try again later.' });
    }
  } else {
    loginAttempts[ip] = { count: 0, windowStart: now };
  }

  const code = (req.body.code || '').trim();
  const user = findUserByCode(code);

  if (!user) {
    loginAttempts[ip].count += 1;
    return res.status(400).json({ error: 'That code is invalid.' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  webSessions[token] = { telegramId: user.telegramId, handle: user.handle, expiresAt: now + SESSION_TTL_MS };

  res.cookie('sb_session', token, { httpOnly: true, maxAge: SESSION_TTL_MS, sameSite: 'lax' });
  res.json({ handle: user.handle });
});

app.get('/api/me', (req, res) => {
  const token = req.cookies.sb_session;
  const session = token && webSessions[token];
  if (!session || Date.now() > session.expiresAt) return res.status(401).json({ error: 'Not logged in' });
  res.json({ handle: session.handle });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies.sb_session;
  if (token) delete webSessions[token];
  res.clearCookie('sb_session');
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`STUAN BEWO web + bot running on port ${PORT}`);
});
