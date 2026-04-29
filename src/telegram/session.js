// Per-(chat,user) conversation state for the /quote flow + a generic cache
// for shared lookups (e.g. SDM symbol catalog). Backed by Upstash Redis (HTTP)
// so it works from Vercel serverless cold starts.

const SESSION_TTL_SECONDS = 10 * 60;
const SYMBOLS_TTL_SECONDS = 60 * 60; // 1 hour

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

const sessionKey = (chatId, userId) => `tgquote:${chatId}:${userId}`;
const SYMBOLS_KEY = 'cache:sdm:symbols';

async function getSession(chatId, userId) {
  const v = await client().get(sessionKey(chatId, userId));
  if (!v) return null;
  return typeof v === 'string' ? JSON.parse(v) : v;
}

async function setSession(chatId, userId, data) {
  await client().set(sessionKey(chatId, userId), JSON.stringify(data), { ex: SESSION_TTL_SECONDS });
}

async function clearSession(chatId, userId) {
  await client().del(sessionKey(chatId, userId));
}

async function getCachedSymbols() {
  const v = await client().get(SYMBOLS_KEY);
  if (!v) return null;
  return typeof v === 'string' ? JSON.parse(v) : v;
}

async function setCachedSymbols(data) {
  await client().set(SYMBOLS_KEY, JSON.stringify(data), { ex: SYMBOLS_TTL_SECONDS });
}

async function clearCachedSymbols() {
  await client().del(SYMBOLS_KEY);
}

module.exports = {
  getSession, setSession, clearSession,
  getCachedSymbols, setCachedSymbols, clearCachedSymbols,
};
