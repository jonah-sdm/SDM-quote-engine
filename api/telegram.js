// Vercel serverless webhook for the Telegram /quote bot.
// Telegram POSTs updates here. Verify the secret header, ack fast (200), then
// process the update. Errors are swallowed after responding so Telegram doesn't
// retry a malformed update.

const { handleUpdate } = require('../src/telegram/bot');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const got = req.headers['x-telegram-bot-api-secret-token'];
  if (!expected || got !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Ack immediately so Telegram doesn't retry while we work.
  res.status(200).json({ ok: true });

  try {
    await handleUpdate(req.body || {});
  } catch (err) {
    console.error('telegram handler error:', err);
  }
};
