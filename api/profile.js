// api/profile.js
// POST /api/profile  { "code": "AB12CD34" }  ->  { profile: {...} }
//
// SUPUESTOS (ajusta si tu esquema es distinto):
//  - Variable de entorno MONGODB_URI (con el nombre de la base en la URI)
//  - Colección "participants"
//  - Campos: accessCode, xUsername, createdAt, tickets (opcional)

const { MongoClient } = require('mongodb');

let cachedClient = null;
async function getDb() {
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGODB_URI);
    await cachedClient.connect();
  }
  return cachedClient.db(); // usa la base indicada en la URI
}

// Límite de intentos por IP (en memoria; sirve como freno básico en serverless)
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 20;

function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, start: now };
  if (now - entry.start > WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  attempts.set(ip, entry);
  return entry.count > MAX_ATTEMPTS;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Demasiados intentos. Prueba de nuevo en unos minutos.' });
  }

  const raw = (req.body && req.body.code) || '';
  const code = String(raw).trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    return res.status(400).json({ error: 'El código debe tener 8 caracteres (letras y números).' });
  }

  try {
    const db = await getDb();
    const user = await db.collection('participants').findOne(
      { accessCode: code },
      { projection: { _id: 0, xUsername: 1, createdAt: 1, tickets: 1 } }
    );

    if (!user) {
      return res.status(404).json({ error: 'Código no encontrado. Revisa el que te dio el bot.' });
    }

    // Nunca se devuelve accessCode ni chatId
    return res.status(200).json({
      profile: {
        xUsername: user.xUsername,
        createdAt: user.createdAt || null,
        tickets: user.tickets || 0,
      },
    });
  } catch (err) {
    console.error('profile error:', err);
    return res.status(500).json({ error: 'Error del servidor. Inténtalo más tarde.' });
  }
};
