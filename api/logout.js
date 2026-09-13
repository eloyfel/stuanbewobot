const { deleteSession } = require('../lib/store');
const { parseCookies } = require('../lib/cookies');

module.exports = async (req, res) => {
  const cookies = parseCookies(req);
  await deleteSession(cookies.session);
  res.setHeader('Set-Cookie', `session=; HttpOnly; Path=/; Max-Age=0`);
  res.status(200).json({ ok: true });
};
