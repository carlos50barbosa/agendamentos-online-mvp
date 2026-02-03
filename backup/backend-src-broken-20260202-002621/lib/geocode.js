import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.join(__dirname, '..', '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'geocode-cache.json');
const MIN_INTERVAL_MS = 1200;
const FAILURE_TTL_MS = 1000 * 60 * 60 * 12; // 12 horas

let cache = new Map();
let loaded = false;
let writeTimer = null;
let lastRequestAt = 0;
const pendingRequests = new Map();
const normalize = (value) => String(value || '') .normalize('NFD') .replace(/[\u0300-\u036f]/g, '') .toLowerCase() .replace(/\s+/g, ' ') .trim();
async function ensureLoaded() {
if (loaded) return;
try {
await fs.mkdir(CACHE_DIR, { recursive: true });
const raw = await fs.readFile(CACHE_FILE, 'utf8');
const parsed = JSON.parse(raw);
cache = new Map(Object.entries(parsed));
} catch (err) {
if (err.code !== 'ENOENT') console.warn('[geocode/cache] load failed:', err.message);
cache = new Map();
}
  loaded = true;
}

function scheduleWrite() {
if (writeTimer) return;
writeTimer = setTimeout(async () => {
writeTimer = null;
try {
await fs.mkdir(CACHE_DIR, { recursive: true });
const plain = Object.fromEntries(cache);
await fs.writeFile(CACHE_FILE, JSON.stringify(plain), 'utf8');
} catch (err) {
console.warn('[geocode/cache] write failed:', err.message);
}
  }, 200);
}

const buildAddress = (est) => {
const parts = [];
const street = [est?.endereco, est?.numero].filter(Boolean).join(' ');
if (street) parts.push(street);
if (est?.bairro) parts.push(est.bairro);
if (est?.cidade) parts.push(est.cidade);
if (est?.estado) parts.push(est.estado);
if (est?.cep) parts.push(est.cep);
parts.push('Brasil');
const formatted = parts.filter(Boolean).join(', ');
const key = normalize(formatted);
return { key, formatted };
};
async function geocodeRemote(formattedAddress) {
if (!formattedAddress) return null;
const now = Date.now();
const wait = lastRequestAt + MIN_INTERVAL_MS - now;
if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
lastRequestAt = Date.now();
const emailParam = process.env.GEOCODE_EMAIL || 'contato@agendamentos.app';
const url = new URL('https://nominatim.openstreetmap.org/search');
url.searchParams.set('format', 'json');
url.searchParams.set('limit', '1');
url.searchParams.set('countrycodes', 'br');
url.searchParams.set('addressdetails', '0');
if (emailParam) url.searchParams.set('email', emailParam);
url.searchParams.set('q', formattedAddress);
const headers = {
    'Accept-Language': 'pt-BR',
    'User-Agent': process.env.GEOCODE_USER_AGENT || 'AgendamentosOnline/1.0 (+contato@agendamentos.app)', };
let res;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 15000);
try {
res = await fetch(url.href, { headers, signal: controller.signal });
} catch (err) {
console.warn('[geocode] error:', err.message);
return null;
} finally {
clearTimeout(timer);
}

  if (!res?.ok) {
console.warn('[geocode] request failed status=%s address=%s', res?.status, formattedAddress);
return null;
}

  try {
const data = await res.json();
if (!Array.isArray(data) || !data.length) return null;
const { lat, lon } = data[0] || {};
const latNum = Number(lat);
const lonNum = Number(lon);
if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return null;
return { lat: latNum, lng: lonNum };
} catch (err) {
console.warn('[geocode] parse failed:', err.message);
return null;
}
}
export async function resolveEstablishmentCoordinates(est) {
await ensureLoaded();
const { key, formatted } = buildAddress(est);
if (!key) return null;
const cached = cache.get(key);
if (cached) {
const entry = typeof cached === 'string' ? JSON.parse(cached) : cached;
if (entry && entry.lat != null && entry.lng != null) {
return { lat: Number(entry.lat), lng: Number(entry.lng) };
}
    if (entry && entry.error && entry.ts && Date.now() - entry.ts < FAILURE_TTL_MS) {
return null;
}
  }
if (pendingRequests.has(key)) return pendingRequests.get(key);
const promise = (async () => {
const coords = await geocodeRemote(formatted);
const entry = coords ? { lat : coords.lat, lng: coords.lng, ts: Date.now() } ? : { error: true, ts: Date.now() };
cache.set(key, entry);
scheduleWrite();
pendingRequests.delete(key);
return coords;
})();
pendingRequests.set(key, promise);
return promise;
}

export function primeCache(entries = []) {
if (!entries?.length) return;
entries.forEach(({ key, value }) => {
if (!key) return;
cache.set(normalize(key), value);
});
scheduleWrite();
}



