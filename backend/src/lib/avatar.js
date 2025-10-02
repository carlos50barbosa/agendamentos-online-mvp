import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..', '..');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const AVATAR_DIR = path.join(UPLOADS_DIR, 'avatars');
const PUBLIC_PREFIX = '/uploads/avatars';

const SUPPORTED_MIME = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/webp', '.webp'],
]);

async function ensureDirs() {
  await fs.mkdir(AVATAR_DIR, { recursive: true });
}

function sanitizePublicPath(value) {
  if (!value) return null;
  const normalized = value.replace(/\\/g, '/');
  if (!normalized.startsWith(PUBLIC_PREFIX)) return null;
  return normalized;
}

function toAbsolutePath(publicPath) {
  const sanitized = sanitizePublicPath(publicPath);
  if (!sanitized) return null;
  const relative = sanitized.slice(PUBLIC_PREFIX.length).replace(/^\/+/, '');
  const absolute = path.join(AVATAR_DIR, relative);
  if (!absolute.startsWith(AVATAR_DIR)) return null;
  return absolute;
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = SUPPORTED_MIME.get(mime);
  if (!ext) return null;
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) return null;
  // Limite de 2 MB
  if (buffer.length > 2 * 1024 * 1024) {
    const err = new Error('avatar_too_large');
    err.code = 'AVATAR_TOO_LARGE';
    throw err;
  }
  return { buffer, ext, mime };
}

export async function saveAvatarFromDataUrl(dataUrl, userId, previousPath) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    const err = new Error('invalid_avatar_data');
    err.code = 'AVATAR_INVALID';
    throw err;
  }
  await ensureDirs();
  const filename = `${userId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${parsed.ext}`;
  const absolute = path.join(AVATAR_DIR, filename);
  await fs.writeFile(absolute, parsed.buffer);
  const publicPath = `${PUBLIC_PREFIX}/${filename}`;
  if (previousPath && previousPath !== publicPath) {
    await removeAvatarFile(previousPath).catch(() => {});
  }
  return publicPath;
}

export async function removeAvatarFile(publicPath) {
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

export function getAvatarPublicPath(fileName) {
  return `${PUBLIC_PREFIX}/${fileName}`;
}

export { AVATAR_DIR };
