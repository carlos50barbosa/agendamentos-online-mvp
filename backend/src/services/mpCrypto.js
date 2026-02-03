import crypto from 'node:crypto';
const KEY_ENV = 'MP_TOKEN_ENC_KEY';
function loadKey() {
const raw = process.env[KEY_ENV];
if (!raw) {
throw new Error(`ENV ${KEY_ENV} ausente`);
}
  const key = Buffer.from(String(raw), 'base64');
if (key.length !== 32) {
throw new Error(`ENV ${KEY_ENV} deve conter 32 bytes em base64`);
}
  return key;
}
export function encryptMpToken(token) {
if (!token) return { enc: null, last4: null };
const key = loadKey();
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();
const enc = `v1:${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
const last4 = String(token).slice(-4);
return { enc, last4 };
}
export function decryptMpToken(enc) {
if (!enc) return null;
const key = loadKey();
const payload = String(enc).startsWith('v1:') ? String(enc).slice(3) : String(enc);
const parts = payload.split('.');
if (parts.length !== 3) {
throw new Error('access_token_enc invalido');
}
  const [ivB64, tagB64, dataB64] = parts;
const iv = Buffer.from(ivB64, 'base64');
const tag = Buffer.from(tagB64, 'base64');
const data = Buffer.from(dataB64, 'base64');
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);
const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
return plaintext.toString('utf8');
}

