import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..', '..');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const GALLERY_DIR = path.join(UPLOADS_DIR, 'establishments');

const DEFAULT_PUBLIC_PREFIX = '/uploads/establishments';
const FALLBACK_PREFIXES = ['/api/uploads/establishments', DEFAULT_PUBLIC_PREFIX];

function normalizePrefix(value) {
  if (!value) return null;
  let trimmed = String(value).trim();
  if (!trimmed) return null;
  trimmed = trimmed.replace(/\\/g, '/');
  if (!trimmed.startsWith('/')) trimmed = `/${trimmed}`;
  return trimmed.replace(/\/+$/, '');
}

const PREFERRED_PUBLIC_PREFIX =
  normalizePrefix(process.env.ESTABLISHMENT_GALLERY_PUBLIC_PREFIX) ||
  normalizePrefix(DEFAULT_PUBLIC_PREFIX);

const PUBLIC_PREFIXES = Array.from(
  new Set(
    [PREFERRED_PUBLIC_PREFIX, ...FALLBACK_PREFIXES.map(normalizePrefix)].filter(Boolean)
  )
);

const SUPPORTED_MIME = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/webp', '.webp'],
]);

const MAX_BYTES = Number(process.env.ESTABLISHMENT_GALLERY_MAX_BYTES || 3 * 1024 * 1024);

async function ensureDir() {
  await fs.mkdir(GALLERY_DIR, { recursive: true });
}

function sanitizePublicPath(value) {
  if (!value) return null;
  const normalized = value.replace(/\\/g, '/');
  const prefix = PUBLIC_PREFIXES.find((item) => normalized.startsWith(item));
  if (!prefix) return null;
  return { normalized, prefix };
}

function toAbsolutePath(publicPath) {
  const sanitized = sanitizePublicPath(publicPath);
  if (!sanitized) return null;
  const relative = sanitized.normalized.slice(sanitized.prefix.length).replace(/^\/+/, '');
  const absolute = path.join(GALLERY_DIR, relative);
  if (!absolute.startsWith(GALLERY_DIR)) return null;
  return absolute;
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = SUPPORTED_MIME.get(mime);
  if (!ext) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) return null;
  if (buffer.length > MAX_BYTES) {
    const err = new Error('gallery_image_too_large');
    err.code = 'GALLERY_IMAGE_TOO_LARGE';
    throw err;
  }
  return { buffer, ext };
}

export async function saveEstablishmentImageFromDataUrl(dataUrl, estabelecimentoId) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    const err = new Error('invalid_gallery_image');
    err.code = 'GALLERY_IMAGE_INVALID';
    throw err;
  }
  await ensureDir();
  const filename = `${estabelecimentoId || 'est'}-${Date.now()}-${crypto
    .randomBytes(5)
    .toString('hex')}${parsed.ext}`;
  const absolute = path.join(GALLERY_DIR, filename);
  await fs.writeFile(absolute, parsed.buffer);
  return `${PREFERRED_PUBLIC_PREFIX}/${filename}`;
}

export async function removeEstablishmentImageFile(publicPath) {
  const absolute = toAbsolutePath(publicPath);
  if (!absolute) return;
  try {
    await fs.unlink(absolute);
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      throw err;
    }
  }
}

export function getEstablishmentImagePublicPath(fileName) {
  if (!fileName) return null;
  return `${PREFERRED_PUBLIC_PREFIX}/${fileName.replace(/^\/+/, '')}`;
}
