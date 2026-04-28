// Minimal Telegram Bot API client over fetch. Avoids pulling in a full SDK.

function tgUrl(method) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function call(method, body) {
  const r = await fetch(tgUrl(method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) {
    const desc = data.description || `HTTP ${r.status}`;
    throw new Error(`Telegram ${method} failed: ${desc}`);
  }
  return data.result;
}

const sendMessage = (params) => call('sendMessage', params);
const editMessageText = (params) => call('editMessageText', params);
const answerCallbackQuery = (params) => call('answerCallbackQuery', params);
const setWebhook = (params) => call('setWebhook', params);
const getWebhookInfo = () => call('getWebhookInfo', {});

module.exports = { call, sendMessage, editMessageText, answerCallbackQuery, setWebhook, getWebhookInfo };
