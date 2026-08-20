// Pedidos de acesso "ver todos os meus agendamentos", provados por mensagem RECEBIDA.
//
// O fluxo inteiro em três passos:
//   1. a aba pede um código        -> createLinkRequest()
//   2. a pessoa envia pelo WhatsApp -> confirmLinkRequestByCode() (chamado pelo webhook de inbound)
//   3. a aba pergunta "chegou?"     -> consumeConfirmedLinkRequest()
//
// A razão de ser prova por inbound, e não OTP, está no cabeçalho de sql/2026-08-20-add-wa-link-
// requests.sql: a categoria AUTHENTICATION da Meta é inalcançável para o volume desta conta, e uma
// mensagem enviada pelo dono do número é prova mais forte que um código digitado.
import crypto from 'crypto';
import { pool } from './db.js';

// Sem I, O, 0 e 1: o código aparece na tela e alguém vai acabar redigitando à mão quando o link do
// WhatsApp abrir sem o texto (acontece em navegador embutido).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const TTL_MINUTES = 15;

export const LINK_KEYWORD = 'MEUS AGENDAMENTOS';

export function generateLinkCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

export function hashLinkCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim().toUpperCase()).digest('hex');
}

// Extrai candidatos a código de um texto livre. Lenient de propósito: a pessoa pode mandar só o
// código, pode mandar com a frase, pode digitar em minúsculas, e alguns teclados acrescentam
// pontuação. Quem decide se vale é o banco — um candidato que não existe simplesmente não casa.
export function extractLinkCodeCandidates(text) {
  const upper = String(text || '').toUpperCase();
  // Limite de palavra dos dois lados (\b): sem ele a própria palavra AGENDAMENTOS produz o
  // candidato 'AGENDAME' — oito letras do alfabeto dentro de uma palavra maior. Não casaria com
  // nada no banco, mas é uma consulta a mais por mensagem e um log confuso na investigação.
  const matches = upper.match(new RegExp(`\\b[${ALPHABET}]{${CODE_LENGTH}}\\b`, 'g')) || [];
  return [...new Set(matches)];
}

export function buildLinkMessage(code) {
  return `${LINK_KEYWORD} ${code}`;
}

// Link wa.me com o texto pronto. O número sai do MESMO env que recebe as mensagens: apontar para
// outro numero produziria um link que nunca confirma, e o sintoma (aba esperando para sempre) não
// diria por quê.
export function buildWaLink(code, env = process.env) {
  const number = String(env.WA_PUBLIC_NUMBER || '').replace(/\D/g, '');
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(buildLinkMessage(code))}`;
}

export async function createLinkRequest({ ip = null, db = pool } = {}) {
  const code = generateLinkCode();
  const requestId = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);
  await db.query(
    'INSERT INTO wa_link_requests (request_id, code_hash, expires_at, ip_addr) VALUES (?,?,?,?)',
    [requestId, hashLinkCode(code), expiresAt, ip ? String(ip).slice(0, 64) : null]
  );
  return { requestId, code, expiresAt };
}

/**
 * Chamado pelo webhook quando chega uma mensagem. Casa o código com um pedido pendente e grava de
 * quem veio.
 *
 * Só confirma o que ainda está pendente e dentro do prazo: um código já usado não volta a valer, e
 * `confirmado_em IS NULL` no WHERE faz a corrida (duas mensagens iguais) ser decidida pelo banco.
 */
export async function confirmLinkRequestByCode({ code, phoneE164, wamid, db = pool }) {
  const phone = String(phoneE164 || '').replace(/\D/g, '');
  if (!phone) return { ok: false, reason: 'missing_phone' };
  const [result] = await db.query(
    `UPDATE wa_link_requests
        SET telefone_e164 = ?, wamid = ?, confirmado_em = NOW()
      WHERE code_hash = ?
        AND confirmado_em IS NULL
        AND expires_at > NOW()`,
    [phone, wamid ? String(wamid).slice(0, 128) : null, hashLinkCode(code)]
  );
  if (!result?.affectedRows) return { ok: false, reason: 'not_found_or_used' };
  return { ok: true, phone };
}

/**
 * Chamado pela aba que está esperando. Devolve o telefone confirmado UMA vez.
 *
 * O `consumido_em IS NULL` no WHERE é o que torna o token de sessão único: sem ele, quem guardasse a
 * URL do polling reabriria o acesso quantas vezes quisesse, muito depois de a pessoa ter fechado a
 * aba — e sem nova prova de posse.
 */
export async function consumeConfirmedLinkRequest({ requestId, db = pool }) {
  const [rows] = await db.query(
    'SELECT id, telefone_e164, confirmado_em, consumido_em, expires_at FROM wa_link_requests WHERE request_id=? LIMIT 1',
    [String(requestId || '')]
  );
  const row = rows?.[0];
  if (!row) return { status: 'not_found' };
  if (row.consumido_em) return { status: 'used' };
  if (!row.confirmado_em) {
    if (new Date(row.expires_at).getTime() < Date.now()) return { status: 'expired' };
    return { status: 'pending' };
  }
  const [result] = await db.query(
    'UPDATE wa_link_requests SET consumido_em = NOW() WHERE id=? AND consumido_em IS NULL',
    [row.id]
  );
  if (!result?.affectedRows) return { status: 'used' };
  return { status: 'confirmed', phone: String(row.telefone_e164 || '') };
}
