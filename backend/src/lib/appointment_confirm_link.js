import crypto from 'crypto';

// Emissor do link público de confirmação do agendamento.
//
// As colunas public_confirm_token_hash / public_confirm_expires_at já existiam no schema
// (2026-01-10-add-public-confirmation.sql) junto com a rota GET /public/agendamentos/confirm,
// mas nada no código chegava a gerar um token — a rota era inalcançável. Este módulo é a peça
// que faltava. Guardamos só o SHA-256, mesmo padrão do reset de senha: quem tiver acesso de
// leitura ao banco não consegue reconstruir o link.

export const hashConfirmToken = (token) =>
  crypto.createHash('sha256').update(String(token || '')).digest('hex');

function resolveApiBaseUrl() {
  const frontBase = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');
  const isDevFront = /^(https?:\/\/)?(localhost|127\.0\.0\.1):3001$/i.test(frontBase);
  const defaultApi = isDevFront ? 'http://localhost:3002' : `${frontBase}/api`;
  return String(process.env.API_BASE_URL || process.env.BACKEND_BASE_URL || defaultApi).replace(/\/$/, '');
}

export function buildConfirmUrl(token) {
  return `${resolveApiBaseUrl()}/public/agendamentos/confirm?token=${encodeURIComponent(token)}`;
}

/**
 * Gera o link de confirmação de um agendamento.
 *
 * O token vale até o horário de início: depois disso confirmar não significa mais nada.
 *
 * ATENÇÃO — emitir ROTACIONA o token: o último link emitido é o único que funciona, e qualquer
 * link mandado antes para o mesmo agendamento morre na hora. Isso é consequência de guardarmos
 * só o hash — o texto puro do token anterior não é recuperável, então "reaproveitar o link
 * existente" é literalmente impossível. Hoje só existe um ponto de emissão (o lembrete de 8h,
 * idempotente por reminder_8h_sent_at), então nada colide. Se você adicionar um segundo ponto
 * de envio (e-mail de criação, reenvio manual), lembre que o envio mais recente invalida o
 * anterior — o que costuma ser o comportamento desejado, mas precisa ser uma escolha consciente.
 *
 * @returns {Promise<{url: string, token: string}|null>} null se não deu para emitir
 */
export async function issueConfirmLink(pool, agendamentoId, { inicio } = {}) {
  const id = Number(agendamentoId);
  if (!Number.isFinite(id)) return null;

  try {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashConfirmToken(token);
    const expiresAt = inicio ? new Date(inicio) : null;

    const [r] = await pool.query(
      `UPDATE agendamentos
          SET public_confirm_token_hash = ?,
              public_confirm_expires_at = COALESCE(?, public_confirm_expires_at)
        WHERE id = ?`,
      [tokenHash, expiresAt, id]
    );

    if (!r?.affectedRows) return null; // agendamento sumiu entre a leitura e aqui
    return { url: buildConfirmUrl(token), token };
  } catch (e) {
    console.warn('[confirm-link] falha ao emitir token', agendamentoId, e?.message || e);
    return null;
  }
}
