const { MongoClient } = require('mongodb');

// Reused across invocations when Vercel keeps the function instance warm.
let cachedClient = null;
let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI env var is not set');

  if (!cachedClient) {
    cachedClient = new MongoClient(uri);
    await cachedClient.connect();
  }

  cachedDb = cachedClient.db('stuanbewo');
  return cachedDb;
}

module.exports = { getDb };
