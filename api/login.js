const { findParticipantByCode, createSession } = require('../lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing code' });
  }

  const participant = await findParticipantByCode(code.trim());
  if (!participant) {
    return res.status(401).json({ error: 'That code is invalid or expired.' });
  }

  const token = await createSession(participant.handle);
  res.setHeader(
    'Set-Cookie',
    `session=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax; Secure`
  );
  res.status(200).json({ handle: participant.handle });
};
