// backend/src/services/waTemplateNotifier.js
//
// Os dois avisos por e-mail que fecham o buraco entre conectar o WhatsApp e ele começar a funcionar.
//
// ─── O problema ────────────────────────────────────────────────────────────────────────────────
//
// Entre a conexão e a aprovação dos modelos pela Meta passam horas, às vezes dias. Nesse intervalo
// os avisos ao cliente NÃO saem pelo WhatsApp (ficam no e-mail), de propósito — mandar pelo número
// global seria mandar de um número que o cliente do salão não conhece.
//
// Só que o dono não tem como saber disso. Ele conecta, testa, não chega nada no WhatsApp e conclui
// que o produto está quebrado. A informação existia apenas em um aviso na tela, que ele só vê se
// abrir a página. Daí os dois e-mails: um quando entra em análise, outro quando libera.
//
// ─── Por que NÃO respeitam DISABLE_ESTAB_NOTIFICATIONS nem notify_email_estab ──────────────────
//
// Esses dois desligam o ruído de rotina (aviso de cada agendamento). Aqui é outra coisa: é resposta
// direta a uma ação que o dono acabou de fazer, sobre o estado de uma integração que ele mesmo
// ligou — mais perto de um recibo do que de uma notificação. Quem desligou o ruído de agendamentos
// não pediu para ficar sem saber que o canal que acabou de conectar está mudo.
import { pool } from '../lib/db.js';
import { notifyEmail } from '../lib/notifications.js';
import { listTenantTemplateRows } from './waTenantTemplates.js';
import { summarizeTemplateRows } from '../lib/wa_template_status.js';

const BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'https://agenda0.com.br')
  .replace(/\/$/, '');
const PAINEL = `${BASE}/whatsappbusiness`;

const ROTULOS = Object.freeze({
  confirm_cli: 'Confirmação de agendamento',
  reminder_cli: 'Lembrete',
  cancel_cli: 'Cancelamento',
  reschedule_cli: 'Remarcação',
});

