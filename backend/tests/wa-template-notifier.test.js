import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyTemplatesUnderReview, maybeNotifyTemplatesReady } from '../src/services/waTemplateNotifier.js';

const SILENCIO = { warn() {}, info() {} };

/**
 * Fake do pool. Despacha pelo formato do SQL porque o notificador faz três coisas diferentes com a
 * mesma função: rearmar/reivindicar (UPDATE) e buscar o dono (SELECT).
 */
function bancoFalso({ afetadas = 1, dono = { nome: 'Studio Bella', email: 'dona@salao.com' } } = {}) {
  const chamadas = [];
  return {
    chamadas,
    query: async (sql, params) => {
      chamadas.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (/^SELECT/i.test(sql)) return [dono ? [dono] : []];
      return [{ affectedRows: afetadas }];
    },
  };
}

const linhas = (...status) => status.map((s, i) => ({
  kind: ['confirm_cli', 'reminder_cli', 'cancel_cli', 'reschedule_cli'][i],
  name: `modelo_${i}_t1`,
  status: s,
  rejected_reason: s === 'REJECTED' ? 'INVALID_FORMAT' : null,
}));

// ─── aviso de análise ──────────────────────────────────────────────────────────────────────────

test('analise: avisa quando ha modelo pendente', async () => {
  const b = bancoFalso();
  let enviado = null;
  const r = await notifyTemplatesUnderReview({
    estabelecimentoId: 186,
    deps: {
      query: b.query,
      listTenantTemplateRows: async () => linhas('PENDING', 'PENDING', 'PENDING', 'PENDING'),
      notifyEmail: async (to, subject, html) => { enviado = { to, subject, html }; return { ok: true }; },
      logger: SILENCIO,
    },
  });
  assert.equal(r.enviado, true);
  assert.equal(enviado.to, 'dona@salao.com');
  assert.match(enviado.html, /continuam saindo\s*\n?\s*por e-mail/i, 'precisa dizer que o aviso vai por e-mail nesse meio-tempo');
  assert.match(enviado.html, /nenhum agendamento deixa de ser confirmado/i);
});

test('analise: NAO avisa quem reconectou com tudo ja aprovado', async () => {
  // Reconexao de um salao que ja funcionava: mandar "esta em analise" faria ele achar que voltou
  // para a fila do zero.
  const b = bancoFalso();
  let enviou = false;
  const r = await notifyTemplatesUnderReview({
    estabelecimentoId: 186,
    deps: {
      query: b.query,
      listTenantTemplateRows: async () => linhas('APPROVED', 'APPROVED', 'APPROVED', 'APPROVED'),
      notifyEmail: async () => { enviou = true; return { ok: true }; },
      logger: SILENCIO,
    },
  });
  assert.equal(r.motivo, 'ja_liberado');
  assert.equal(enviou, false);
});

test('analise: sem nenhuma linha nao inventa aviso', async () => {
  const b = bancoFalso();
  const r = await notifyTemplatesUnderReview({
    estabelecimentoId: 186,
    deps: { query: b.query, listTenantTemplateRows: async () => [], notifyEmail: async () => ({ ok: true }), logger: SILENCIO },
  });
  assert.equal(r.motivo, 'sem_modelos');
});

test('analise: rearma o aviso de liberacao ANTES de tudo', async () => {
  // Se o rearme dependesse do e-mail dar certo, uma falha de SMTP na conexao deixaria o dono sem o
  // aviso de liberacao tambem — dois silencios pelo preco de um.
  const b = bancoFalso();
  await notifyTemplatesUnderReview({
    estabelecimentoId: 186,
    deps: {
      query: b.query,
      listTenantTemplateRows: async () => linhas('PENDING', 'PENDING', 'PENDING', 'PENDING'),
      notifyEmail: async () => ({ ok: false, error: 'smtp_down' }),
      logger: SILENCIO,
    },
  });
  const rearme = b.chamadas[0];
  assert.match(rearme.sql, /templates_ready_notified_at=NULL/i);
  assert.deepEqual(rearme.params, [186]);
});

test('analise: modelo recusado aparece com o motivo', async () => {
  const b = bancoFalso();
  let html = '';
  await notifyTemplatesUnderReview({
    estabelecimentoId: 186,
    deps: {
      query: b.query,
      listTenantTemplateRows: async () => linhas('APPROVED', 'REJECTED', 'PENDING', 'PENDING'),
      notifyEmail: async (_to, _s, corpo) => { html = corpo; return { ok: true }; },
      logger: SILENCIO,
    },
  });
  assert.match(html, /recusado/i);
  assert.match(html, /INVALID_FORMAT/);
  assert.match(html, /liberado/i, 'o que ja passou tem de aparecer como liberado');
});

