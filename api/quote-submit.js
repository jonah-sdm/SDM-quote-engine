// Vercel handler: POST /api/quote-submit
// Receives form submission from the Telegram Web App, validates the request
// came from a real Telegram user (initData HMAC), fetches live SDM spot,
// formats the trade summary, and posts it back into the allowlisted group.

const { validateInitData } = require('../src/telegram/initData');
const { fetchSpot } = require('../src/telegram/spotPrice');
const { formatQuoteSummary } = require('../src/telegram/quote');
const { sendMessage } = require('../src/telegram/api');

function bad(res, status, error) {
  return res.status(status).json({ error });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return bad(res, 405, 'Method not allowed');

  const body = req.body || {};
  const { initData, side, symbol, client, deposit, fee } = body;

  // Auth: validate Telegram Web App initData against our bot token
  const validation = validateInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
  if (!validation.ok) return bad(res, 401, `auth: ${validation.reason}`);

  // Sanitize inputs
  if (side !== 'buy' && side !== 'sell') return bad(res, 400, 'bad side');
  if (!symbol || typeof symbol !== 'string') return bad(res, 400, 'bad symbol');
  if (typeof client !== 'string' || !client.trim()) return bad(res, 400, 'client name required');
  const dep = Number(deposit);
  const f = Number(fee);
  if (!(dep > 0)) return bad(res, 400, 'deposit must be positive');
  if (!Number.isFinite(f)) return bad(res, 400, 'fee must be a number');

  const allowedChat = process.env.TELEGRAM_ALLOWED_GROUP_ID;
  if (!allowedChat) return bad(res, 500, 'TELEGRAM_ALLOWED_GROUP_ID not configured');

  try {
    const spotResult = await fetchSpot(symbol);
    const pair = symbol.replace('-', '/');
    const summary = formatQuoteSummary({
      client: client.trim(),
      pair,
      side,
      deposit: dep,
      fee: f,
      spot: spotResult.price,
    });
    await sendMessage({ chat_id: allowedChat, text: summary, parse_mode: 'Markdown' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('quote-submit error:', err && err.stack || err);
    return bad(res, 500, err.message || String(err));
  }
};
