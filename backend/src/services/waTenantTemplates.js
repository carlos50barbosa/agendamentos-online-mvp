// backend/src/services/waTenantTemplates.js
//
// Criação e acompanhamento dos modelos de mensagem na WABA de cada estabelecimento conectado.
//
// ─── Por que a criação NÃO é fatal ──────────────────────────────────────────────────────────────
//
// Ao contrário da assinatura do webhook (`subscribeAppToWaba`), que é fatal porque sem ela NADA
// chega, aqui a falha degrada em vez de quebrar: sem modelo aprovado a conta continua recebendo
// mensagens, respondendo dentro da janela de 24h e caindo para e-mail nos avisos. Derrubar a
// conexão inteira porque um dos quatro modelos foi recusado seria desproporcional — e deixaria o
// estabelecimento sem nada, em vez de com quase tudo.
//
// Por isso cada modelo é criado e REGISTRADO isoladamente: um recusado não impede os outros três.
import { pool } from '../lib/db.js';
import { listTenantTemplates } from '../lib/wa_template_catalog.js';
import { createWhatsAppTemplate, isDuplicateTemplateError } from './waGraph.js';

/** Grava (ou atualiza) o estado de um modelo. UNIQUE(estabelecimento_id, kind) torna idempotente. */
export async function recordTenantTemplate({
  estabelecimentoId,
  wabaId,
  kind,
  name,
  language,
  metaTemplateId = null,
  status = 'PENDING',
  rejectedReason = null,
}) {
  await pool.query(
    `INSERT INTO wa_tenant_templates
       (estabelecimento_id, waba_id, kind, name, language, meta_template_id, status, rejected_reason, atualizado_em)
     VALUES (?,?,?,?,?,?,?,?, NOW(3))
     ON DUPLICATE KEY UPDATE
       waba_id=VALUES(waba_id),
       name=VALUES(name),
       language=VALUES(language),
       meta_template_id=COALESCE(VALUES(meta_template_id), meta_template_id),
       status=VALUES(status),
       rejected_reason=VALUES(rejected_reason),
       atualizado_em=NOW(3)`,
    [estabelecimentoId, wabaId, kind, name, language, metaTemplateId, status, rejectedReason]
  );
}

export async function listTenantTemplateRows(estabelecimentoId) {
  const [rows] = await pool.query(
    `SELECT kind, name, language, status, meta_template_id, rejected_reason, atualizado_em
       FROM wa_tenant_templates WHERE estabelecimento_id=? ORDER BY kind`,
    [estabelecimentoId]
  );
  return Array.isArray(rows) ? rows : [];
}

/**
 * Cria na WABA do tenant todos os modelos do catálogo.
 *
 * `deps` existe para o teste: tudo aqui é I/O (Graph e banco), e o que precisa ser verificado é o
 * COMPORTAMENTO — que nome duplicado conta como sucesso, que uma recusa não interrompe as demais,
 * e que todo resultado é registrado. Isso não se prova lendo o código.
 *
 * @returns {Promise<{ criados: number, existentes: number, falhas: number, resultados: object[] }>}
 */
export async function provisionTenantTemplates({ estabelecimentoId, wabaId, accessToken, deps = {} } = {}) {
  const catalogo = deps.listTenantTemplates || listTenantTemplates;
  const criar = deps.createWhatsAppTemplate || createWhatsAppTemplate;
  const duplicado = deps.isDuplicateTemplateError || isDuplicateTemplateError;
  const registrar = deps.recordTenantTemplate || recordTenantTemplate;
  const logger = deps.logger || console;

  const resultados = [];
  let criados = 0;
  let existentes = 0;
  let falhas = 0;

  // Em série, de propósito: em paralelo o log fica ilegível e há limite de taxa na Graph.
  for (const tpl of catalogo()) {
    try {
      const resp = await criar({ accessToken, wabaId, template: tpl });
      await registrar({
        estabelecimentoId,
        wabaId,
        kind: tpl.kind,
        name: tpl.name,
        language: tpl.language,
        metaTemplateId: resp?.id || null,
        status: String(resp?.status || 'PENDING').toUpperCase(),
      });
      criados += 1;
      resultados.push({ kind: tpl.kind, ok: true, status: resp?.status || 'PENDING' });
    } catch (err) {
      if (duplicado(err)) {
        // Já existe nessa WABA — reconexão. O status real chega pelo webhook de status.
        await registrar({
          estabelecimentoId, wabaId, kind: tpl.kind, name: tpl.name,
          language: tpl.language, status: 'PENDING',
        }).catch(() => null);
        existentes += 1;
        resultados.push({ kind: tpl.kind, ok: true, existente: true });
        continue;
      }
      falhas += 1;
      const motivo = err?.body?.error?.error_user_msg || err?.body?.error?.message || err?.message || 'erro';
      logger.warn('[wa/tenant-templates] falha ao criar', { kind: tpl.kind, wabaId, motivo });
      await registrar({
        estabelecimentoId, wabaId, kind: tpl.kind, name: tpl.name,
        language: tpl.language, status: 'REJECTED', rejectedReason: String(motivo).slice(0, 255),
      }).catch(() => null);
      resultados.push({ kind: tpl.kind, ok: false, motivo });
    }
  }

  return { criados, existentes, falhas, resultados };
}
