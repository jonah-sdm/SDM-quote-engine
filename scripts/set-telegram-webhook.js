#!/usr/bin/env node
// One-time CLI: register the production webhook URL with Telegram.
// Reads from .env.local (if present) then process.env.
//
//   npm run telegram:set-webhook
//
// Required env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_URL, TELEGRAM_WEBHOOK_SECRET

require('dotenv').config({ path: '.env.local' });
require('dotenv').config(); // also load .env if present, without overriding

const { setWebhook, getWebhookInfo } = require('../src/telegram/api');

async function main() {
  const url = process.env.TELEGRAM_WEBHOOK_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN missing');
  if (!url) throw new Error('TELEGRAM_WEBHOOK_URL missing (e.g. https://your-app.vercel.app/api/telegram)');
  if (!secret) throw new Error('TELEGRAM_WEBHOOK_SECRET missing');

  const result = await setWebhook({
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  console.log('setWebhook ->', result);

  const info = await getWebhookInfo();
  console.log('getWebhookInfo ->', info);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