function escapar(valor) {
  return String(valor ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

async function buscarDono(estabelecimentoId, executar) {
  const [linhas] = await executar(
    'SELECT nome, email FROM usuarios WHERE id=? LIMIT 1',
    [estabelecimentoId]
  );
  return linhas?.[0] || null;
}

/**
 * Aviso de que os modelos entraram em análise. Chamado logo depois do provisionamento, nos DOIS
 * caminhos de conexão (Embedded Signup e manual).
 *
 * Também rearma o aviso de liberação: conexão nova, aviso novo.
 */
export async function notifyTemplatesUnderReview({ estabelecimentoId, deps = {} } = {}) {
  const estabId = Number(estabelecimentoId || 0) || null;
  if (!estabId) return { enviado: false, motivo: 'sem_estabelecimento' };

  const executar = deps.query || ((sql, params) => pool.query(sql, params));
  const enviarEmail = deps.notifyEmail || notifyEmail;
  const listar = deps.listTenantTemplateRows || listTenantTemplateRows;
  const logger = deps.logger || console;

  // Rearma antes de qualquer coisa: mesmo que o e-mail falhe, a liberação precisa poder avisar.
  await executar(
    'UPDATE wa_accounts SET templates_ready_notified_at=NULL WHERE estabelecimento_id=?',
    [estabId]
  ).catch(() => null);

  const linhas = await listar(estabId);
  const resumo = summarizeTemplateRows(linhas);

  // Reconexão de quem já tinha tudo aprovado: não há o que avisar, o canal já está de pé.
  if (resumo.ready) return { enviado: false, motivo: 'ja_liberado' };
  if (!resumo.total) return { enviado: false, motivo: 'sem_modelos' };

  const dono = await buscarDono(estabId, executar).catch(() => null);
  if (!dono?.email) return { enviado: false, motivo: 'sem_email' };

  const itens = resumo.detalhes.map((d) => {
    const rotulo = escapar(ROTULOS[d.kind] || d.kind);
    if (d.status === 'APPROVED') return `<li>${rotulo}: <b>liberado</b></li>`;
    if (d.status === 'REJECTED') {
      return `<li>${rotulo}: <b>recusado</b>${d.motivo ? ` — ${escapar(d.motivo)}` : ''}</li>`;
    }
    return `<li>${rotulo}: em análise</li>`;
  }).join('');

  const html = `
    <p>Olá${dono.nome ? `, <b>${escapar(dono.nome)}</b>` : ''}!</p>
    <p>Seu WhatsApp foi conectado. Antes de começar a enviar, a Meta precisa aprovar os modelos das
    mensagens automáticas — é uma exigência dela, não nossa, e costuma levar de algumas horas a um
    ou dois dias.</p>
    <p><b>Enquanto isso, nada deixa de funcionar:</b> os avisos aos seus clientes continuam saindo
    por e-mail, e nenhum agendamento deixa de ser confirmado. O que muda é só o canal.</p>
    <p>Situação de cada mensagem:</p>
    <ul>${itens}</ul>
    <p>Você não precisa fazer nada. Assim que a Meta liberar, a gente avisa por e-mail e as
    mensagens passam a sair pelo número do seu estabelecimento automaticamente.</p>
    <p><a href="${PAINEL}">Acompanhar pelo painel</a></p>
  `.trim();

  const r = await enviarEmail(dono.email, 'Seu WhatsApp está conectado — modelos em análise na Meta', html);
  if (!r?.ok) {
    logger.warn('[wa/templates][aviso-analise] e-mail falhou', { estabelecimentoId: estabId, erro: r?.error });
    return { enviado: false, motivo: 'email_falhou' };
  }
  logger.info('[wa/templates][aviso-analise] enviado', {
    estabelecimentoId: estabId, pendentes: resumo.pendentes, recusados: resumo.recusados,
  });
  return { enviado: true, resumo };
}

/**
 * Aviso de liberação. Chamado a cada veredito que chega pelo webhook — só dispara no evento que
 * completa os quatro.
 *
 * A reivindicação é ATÔMICA (UPDATE ... WHERE templates_ready_notified_at IS NULL) porque os
 * vereditos podem chegar juntos: sem isso, dois eventos veriam "todos aprovados" e mandariam dois
 * e-mails iguais.
 */
export async function maybeNotifyTemplatesReady({ estabelecimentoId, deps = {} } = {}) {
  const estabId = Number(estabelecimentoId || 0) || null;
  if (!estabId) return { enviado: false, motivo: 'sem_estabelecimento' };

  const executar = deps.query || ((sql, params) => pool.query(sql, params));
  const enviarEmail = deps.notifyEmail || notifyEmail;
  const listar = deps.listTenantTemplateRows || listTenantTemplateRows;
  const logger = deps.logger || console;

  const linhas = await listar(estabId);
  const resumo = summarizeTemplateRows(linhas);
  if (!resumo.ready) return { enviado: false, motivo: 'ainda_nao_liberado' };

  // Reivindica. `status='connected'` está aqui porque não faz sentido avisar quem desconectou.
  const [claim] = await executar(
    `UPDATE wa_accounts
        SET templates_ready_notified_at=NOW(3)
      WHERE estabelecimento_id=?
        AND status='connected'
        AND templates_ready_notified_at IS NULL`,
    [estabId]
  );
  if (!Number(claim?.affectedRows || 0)) return { enviado: false, motivo: 'ja_avisado' };

  const dono = await buscarDono(estabId, executar).catch(() => null);
  if (!dono?.email) return { enviado: false, motivo: 'sem_email' };

  const html = `
    <p>Olá${dono.nome ? `, <b>${escapar(dono.nome)}</b>` : ''}!</p>
    <p>A Meta aprovou os modelos das suas mensagens. <b>A partir de agora, as confirmações,
    lembretes, cancelamentos e remarcações saem pelo número do seu estabelecimento</b> — seus
    clientes passam a receber do número que eles já conhecem.</p>
    <p>Não é preciso configurar nada: a mudança já está valendo.</p>
    <p>Um lembrete importante: as mensagens só vão para quem autorizou receber. Clientes sem
    autorização continuam sendo avisados por e-mail.</p>
    <p><a href="${PAINEL}">Ver no painel</a></p>
  `.trim();

  const r = await enviarEmail(dono.email, 'Seu WhatsApp está liberado — as mensagens já saem pelo seu número', html);
  if (!r?.ok) {
    // Devolve a reivindicação: sem isso, um erro de SMTP faria o dono nunca ser avisado. Um
    // e-mail repetido incomoda; nenhum e-mail faz ele achar que continua bloqueado.
    await executar(
      'UPDATE wa_accounts SET templates_ready_notified_at=NULL WHERE estabelecimento_id=?',
      [estabId]
    ).catch(() => null);
    logger.warn('[wa/templates][aviso-liberado] e-mail falhou', { estabelecimentoId: estabId, erro: r?.error });
    return { enviado: false, motivo: 'email_falhou' };
  }

  logger.info('[wa/templates][aviso-liberado] enviado', { estabelecimentoId: estabId });
  return { enviado: true };
}
