import { pool } from '../../lib/db.js';

/**
 * Por quanto tempo um handoff aberto continua calando o robô.
 *
 * Existe porque não havia saída. `closeHandoff` só é chamado quando o CLIENTE digita `voltar bot`,
 * `menu` ou `0` — três palavras que ninguém nunca disse a ele — e não há tela onde o dono feche.
 * Sem prazo, um handoff aberto é mudo permanente para aquele par (tenant, telefone), em silêncio,
 * sem ninguém saber. Doze horas cobre o caso real: se o atendimento humano ia acontecer, já
 * aconteceu; se não aconteceu, é melhor o robô voltar do que a conversa morrer.
 */
const TTL_HORAS = (() => {
  const n = Number(process.env.WA_HANDOFF_TTL_HORAS);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 12;
})();

function normalizePhone(value) {
  return String(value || '').trim();
}

async function getActiveHandoff({ tenantId, fromPhone }, { deps = {} } = {}) {
  const tenant = Number(tenantId);
  const phone = normalizePhone(fromPhone);
  if (!Number.isFinite(tenant) || tenant <= 0 || !phone) return null;
  const executar = deps.query || ((sql, params) => pool.query(sql, params));
  try {
    const [rows] = await executar(
      `SELECT id, tenant_id, from_phone, reason, status, assigned_to, avisado_em,
              created_at, updated_at,
              (created_at < (NOW() - INTERVAL ? HOUR)) AS vencido
         FROM wa_handoff_queue
        WHERE tenant_id=? AND from_phone=? AND status IN ('open','assigned')
        ORDER BY id DESC
        LIMIT 1`,
      [TTL_HORAS, tenant, phone]
    );
    const item = rows?.[0] || null;
    if (!item) return null;

    // Vencido: fecha e devolve null, para o robô voltar a atender em vez de ficar mudo para sempre.
    if (Number(item.vencido || 0) === 1) {
      await closeHandoff(
        { tenantId: tenant, fromPhone: phone, closedBy: `ttl_${TTL_HORAS}h` },
        { deps }
      ).catch(() => null);
      return null;
    }
    return item;
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) return null;
    throw err;
  }
}

/**
 * Reivindica o direito de enviar a mensagem de "atendimento humano em andamento".
 *
 * Devolve true só para a PRIMEIRA chamada deste handoff. Antes disso a frase saía a cada mensagem
 * da cliente — vinte mensagens de conversa, vinte interrupções, vindas do número do próprio salão.
 */
async function claimHandoffNotice(handoffId, { deps = {} } = {}) {
  const id = Number(handoffId);
  if (!Number.isFinite(id) || id <= 0) return false;
  const executar = deps.query || ((sql, params) => pool.query(sql, params));
  try {
    const [r] = await executar(
      `UPDATE wa_handoff_queue SET avisado_em=NOW(3)
        WHERE id=? AND avisado_em IS NULL`,
      [id]
    );
    return Number(r?.affectedRows || 0) > 0;
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) return false;
    // Coluna ausente (migração não aplicada): avisar demais é melhor que não avisar.
    if (err?.code === 'ER_BAD_FIELD_ERROR' || err?.errno === 1054) return true;
    throw err;
  }
}

async function openHandoff({ tenantId, fromPhone, reason }) {
  const tenant = Number(tenantId);
  const phone = normalizePhone(fromPhone);
  const why = String(reason || 'manual').slice(0, 128);
  if (!Number.isFinite(tenant) || tenant <= 0 || !phone) {
    return { ok: false, created: false, item: null };
  }
  const existing = await getActiveHandoff({ tenantId: tenant, fromPhone: phone });
  if (existing) return { ok: true, created: false, item: existing };
  try {
    const [result] = await pool.query(
      `INSERT INTO wa_handoff_queue
        (tenant_id, from_phone, reason, status, assigned_to, created_at, updated_at, closed_at)
       VALUES (?,?,?,'open',NULL,NOW(),NOW(),NULL)`,
      [tenant, phone, why]
    );
    const id = Number(result?.insertId || 0);
    const item = id
      ? await getActiveHandoff({ tenantId: tenant, fromPhone: phone })
      : null;
    return { ok: true, created: true, item: item || { id, tenant_id: tenant, from_phone: phone, reason: why, status: 'open' } };
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return { ok: false, created: false, tableMissing: true, item: null };
    }
    throw err;
  }
}

async function closeHandoff({ tenantId, fromPhone, closedBy }, { deps = {} } = {}) {
  const tenant = Number(tenantId);
  const phone = normalizePhone(fromPhone);
  const actor = String(closedBy || 'bot').slice(0, 64);
  if (!Number.isFinite(tenant) || tenant <= 0 || !phone) return { ok: false, affectedRows: 0 };
  const executar = deps.query || ((sql, params) => pool.query(sql, params));
  try {
    const [result] = await executar(
      `UPDATE wa_handoff_queue
          SET status='closed',
              reason=CONCAT(IFNULL(reason,''), ' | closed_by:', ?),
              updated_at=NOW(),
              closed_at=NOW()
        WHERE tenant_id=? AND from_phone=? AND status IN ('open','assigned')`,
      [actor, tenant, phone]
    );
    return { ok: true, affectedRows: Number(result?.affectedRows || 0) };
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return { ok: false, affectedRows: 0, tableMissing: true };
    }
    throw err;
  }
}

export { getActiveHandoff, openHandoff, closeHandoff, claimHandoffNotice, TTL_HORAS };
