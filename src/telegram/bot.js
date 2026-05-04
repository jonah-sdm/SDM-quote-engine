// Telegram update router for the /quote bot.
//
// One-line command:
//   /quote <amount>, <pair>, <buy|sell>, <fee%>
// Optional 5th comma-separated value: client name (added to the summary).
//
// Examples:
//   /quote 14000, USDT/GBP, buy, 0.4
//   /quote 14000, USDT-GBP, buy, 0.4, BMI Metals Ltd.
//   /quote 3500000, BTC-USD, sell, 0.25, Acme Corp
//
// Bot fetches live SDM spot, computes dealt rate per the formula
//   buy:  dealtRate = spot * (1 + fee/100)
//   sell: dealtRate = spot * (1 - fee/100)
// then posts an "Indicative Summary" back into the chat.

const tg = require('./api');
const { getCachedSymbols, setCachedSymbols } = require('./session');
const {
  fetchSpot, fetchAvailableSymbols,
  symbolToDisplayPair, displayPairToSymbol,
} = require('./spotPrice');
const { formatQuoteSummary } = require('./quote');

function isAllowedChat(chatId) {
  const allowed = process.env.TELEGRAM_ALLOWED_GROUP_ID;
  if (!allowed) return false;
  return String(chatId) === String(allowed);
}

const USAGE =
  '*Usage:* `/quote <amount>, <pair>, <buy|sell>, <fee%>` ' +
  '(optional 5th value: client name)\n\n' +
  '*Examples:*\n' +
  '`/quote 14000, USDT/GBP, buy, 0.4`\n' +
  '`/quote 14000, USDT-GBP, buy, 0.4, BMI Metals Ltd.`';

async function handleUpdate(update) {
  if (update.message) return handleMessage(update.message);
  if (update.callback_query) {
    return tg.answerCallbackQuery({ callback_query_id: update.callback_query.id }).catch(() => {});
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat && msg.chat.id;
  if (!chatId) return;
  if (!isAllowedChat(chatId)) return;

  const text = (msg.text || '').trim();

  if (text.startsWith('/quote')) return handleQuote(chatId, text);

  if (text.startsWith('/start') || text.startsWith('/help')) {
    await tg.sendMessage({ chat_id: chatId, text: USAGE, parse_mode: 'Markdown' });
    return;
  }
}

async function handleQuote(chatId, text) {
  // Strip "/quote" or "/quote@SDMquote_bot"
  const argsText = text.replace(/^\/quote(?:@\w+)?\s*/i, '').trim();
  if (!argsText) {
    return tg.sendMessage({ chat_id: chatId, text: USAGE, parse_mode: 'Markdown' });
  }

  // Strip thousand-separator commas (14,000 → 14000) before splitting, so the
  // user can write "14,000, USDT/GBP, buy, 0.4" without the parser misreading
  // it as 5 fields.
  const normalized = stripThousandSeparators(argsText);
  const parts = normalized.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 4 || parts.length > 5) {
    return tg.sendMessage({
      chat_id: chatId,
      text: `Need 4 or 5 comma-separated values, got ${parts.length}.\n\n${USAGE}`,
      parse_mode: 'Markdown',
    });
  }

  const [amountStr, pairStr, sideStrRaw, feeStr, clientRaw] = parts;
  const amount = parseNumber(amountStr);
  const fee = parseNumber(feeStr);
  const sideStr = (sideStrRaw || '').toLowerCase();
  const side = (sideStr === 'b' || sideStr === 'buy') ? 'buy'
            : (sideStr === 's' || sideStr === 'sell') ? 'sell'
            : null;
  const client = (clientRaw || '').trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    return tg.sendMessage({ chat_id: chatId, text: `Bad amount: "${amountStr}". Must be a positive number.` });
  }
  if (!Number.isFinite(fee)) {
    return tg.sendMessage({ chat_id: chatId, text: `Bad fee: "${feeStr}". Must be a number (e.g. 0.4 for 0.4%).` });
  }
  if (!side) {
    return tg.sendMessage({ chat_id: chatId, text: `Side must be \`buy\` or \`sell\` (got "${sideStrRaw}").`, parse_mode: 'Markdown' });
  }

  // Validate pair against the SDM catalog
  let catalog;
  try {
    catalog = await getSymbolsCatalog();
  } catch (e) {
    return tg.sendMessage({ chat_id: chatId, text: `Couldn't fetch SDM symbols: ${e.message}` });
  }
  const wanted = displayPairToSymbol(pairStr);
  const match = catalog.symbols.find(s => s.symbol.toUpperCase() === wanted);
  if (!match) {
    const suggestions = suggestSymbols(catalog, pairStr);
    const hint = suggestions.length ? `\nDid you mean: ${suggestions.join(', ')}?` : '';
    return tg.sendMessage({
      chat_id: chatId,
      text: `Pair "${pairStr}" not in SDM catalog.${hint}`,
    });
  }

  // Live spot
  let spotResult;
  try {
    spotResult = await fetchSpot(match.symbol);
  } catch (e) {
    return tg.sendMessage({
      chat_id: chatId,
      text: `Couldn't fetch spot for ${match.symbol}: ${e.message}`,
    });
  }

  // Compute + send summary
  let summary;
  try {
    summary = formatQuoteSummary({
      client: client || undefined,
      pair: symbolToDisplayPair(match.symbol),
      side,
      deposit: amount,
      fee,
      spot: spotResult.price,
    });
  } catch (e) {
    return tg.sendMessage({ chat_id: chatId, text: `Quote error: ${e.message}` });
  }

  await tg.sendMessage({ chat_id: chatId, text: summary, parse_mode: 'Markdown' });
}

// ---- helpers ----------------------------------------------------------------
async function getSymbolsCatalog() {
  const cached = await getCachedSymbols().catch(() => null);
  if (cached && Array.isArray(cached.symbols) && cached.symbols.length) return cached;
  const fresh = await fetchAvailableSymbols();
  await setCachedSymbols(fresh).catch(() => {});
  return fresh;
}

function suggestSymbols(catalog, input, limit = 6) {
  if (!input || !catalog) return [];
  const q = String(input).toUpperCase().replace(/[\s/_-]/g, '');
  return catalog.symbols
    .filter(s => s.symbol.toUpperCase().replace('-', '').includes(q))
    .slice(0, limit)
    .map(s => s.symbol);
}

function parseNumber(s) {
  const cleaned = String(s).replace(/[\s_,]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function stripThousandSeparators(text) {
  // Repeat until no more matches, so "1,000,000" collapses fully.
  let prev;
  do {
    prev = text;
    text = text.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  } while (text !== prev);
  return text;
}

module.exports = { handleUpdate };
