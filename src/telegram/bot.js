// Telegram update router for the /quote bot.
// /quote → bot replies with a single inline-keyboard URL button to the
// hosted quote form. URL contains a one-time token that the form submits
// back, letting /api/quote-submit authenticate the request and find the
// chat to post the trade summary to.

const crypto = require('crypto');
const tg = require('./api');
const { setQuoteToken } = require('./session');

const DEFAULT_FORM_URL = 'https://sdm-quote-engine.vercel.app/quote-form.html';

function isAllowedChat(chatId) {
  const allowed = process.env.TELEGRAM_ALLOWED_GROUP_ID;
  if (!allowed) return false;
  return String(chatId) === String(allowed);
}

function quoteFormUrl() {
  return process.env.QUOTE_FORM_URL || DEFAULT_FORM_URL;
}

async function handleUpdate(update) {
  if (update.message) return handleMessage(update.message);
  if (update.callback_query) {
    return tg.answerCallbackQuery({ callback_query_id: update.callback_query.id }).catch(() => {});
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat && msg.chat.id;
  const userId = msg.from && msg.from.id;
  if (!chatId) return;
  if (!isAllowedChat(chatId)) return;

  const text = (msg.text || '').trim();

  if (text.startsWith('/quote')) {
    const token = crypto.randomBytes(16).toString('hex');
    await setQuoteToken(token, { chatId, userId, createdAt: Date.now() });
    const url = `${quoteFormUrl()}?t=${token}`;
    await tg.sendMessage({
      chat_id: chatId,
      text: '*New trade quote*\nTap below to open the form. Link is single-use, valid for 15 minutes.',
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '📋 Open quote form', url },
        ]],
      },
    });
    return;
  }

  if (text.startsWith('/start') || text.startsWith('/help')) {
    await tg.sendMessage({
      chat_id: chatId,
      text: 'Send /quote to open the trade-quote form.',
    });
    return;
  }
}

module.exports = { handleUpdate };
