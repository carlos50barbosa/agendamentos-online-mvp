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
import { createWhatsAppTemplate, fetchWhatsAppTemplateStatus, isDuplicateTemplateError } from './waGraph.js';

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

/**
 * Aplica o veredito que chegou pelo webhook. Casa por (waba_id, name) — que é o índice da tabela e
 * a única chave possível, já que o evento da Meta não traz o nosso `estabelecimento_id`.
 *
 * Não achar linha NÃO é erro: pode ser um modelo criado à mão naquela WABA, fora do nosso catálogo.
 * Mas fica registrado, porque também pode ser sintoma de conta reconectada com outra WABA.
 *
 * @returns {Promise<{ atualizado: boolean }>}
 */
export async function applyTenantTemplateStatus(evento, { deps = {} } = {}) {
  if (!evento?.wabaId || !evento?.name || !evento?.status) return { atualizado: false };
  const executar = deps.query || ((sql, params) => pool.query(sql, params));
  const logger = deps.logger || console;

  const [r] = await executar(
    `UPDATE wa_tenant_templates
        SET status=?,
            rejected_reason=?,
            meta_template_id=COALESCE(?, meta_template_id),
            atualizado_em=NOW(3)
      WHERE waba_id=? AND name=?`,
    [evento.status, evento.reason, evento.metaTemplateId, evento.wabaId, evento.name]
  );

  const atualizado = Number(r?.affectedRows || 0) > 0;
  if (!atualizado) {
    logger.warn('[wa/tenant-templates] status sem linha correspondente', {
      wabaId: evento.wabaId, name: evento.name, status: evento.status,
    });
    return { atualizado: false, estabelecimentoId: null };
  }

  logger.info('[wa/tenant-templates] status atualizado', {
    wabaId: evento.wabaId, name: evento.name, status: evento.status,
    motivo: evento.reason || undefined,
  });

  // De quem é este modelo. O evento da Meta não traz o nosso id, e quem chama precisa dele para
  // decidir se este foi o veredito que completou os quatro — e avisar o dono.
  const [donos] = await executar(
    'SELECT estabelecimento_id FROM wa_tenant_templates WHERE waba_id=? AND name=? LIMIT 1',
    [evento.wabaId, evento.name]
  );
  return { atualizado: true, estabelecimentoId: donos?.[0]?.estabelecimento_id ?? null };
}

/**
 * O modelo daquele tipo, SE a conta própria estiver de fato em uso.
 *
 * Devolve a linha mesmo não aprovada, de propósito: quem chama precisa distinguir "não usa WABA
 * própria" (null) de "usa, mas o modelo não foi liberado" (status != APPROVED). No primeiro caso o
 * envio segue pelo caminho antigo; no segundo ele NÃO pode sair, porque o modelo não existe na
 * conta de onde a mensagem sairia.
 *
 * ─── Por que o JOIN com wa_accounts ────────────────────────────────────────────────────────────
 *
 * As linhas SOBREVIVEM à desconexão — são histórico. Sem exigir conta `connected`, um
 * estabelecimento que desconectasse a WABA voltaria ao número global (que TEM modelo aprovado) e
 * mesmo assim teria todo envio ao cliente bloqueado para sempre, em silêncio, por causa de uma
 * linha PENDING antiga.
 *
 * O `a.waba_id = t.waba_id` cobre o outro caso: reconectar com OUTRA conta. Os modelos da conta
 * anterior não existem na nova, e usá-los falharia com "template não encontrado".
 */
export async function getTenantTemplateRow(estabelecimentoId, kind, { deps = {} } = {}) {
  if (!estabelecimentoId || !kind) return null;
  const executar = deps.query || ((sql, params) => pool.query(sql, params));
  const [rows] = await executar(
    `SELECT t.kind, t.name, t.language, t.status
       FROM wa_tenant_templates t
       JOIN wa_accounts a
         ON a.estabelecimento_id = t.estabelecimento_id
        AND a.status = 'connected'
        AND a.waba_id = t.waba_id
      WHERE t.estabelecimento_id=? AND t.kind=?
      LIMIT 1`,
    [estabelecimentoId, kind]
  );
  return rows?.[0] || null;
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
  const consultarStatus = deps.fetchWhatsAppTemplateStatus || fetchWhatsAppTemplateStatus;
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
        // Já existe nessa WABA — reconexão.
        //
        // NÃO dá para assumir PENDING aqui: a Meta só manda `message_template_status_update` quando
        // o veredito MUDA, e um modelo aprovado meses atrás não gera evento novo. Assumir PENDING
        // deixaria a linha assim para sempre, bloqueando todo envio ao cliente de um salão que
        // antes funcionava — e sem sintoma nenhum. Por isso perguntamos o status à Graph.
        //
        // Se a consulta falhar, PENDING continua sendo o palpite: bloqueia em vez de mandar por um
        // número errado, e o webhook ainda pode corrigir.
        const atual = await consultarStatus({ accessToken, wabaId, name: tpl.name }).catch(() => null);
        await registrar({
          estabelecimentoId, wabaId, kind: tpl.kind, name: tpl.name,
          language: tpl.language,
          metaTemplateId: atual?.metaTemplateId || null,
          status: atual?.status || 'PENDING',
        }).catch(() => null);
        existentes += 1;
        resultados.push({
          kind: tpl.kind, ok: true, existente: true,
          status: atual?.status || 'PENDING',
          status_origem: atual ? 'graph' : 'presumido',
        });
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
