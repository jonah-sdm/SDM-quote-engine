// Per-(chat,user) conversation state for the /quote flow. Backed by Upstash Redis
// (HTTP) so it works from Vercel serverless cold starts. 10-minute TTL.

const TTL_SECONDS = 10 * 60;

let _redis = null;
function client() {
  if (_redis) return _redis;
  const { Redis } = require('@upstash/redis');
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set');
  _redis = new Redis({ url, token });
  return _redis;
}

const key = (chatId, userId) => `tgquote:${chatId}:${userId}`;

async function getSession(chatId, userId) {
  const v = await client().get(key(chatId, userId));
  if (!v) return null;
  // Upstash auto-parses JSON when value was stored as an object; tolerate either form.
  return typeof v === 'string' ? JSON.parse(v) : v;
}

async function setSession(chatId, userId, data) {
  await client().set(key(chatId, userId), JSON.stringify(data), { ex: TTL_SECONDS });
}

async function clearSession(chatId, userId) {
  await client().del(key(chatId, userId));
}

module.exports = { getSession, setSession, clearSession };
