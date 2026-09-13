module.exports = async (req, res) => {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;

  if (!TOKEN) {
    return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not set' });
  }
  if (!host) {
    return res.status(500).json({ ok: false, error: 'Could not determine this deployment\'s URL' });
  }

  const webhookUrl = `https://${host}/api/bot-webhook`;
  const telegramUrl = `https://api.telegram.org/bot${TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;

  const r = await fetch(telegramUrl);
  const data = await r.json();

  res.status(200).json({ webhookUrl, telegram: data });
};
