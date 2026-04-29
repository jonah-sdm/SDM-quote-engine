// Telegram update router for the /quote bot.
// State machine: side(button) → pair(text) → client(text) → deposit(text) → fee(text) → summary

const tg = require('./api');
const {
  getSession, setSession, clearSession,
  getCachedSymbols, setCachedSymbols,
} = require('./session');
const {
  fetchSpot, fetchAvailableSymbols,
  symbolToDisplayPair, displayPairToSymbol,
} = require('./spotPrice');
const { formatQuoteSummary } = require('./quote');

const STEP = {
  SIDE: 'side',
  PAIR: 'pair',
  CLIENT: 'client',
  DEPOSIT: 'deposit',
  FEE: 'fee',
};

function isAllowedChat(chatId) {
  const allowed = process.env.TELEGRAM_ALLOWED_GROUP_ID;
  if (!allowed) return false;
  return String(chatId) === String(allowed);
}

function sideKeyboard() {
  return {
    inline_keyboard: [[
      { text: 'Buy',  callback_data: 'side:buy' },
      { text: 'Sell', callback_data: 'side:sell' },
    ]],
  };
}

const forceReply = { force_reply: true, selective: true };

// ---- Symbol catalog ----------------------------------------------------------
// Try cache first, then live fetch. Cache for 1h via session.js helpers.
async function getSymbolsCatalog() {
  const cached = await getCachedSymbols().catch(() => null);
  if (cached && Array.isArray(cached.symbols) && cached.symbols.length) return cached;
  const fresh = await fetchAvailableSymbols();
  await setCachedSymbols(fresh).catch(() => {});
  return fresh;
}

function findSymbolMatch(catalog, input) {
  if (!input) return null;
  const wanted = displayPairToSymbol(input); // BASE/QUOTE or base-quote → BASE-QUOTE
  return catalog.symbols.find(s => s.symbol.toUpperCase() === wanted) || null;
}

function suggestSymbols(catalog, input, limit = 6) {
  if (!input || !catalog) return [];
  const q = String(input).toUpperCase().replace(/[\s/_-]/g, '');
  return catalog.symbols
    .filter(s => s.symbol.toUpperCase().replace('-', '').includes(q))
    .slice(0, limit)
    .map(s => s.symbol);
}

// ---- Handlers ----------------------------------------------------------------
async function handleUpdate(update) {
  if (update.message) return handleMessage(update.message);
  if (update.callback_query) return handleCallback(update.callback_query);
}

async function handleMessage(msg) {
  const chatId = msg.chat && msg.chat.id;
  const userId = msg.from && msg.from.id;
  if (!chatId || !userId) return;
  if (!isAllowedChat(chatId)) return;

  const text = (msg.text || '').trim();

  if (text.startsWith('/quote')) {
    await setSession(chatId, userId, { step: STEP.SIDE });
    await tg.sendMessage({
      chat_id: chatId,
      text: 'New quote — choose side:',
      reply_markup: sideKeyboard(),
    });
    return;
  }

  if (text.startsWith('/cancel')) {
    await clearSession(chatId, userId);
    await tg.sendMessage({ chat_id: chatId, text: 'Quote cancelled.' });
    return;
  }

  if (text.startsWith('/start') || text.startsWith('/help')) {
    await tg.sendMessage({
      chat_id: chatId,
      text: 'Send /quote to build a sample trade summary. /cancel to abort.',
    });
    return;
  }

  const session = await getSession(chatId, userId);
  if (!session) return;

  if (session.step === STEP.PAIR) {
    if (!text) {
      await tg.sendMessage({ chat_id: chatId, text: 'Type pair (e.g. `USDT-GBP`):', parse_mode: 'Markdown', reply_markup: forceReply });
      return;
    }
    let catalog;
    try {
      catalog = await getSymbolsCatalog();
    } catch (e) {
      await tg.sendMessage({ chat_id: chatId, text: `Couldn't fetch SDM symbols: ${e.message}` });
      return;
    }
    const match = findSymbolMatch(catalog, text);
    if (!match) {
      const suggestions = suggestSymbols(catalog, text);
      const hint = suggestions.length ? `Did you mean: ${suggestions.join(', ')}?` : 'Try e.g. `USDT-GBP`.';
      await tg.sendMessage({
        chat_id: chatId,
        text: `Pair "${text}" not in SDM catalog. ${hint}`,
        parse_mode: 'Markdown',
        reply_markup: forceReply,
      });
      return;
    }
    session.symbol = match.symbol;                       // SDM canonical e.g. USDT-GBP
    session.pair = symbolToDisplayPair(match.symbol);    // Display e.g. USDT/GBP
    session.step = STEP.CLIENT;
    await setSession(chatId, userId, session);
    await tg.sendMessage({ chat_id: chatId, text: 'Client name?', reply_markup: forceReply });
    return;
  }

  if (session.step === STEP.CLIENT) {
    if (!text) {
      await tg.sendMessage({ chat_id: chatId, text: 'Client name?', reply_markup: forceReply });
      return;
    }
    session.client = text;
    session.step = STEP.DEPOSIT;
    await setSession(chatId, userId, session);
    await tg.sendMessage({
      chat_id: chatId,
      text: `Deposit amount (${depositCcyFor(session)})?`,
      reply_markup: forceReply,
    });
    return;
  }

  if (session.step === STEP.DEPOSIT) {
    const n = parseNumber(text);
    if (!(n > 0)) {
      await tg.sendMessage({
        chat_id: chatId,
        text: `That doesn't look like a positive number. Deposit amount (${depositCcyFor(session)})?`,
        reply_markup: forceReply,
      });
      return;
    }
    session.deposit = n;
    session.step = STEP.FEE;
    await setSession(chatId, userId, session);
    await tg.sendMessage({ chat_id: chatId, text: 'Client fee (%)?', reply_markup: forceReply });
    return;
  }

  if (session.step === STEP.FEE) {
    const n = parseNumber(text);
    if (!Number.isFinite(n)) {
      await tg.sendMessage({
        chat_id: chatId,
        text: "That doesn't look like a number. Client fee (%)?",
        reply_markup: forceReply,
      });
      return;
    }
    session.fee = n;
    await finishQuote(chatId, userId, session);
    return;
  }
}

