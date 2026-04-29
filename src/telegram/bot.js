// Telegram update router for the /quote bot.
// /quote replies with a single inline button that opens the registered
// Mini App via Telegram's t.me/<bot>/<app>?startapp=<chatId> deep link.
// Telegram launches the Mini App as a native popup overlay (no browser
// prompt) since the URL is a recognised Mini App link rather than an
// arbitrary HTTPS link.
//
// One-time setup: in @BotFather, /newapp → register a Direct Link Mini App
// for this bot whose URL is the hosted form. The app's short_name is set
// via TELEGRAM_MINIAPP_SHORTNAME (default: "quote").

const tg = require('./api');

const DEFAULT_BOT_USERNAME = 'SDMquote_bot';
const DEFAULT_MINIAPP_SHORTNAME = 'quote';

function isAllowedChat(chatId) {
  const allowed = process.env.TELEGRAM_ALLOWED_GROUP_ID;
  if (!allowed) return false;
  return String(chatId) === String(allowed);
}

function miniAppUrl(chatId) {
  const bot = process.env.TELEGRAM_BOT_USERNAME || DEFAULT_BOT_USERNAME;
  const app = process.env.TELEGRAM_MINIAPP_SHORTNAME || DEFAULT_MINIAPP_SHORTNAME;
  // start_param max 64 chars, allowed [A-Za-z0-9_-]. chatId for groups looks
  // like -1003928390945 which fits.
  return `https://t.me/${bot}/${app}?startapp=${chatId}`;
}

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

  if (text.startsWith('/quote')) {
    await tg.sendMessage({
      chat_id: chatId,
      text: '*New trade quote*\nTap below to open the form.',
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '📋 Open quote form', url: miniAppUrl(chatId) },
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
