// backend/src/lib/web_push.js
// Transporte de Web Push (PWA). Camada de canal, no mesmo espirito de
// notifyEmail em notifications.js: NUNCA lanca, sempre devolve { ok }.
//
// Existe porque push e o unico canal que chega no celular do dono sem custo
// por mensagem e sem depender da janela de 24h do WhatsApp. Nao substitui os
// outros canais — soma. Se falhar, o e-mail e o WhatsApp ja sairam.
//
// Degradacao proposital: sem VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no ambiente, o
// modulo vira no-op logado. A VPS de producao pode subir sem as chaves e nada
// quebra; o frontend descobre pelo /public/config que push esta indisponivel e
// simplesmente nao oferece.
import crypto from 'node:crypto';
import webpush from 'web-push';
import { pool } from './db.js';

const PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || '').trim();
// O subject vai dentro do JWT e serve para o push service saber quem contatar
// se sua aplicacao comecar a abusar. mailto: valido, nao um placeholder.
const SUBJECT = String(process.env.VAPID_SUBJECT || '').trim() || 'mailto:contato@agendamentosonline.com';

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  } catch (err) {
    // Chave malformada (colada pela metade, por exemplo). Melhor seguir sem push
    // do que derrubar o boot inteiro do backend por causa de um canal opcional.
    console.error('[push] VAPID invalido, push desativado:', err?.message || err);
  }
}

export function pushEnabled() {
  return configured;
}

export function pushPublicKey() {
  return configured ? PUBLIC_KEY : null;
}

// O endpoint e uma URL longa; o hash e o que indexa e deduplica.
export function hashEndpoint(endpoint) {
  return crypto.createHash('sha256').update(String(endpoint || '')).digest('hex');
}

// Tamanhos fixados pela RFC 8291: p256dh e um ponto EC P-256 nao comprimido
// (65 bytes) e auth e um segredo de 16 bytes. Nao sao um palpite.
const P256DH_BYTES = 65;
const AUTH_BYTES = 16;

function decodedLength(base64url) {
  try {
    return Buffer.from(base64url, 'base64url').length;
  } catch {
    return -1;
  }
}

// Aceita tanto o formato cru do PushSubscription.toJSON() do navegador quanto
// um objeto ja achatado. Devolve null se faltar peca — o caller responde 400.
export function normalizeSubscription(raw) {
  const endpoint = String(raw?.endpoint || '').trim();
  const p256dh = String(raw?.keys?.p256dh || raw?.p256dh || '').trim();
  const auth = String(raw?.keys?.auth || raw?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) return null;
  // Um endpoint so faz sentido em https, e cabe no VARCHAR(512) da tabela.
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 512) return null;
  // Chave de tamanho errado e recusada AQUI e nao la no envio. A biblioteca
  // rejeita na hora de cifrar, o que significa que uma assinatura malformada
  // entraria no banco e falharia em todo envio futuro, para sempre — e sem
  // nunca receber o 410 que dispara a limpeza automatica.
  if (decodedLength(p256dh) !== P256DH_BYTES) return null;
  if (decodedLength(auth) !== AUTH_BYTES) return null;
  return { endpoint, p256dh, auth };
}

export async function saveSubscription(usuarioId, raw, userAgent) {
  const sub = normalizeSubscription(raw);
  if (!sub) return { ok: false, error: 'invalid_subscription' };
  try {
    // ON DUPLICATE KEY: o mesmo navegador reinscrevendo (troca de usuario no
    // mesmo aparelho, ou chave rotacionada) atualiza a linha existente. Sem
    // isso, o endpoint antigo continuaria apontando para o usuario errado.
    await pool.query(
      `INSERT INTO push_subscriptions (usuario_id, endpoint, endpoint_hash, p256dh, auth, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE usuario_id=VALUES(usuario_id), p256dh=VALUES(p256dh),
                               auth=VALUES(auth), user_agent=VALUES(user_agent)`,
      [usuarioId, sub.endpoint, hashEndpoint(sub.endpoint), sub.p256dh, sub.auth, String(userAgent || '').slice(0, 255) || null],
    );
    return { ok: true };
  } catch (err) {
    console.error('[push] erro ao salvar assinatura:', err?.message || err);
    return { ok: false, error: 'save_failed' };
  }
}

export async function removeSubscription(usuarioId, endpoint) {
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE usuario_id=? AND endpoint_hash=?', [
      usuarioId,
      hashEndpoint(endpoint),
    ]);
    return { ok: true };
  } catch (err) {
    console.error('[push] erro ao remover assinatura:', err?.message || err);
    return { ok: false, error: 'delete_failed' };
  }
}

// 404/410 do push service significam "esse navegador nao existe mais" —
// desinstalou o PWA, limpou os dados, revogou a permissao. E terminal: manter a
// linha so gera erro em todo envio futuro.
function isGone(statusCode) {
  return statusCode === 404 || statusCode === 410;
}

/**
 * Envia uma notificacao para TODOS os navegadores inscritos de um usuario.
 * Nunca lanca. Devolve { ok, sent, failed, pruned }.
 *
 * payload: { title, body, url?, tag? } — `tag` faz o sistema operacional
 * substituir a notificacao anterior de mesmo tag em vez de empilhar.
 */
export async function sendPushToUser(usuarioId, payload = {}) {
  if (!configured) return { ok: false, error: 'push_disabled', sent: 0 };
  if (!usuarioId) return { ok: false, error: 'missing_user', sent: 0 };

  let rows = [];
  try {
    [rows] = await pool.query(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE usuario_id=?',
      [usuarioId],
    );
  } catch (err) {
    console.error('[push] erro ao ler assinaturas:', err?.message || err);
    return { ok: false, error: 'query_failed', sent: 0 };
  }
  if (!rows.length) return { ok: true, sent: 0, failed: 0, pruned: 0 };

  const body = JSON.stringify({
    title: String(payload.title || 'Agendamentos Online'),
    body: String(payload.body || ''),
    url: String(payload.url || '/'),
    tag: payload.tag ? String(payload.tag) : undefined,
  });

  const dead = [];
  let sent = 0;
  let failed = 0;

  // Um aparelho fora do ar nao pode impedir os outros de receber, entao cada
  // envio e isolado. allSettled em vez de all pelo mesmo motivo.
  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body,
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        if (isGone(err?.statusCode)) dead.push(row.id);
        else console.warn('[push] falha no envio (id=%s): %s', row.id, err?.message || err);
      }
    }),
  );

  let pruned = 0;
  if (dead.length) {
    try {
      const [r] = await pool.query('DELETE FROM push_subscriptions WHERE id IN (?)', [dead]);
      pruned = r?.affectedRows || 0;
    } catch (err) {
      console.warn('[push] erro ao limpar assinaturas mortas:', err?.message || err);
    }
  }

  if (sent) {
    // Best-effort: serve para diagnosticar "o dono jura que nao recebe nada".
    pool
      .query('UPDATE push_subscriptions SET last_success_at=NOW(3) WHERE usuario_id=?', [usuarioId])
      .catch(() => {});
  }

  return { ok: true, sent, failed, pruned };
}