// ─── aviso de liberacao ────────────────────────────────────────────────────────────────────────

test('liberacao: avisa quando os quatro estao aprovados', async () => {
  const b = bancoFalso();
  let enviado = null;
  const r = await maybeNotifyTemplatesReady({
    estabelecimentoId: 186,
    deps: {
      query: b.query,
      listTenantTemplateRows: async () => linhas('APPROVED', 'APPROVED', 'APPROVED', 'APPROVED'),
      notifyEmail: async (to, subject, html) => { enviado = { to, subject, html }; return { ok: true }; },
      logger: SILENCIO,
    },
  });
  assert.equal(r.enviado, true);
  assert.match(enviado.html, /pelo número do seu estabelecimento/i);
  assert.match(enviado.html, /só vão para quem autorizou/i, 'o opt-in continua valendo e o dono precisa saber');
});

test('liberacao: um pendente basta para nao avisar', async () => {
  const b = bancoFalso();
  let enviou = false;
  const r = await maybeNotifyTemplatesReady({
    estabelecimentoId: 186,
    deps: {
      query: b.query,
      listTenantTemplateRows: async () => linhas('APPROVED', 'APPROVED', 'APPROVED', 'PENDING'),
      notifyEmail: async () => { enviou = true; return { ok: true }; },
      logger: SILENCIO,
    },
  });
  assert.equal(r.motivo, 'ainda_nao_liberado');
  assert.equal(enviou, false);
});

test('liberacao: a reivindicacao e atomica — quem perde nao manda e-mail', async () => {
  // Os quatro vereditos podem chegar juntos. Sem a reivindicacao, todos veriam "todos aprovados".
  const b = bancoFalso({ afetadas: 0 });
  let enviou = false;
  const r = await maybeNotifyTemplatesReady({
    estabelecimentoId: 186,
    deps: {
      query: b.query,
      listTenantTemplateRows: async () => linhas('APPROVED', 'APPROVED', 'APPROVED', 'APPROVED'),
      notifyEmail: async () => { enviou = true; return { ok: true }; },
      logger: SILENCIO,
    },
  });
  assert.equal(r.motivo, 'ja_avisado');
  assert.equal(enviou, false);
  const claim = b.chamadas.find((c) => /SET templates_ready_notified_at=NOW/i.test(c.sql));
  assert.match(claim.sql, /templates_ready_notified_at IS NULL/i, 'a condicao IS NULL e o que torna a reivindicacao atomica');
  assert.match(claim.sql, /status='connected'/i, 'nao faz sentido avisar quem desconectou');
});

test('liberacao: e-mail falhou devolve a reivindicacao para poder tentar de novo', async () => {
  const b = bancoFalso();
  const r = await maybeNotifyTemplatesReady({
    estabelecimentoId: 186,
    deps: {
      query: b.query,
      listTenantTemplateRows: async () => linhas('APPROVED', 'APPROVED', 'APPROVED', 'APPROVED'),
      notifyEmail: async () => ({ ok: false, error: 'smtp_down' }),
      logger: SILENCIO,
    },
  });
  assert.equal(r.motivo, 'email_falhou');
  const devolucao = b.chamadas.filter((c) => /templates_ready_notified_at=NULL/i.test(c.sql));
  assert.equal(devolucao.length, 1, 'sem devolver, um erro de SMTP silencia o aviso para sempre');
});

test('liberacao: sem e-mail cadastrado nao quebra', async () => {
  const b = bancoFalso({ dono: null });
  const r = await maybeNotifyTemplatesReady({
    estabelecimentoId: 186,
    deps: {
      query: b.query,
      listTenantTemplateRows: async () => linhas('APPROVED', 'APPROVED', 'APPROVED', 'APPROVED'),
      notifyEmail: async () => ({ ok: true }),
      logger: SILENCIO,
    },
  });
  assert.equal(r.motivo, 'sem_email');
});

test('ambos: sem estabelecimento nem tocam o banco', async () => {
  let tocou = false;
  const query = async () => { tocou = true; return [[]]; };
  assert.equal((await notifyTemplatesUnderReview({ estabelecimentoId: 0, deps: { query } })).enviado, false);
  assert.equal((await maybeNotifyTemplatesReady({ estabelecimentoId: null, deps: { query } })).enviado, false);
  assert.equal(tocou, false);
});