async function handleCallback(cb) {
  const chatId = cb.message && cb.message.chat && cb.message.chat.id;
  const userId = cb.from && cb.from.id;
  const messageId = cb.message && cb.message.message_id;
  if (!chatId || !userId || !messageId) {
    return tg.answerCallbackQuery({ callback_query_id: cb.id });
  }
  if (!isAllowedChat(chatId)) {
    return tg.answerCallbackQuery({ callback_query_id: cb.id });
  }

  const data = cb.data || '';
  const session = (await getSession(chatId, userId)) || {};

  if (data.startsWith('side:')) {
    if (session.step && session.step !== STEP.SIDE) {
      return tg.answerCallbackQuery({ callback_query_id: cb.id });
    }
    const side = data.slice(5);
    if (side !== 'buy' && side !== 'sell') {
      return tg.answerCallbackQuery({ callback_query_id: cb.id, text: 'Bad selection' });
    }
    session.side = side;
    session.step = STEP.PAIR;
    await setSession(chatId, userId, session);
    await tg.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: `Side: ${side === 'buy' ? 'Buy' : 'Sell'}`,
    });
    await tg.sendMessage({
      chat_id: chatId,
      text: 'Type pair (e.g. `USDT-GBP`):',
      parse_mode: 'Markdown',
      reply_markup: forceReply,
    });
    return tg.answerCallbackQuery({ callback_query_id: cb.id });
  }

  return tg.answerCallbackQuery({ callback_query_id: cb.id });
}

async function finishQuote(chatId, userId, session) {
  let spotResult;
  try {
    spotResult = await fetchSpot(session.symbol);
  } catch (e) {
    await tg.sendMessage({
      chat_id: chatId,
      text: `Couldn't fetch spot for ${session.pair}: ${e.message}. Try /quote again.`,
    });
    await clearSession(chatId, userId);
    return;
  }

  let summary;
  try {
    summary = formatQuoteSummary({
      client: session.client,
      pair: session.pair,
      side: session.side,
      deposit: session.deposit,
      fee: session.fee,
      spot: spotResult.price,
    });
  } catch (e) {
    await tg.sendMessage({ chat_id: chatId, text: `Quote error: ${e.message}` });
    await clearSession(chatId, userId);
    return;
  }

  await tg.sendMessage({ chat_id: chatId, text: summary, parse_mode: 'Markdown' });
  await clearSession(chatId, userId);
}

function parseNumber(s) {
  const cleaned = String(s).replace(/[\s_]/g, '');
  let normalized;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized = cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',') && !cleaned.includes('.')) {
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) normalized = cleaned.replace(',', '.');
    else normalized = cleaned.replace(/,/g, '');
  } else {
    normalized = cleaned;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function depositCcyFor(session) {
  if (!session.pair) return '';
  const [base, quote] = session.pair.split('/');
  return session.side === 'buy' ? quote : base;
}

module.exports = { handleUpdate };
