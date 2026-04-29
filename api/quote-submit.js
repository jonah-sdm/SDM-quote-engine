// Vercel handler: POST /api/quote-submit
// Receives form submission from the hosted quote form. Auth is via a
// one-time token that the bot generated when /quote was issued — looking
// it up in Upstash also tells us which chat to post the summary back to.

const { consumeQuoteToken } = require('../src/telegram/session');
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
  const { token, side, symbol, client, deposit, fee } = body;

  // Auth: consume the one-time token issued by the bot on /quote.
  const auth = await consumeQuoteToken(token).catch(() => null);
  if (!auth) return bad(res, 401, 'invalid or expired link — open /quote in the group again');
  const targetChat = auth.chatId;
  if (!targetChat) return bad(res, 400, 'token missing chat');

  // Sanitize inputs
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
