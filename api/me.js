const { getSessionHandle } = require('../lib/store');
const { parseCookies } = require('../lib/cookies');

module.exports = async (req, res) => {
  const cookies = parseCookies(req);
  const handle = await getSessionHandle(cookies.session);

  if (!handle) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  res.status(200).json({ handle });
};
