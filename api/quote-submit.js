// Vercel handler: POST /api/quote-submit
// The Mini App posts the form here. Auth is via Telegram Mini App `initData`
// (HMAC-signed by the bot token). The destination chat is encoded in
// `start_param` of initData, which is also signed — so trustable.

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

  // 1. Auth: validate Telegram Mini App initData against our bot token.
  const validation = validateInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
  if (!validation.ok) return bad(res, 401, `auth: ${validation.reason}`);

  // 2. Destination chat comes from the signed start_param.
  const allowedChat = process.env.TELEGRAM_ALLOWED_GROUP_ID;
  const targetChat = validation.startParam || allowedChat;
  if (!targetChat) return bad(res, 400, 'no target chat — start_param missing');
  // Defence in depth: if env allowlist is set, require the start_param matches.
  if (allowedChat && String(targetChat) !== String(allowedChat)) {
    return bad(res, 403, 'target chat not in allowlist');
  }

  // 3. Sanitize input fields.
  if (side !== 'buy' && side !== 'sell') return bad(res, 400, 'bad side');
  if (!symbol || typeof symbol !== 'string') return bad(res, 400, 'bad symbol');
  if (typeof client !== 'string' || !client.trim()) return bad(res, 400, 'client name required');
  const dep = Number(deposit);
  const f = Number(fee);
  if (!(dep > 0)) return bad(res, 400, 'deposit must be positive');
  if (!Number.isFinite(f)) return bad(res, 400, 'fee must be a number');

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
    await sendMessage({ chat_id: targetChat, text: summary, parse_mode: 'Markdown' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('quote-submit error:', err && err.stack || err);
    return bad(res, 500, err.message || String(err));
  }
};
