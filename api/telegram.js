// Vercel serverless webhook for the Telegram /quote bot.
// Telegram POSTs updates here. Verify the secret header, run the handler to
// completion, then ack. We can NOT respond before awaiting handleUpdate — on
// Vercel serverless the function process is frozen the moment you send a
// response, dropping any pending work. Telegram tolerates up to ~60s before
// retrying, our flow finishes in ~1-3s, so synchronous handling is safe.

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

  try {
    await handleUpdate(req.body || {});
  } catch (err) {
    console.error('telegram handler error:', err && err.stack || err);
    // Still 200 so Telegram doesn't retry a poison update forever.
  }

  return res.status(200).json({ ok: true });
};
