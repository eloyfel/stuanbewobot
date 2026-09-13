const crypto = require('crypto');
const { getDb } = require('./db');

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateCode(length = 8) {
  return crypto
    .randomBytes(length * 2)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, length);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Creates (or refreshes) a participant's access code. Returns the plaintext
// code — only its hash is stored, same approach as the original server.js.
async function upsertParticipant(handle) {
  const db = await getDb();
  const code = generateCode(8);
  const codeHash = hashCode(code);

  const existing = await db.collection('participants').findOne({ handle });
  await db.collection('participants').updateOne(
    { handle },
    {
      $set: { handle, codeHash },
      $setOnInsert: { registeredAt: existing ? existing.registeredAt : new Date() },
    },
    { upsert: true }
  );

  return code;
}

async function listParticipants() {
  const db = await getDb();
  return db
    .collection('participants')
    .find({}, { projection: { handle: 1, registeredAt: 1, _id: 0 } })
    .sort({ registeredAt: -1 })
    .toArray();
}

async function findParticipantByCode(code) {
  const db = await getDb();
  const codeHash = hashCode(code);
  return db.collection('participants').findOne({ codeHash });
}

async function createSession(handle) {
  const db = await getDb();
  const token = generateToken();
  await db.collection('sessions').insertOne({ token, handle, createdAt: new Date() });
  return token;
}

async function getSessionHandle(token) {
  if (!token) return null;
  const db = await getDb();
  const session = await db.collection('sessions').findOne({ token });
  return session ? session.handle : null;
}

async function deleteSession(token) {
  if (!token) return;
  const db = await getDb();
  await db.collection('sessions').deleteOne({ token });
}

// Per-Telegram-chat state for the /start captcha + username flow.
// Replaces the in-memory `botFlow` map from the old always-on server.js —
// serverless functions don't share memory between invocations.
async function getBotFlow(chatId) {
  const db = await getDb();
  return db.collection('botflow').findOne({ chatId });
}

async function setBotFlow(chatId, data) {
  const db = await getDb();
  await db
    .collection('botflow')
    .updateOne({ chatId }, { $set: { chatId, ...data, updatedAt: new Date() } }, { upsert: true });
}

module.exports = {
  upsertParticipant,
  listParticipants,
  findParticipantByCode,
  createSession,
  getSessionHandle,
  deleteSession,
  getBotFlow,
  setBotFlow,
};
