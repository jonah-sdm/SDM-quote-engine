// Per-(chat,user) conversation state for the /quote flow + a generic cache
// for shared lookups (e.g. SDM symbol catalog). Backed by Upstash Redis (HTTP)
// so it works from Vercel serverless cold starts.

const SESSION_TTL_SECONDS = 10 * 60;
const SYMBOLS_TTL_SECONDS = 60 * 60;     // 1 hour
const QUOTE_TOKEN_TTL_SECONDS = 15 * 60; // 15 min

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

// One-time token for opening the quote form. Single-use, 15-min TTL.
// Maps token -> { chatId, userId, createdAt }.
const tokenKey = (token) => `quotetoken:${token}`;

async function setQuoteToken(token, data) {
  await client().set(tokenKey(token), JSON.stringify(data), { ex: QUOTE_TOKEN_TTL_SECONDS });
}

async function consumeQuoteToken(token) {
  if (!token) return null;
  const v = await client().get(tokenKey(token));
  if (!v) return null;
  // Single-use: delete after read so a token can't be replayed.
  await client().del(tokenKey(token)).catch(() => {});
  return typeof v === 'string' ? JSON.parse(v) : v;
}

module.exports = {
  getSession, setSession, clearSession,
  getCachedSymbols, setCachedSymbols, clearCachedSymbols,
  setQuoteToken, consumeQuoteToken,
};
