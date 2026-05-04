// Cache for shared lookups (SDM symbol catalog). Backed by Upstash Redis (HTTP)
// so it works from Vercel serverless cold starts. The /quote command itself is
// stateless now (single-line input), so no per-user session is needed.

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

const SYMBOLS_KEY = 'cache:sdm:symbols';

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

module.exports = { getCachedSymbols, setCachedSymbols, clearCachedSymbols };
