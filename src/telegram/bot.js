// Telegram update router for the /quote bot.
// /quote opens a Web App (single-screen form). The form posts to
// /api/quote-submit which fetches SDM spot and posts the trade summary
// back into the chat.

const tg = require('./api');

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
  // We no longer use callback_query / ForceReply replies in the new flow.
  // Acknowledge any stray callback so Telegram stops spinning.
  if (update.callback_query) {
    return tg.answerCallbackQuery({ callback_query_id: update.callback_query.id }).catch(() => {});
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat && msg.chat.id;
  if (!chatId) return;
  if (!isAllowedChat(chatId)) return;

  const text = (msg.text || '').trim();

  if (text.startsWith('/quote')) {
    await tg.sendMessage({
      chat_id: chatId,
      text: '*New trade quote*\nTap below to open the form.',
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '📋 Open quote form', web_app: { url: quoteFormUrl() } },
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
