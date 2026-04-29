// Vercel serverless webhook for the Telegram /quote bot.
// Telegram POSTs updates here. Verify the secret header, run the handler to
// completion, then ack. We can NOT respond before awaiting handleUpdate — on
// Vercel serverless the function process is frozen the moment you send a
// response, dropping any pending work. Telegram tolerates up to ~60s before
// retrying, our flow finishes in ~1-3s, so synchronous handling is safe.

const { handleUpdate } = require('../src/telegram/bot');

// TEMPORARY: best-effort direct echo, used to confirm the function can reach
// the Telegram API at all from the Vercel runtime. Remove once bot is verified.
async function debugEcho(update) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
  if (!token || !chat) return { skipped: true };
  const allowed = process.env.TELEGRAM_ALLOWED_GROUP_ID;
  const tag = `[debug] update_id=${update.update_id} chat=${chat} allowed=${allowed} match=${String(chat) === String(allowed)} text=${JSON.stringify(update?.message?.text || update?.callback_query?.data || '(non-text)')}`;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: tag }),
    });
    const data = await r.json().catch(() => ({}));
    return { httpStatus: r.status, ok: data.ok, description: data.description };
  } catch (e) {
    return { fetchError: String(e && e.message || e) };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const got = req.headers['x-telegram-bot-api-secret-token'];
  if (!expected || got !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Diagnostic: try to send a debug echo *before* handleUpdate so we can see
  // exactly what the function received and whether sendMessage reaches Telegram.
  const echoResult = await debugEcho(req.body || {});
  console.log('debug echo result:', JSON.stringify(echoResult));

  try {
    await handleUpdate(req.body || {});
  } catch (err) {
    console.error('telegram handler error:', err && err.stack || err);
  }

  return res.status(200).json({ ok: true, echo: echoResult });
};
