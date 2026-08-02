// backend/src/lib/wa_template_status.js
//
// Leitura do webhook `message_template_status_update`. Módulo puro: recebe o change, devolve o
// evento normalizado. Sem I/O, para poder ser testado sem banco nem Graph.
//
// A aprovação de um modelo é ASSÍNCRONA: a criação devolve PENDING e o veredito chega aqui, minutos
// ou horas depois, um modelo de cada vez. Sem este handler todo modelo ficaria eternamente PENDING
// na nossa visão, e o envio nunca sairia da janela de 24h.

/** Estados que a Meta usa no campo `event`. Guardamos como vierem, em maiúsculas. */
export const TEMPLATE_STATUSES = Object.freeze([
  'APPROVED',
  'REJECTED',
  'PAUSED',
  'DISABLED',
  'PENDING',
  'PENDING_DELETION',
  'FLAGGED',
]);

/**
 * Resume as linhas de `wa_tenant_templates` para a tela.
 *
 * Puro de propósito: a decisão de "o canal está pronto?" é o que o dono vê depois de conectar, e
 * errar isso significa ou esconder um problema real ou assustar sem motivo.
 *
 * `ready` exige TODOS aprovados — basta um pendente para aquele tipo de aviso sair por e-mail, e o
 * dono precisa saber disso antes de estranhar.
 */
export function summarizeTemplateRows(rows = []) {
  const lista = Array.isArray(rows) ? rows : [];
  const porStatus = (s) => lista.filter((r) => String(r?.status || '').toUpperCase() === s);

  const aprovados = porStatus('APPROVED');
  const recusados = porStatus('REJECTED');
  const pendentes = lista.filter((r) => {
    const s = String(r?.status || '').toUpperCase();
    return s !== 'APPROVED' && s !== 'REJECTED';
  });

  return {
    total: lista.length,
    aprovados: aprovados.length,
    pendentes: pendentes.length,
    recusados: recusados.length,
    // Sem nenhuma linha o estabelecimento não usa WABA própria: nada a avisar.
    ready: lista.length > 0 && aprovados.length === lista.length,
    detalhes: lista.map((r) => ({
      kind: r.kind,
      name: r.name,
      status: String(r.status || '').toUpperCase(),
      motivo: r.rejected_reason || null,
    })),
  };
}

/**
 * @returns {{ wabaId, name, language, status, reason, metaTemplateId } | null}
 *   null quando o change não é de status de modelo ou está sem o mínimo para identificar a linha.
 */
export function parseTemplateStatusEvent(change) {
  if (!change || change.field !== 'message_template_status_update') return null;

  const value = change.value || {};
  const name = String(value.message_template_name || '').trim();
  // Sem NOME e sem WABA não há como achar a linha: o nome só é único DENTRO de uma WABA.
  const wabaId = String(change.wabaId || change.__wabaId || '').trim();
  if (!name || !wabaId) return null;

  const status = String(value.event || '').trim().toUpperCase();
  if (!status) return null;

  // "NONE" é como a Meta diz "sem motivo", em aprovação. Guardar isso como razão de recusa
  // encheria a coluna de ruído.
  const reasonRaw = String(value.reason || '').trim();
  const reason = !reasonRaw || reasonRaw.toUpperCase() === 'NONE' ? null : reasonRaw;

  const metaTemplateId = value.message_template_id != null
    ? String(value.message_template_id)
    : null;

  return {
    wabaId,
    name,
    language: String(value.message_template_language || '').trim() || null,
    status,
    reason,
    metaTemplateId,
  };
}
