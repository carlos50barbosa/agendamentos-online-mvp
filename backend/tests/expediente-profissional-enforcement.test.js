// ENFORCEMENT do horario por profissional: da REGRA para as QUATRO ROTAS.
//
// Por que este arquivo existe: intersectExpediente/getExpediente ja sao provados em
// tests/expediente-intersect.test.js, e o writer da coluna em tests/horarios-profissional.test.js.
// Nenhum dos dois toca numa ROTA. Enquanto os 4 caminhos de escrita nao passarem o
// profissionalId para getExpediente, a dona marca a folga da profissional, a tela mostra
// "salvo", e o POST continua aceitando — sem erro, sem log, sem teste vermelho. E o mesmo
// desfecho que deixou o bloqueio de agenda COSMETICO (ver o cabecalho de agenda-bloqueios.test.js).
//
// Os 4 sitios, cada um com o `getExpediente` que precisa receber o profissional:
//   src/routes/agendamentos.js:753          POST /agendamentos                  (profissional_id do corpo)
//   src/routes/agendamentos.js:1562         POST /agendamentos/estabelecimento  (profissional_id do corpo)
//   src/routes/agendamentos.js:2074         PUT  /agendamentos/:id/reschedule-estab (ag.profissional_id, do BANCO)
//   src/routes/agendamentos_public.js:806   POST /public/agendamentos           (profissional_id do corpo)
//
// TRES CENARIOS POR SITIO, e os tres importam. Um teste com so o cenario A passa por acidente
// no dia em que a rota recusar por qualquer outro motivo (slot ocupado, bloqueio, limite de
// plano, assinatura, data no passado):
//   A) salao 08-18, profissional 08-12, pedido 14:00 -> 400 outside_business_hours "(08:00-12:00)"
//   B) salao 08-12, profissional 08-12, pedido 14:00 -> 400 outside_business_hours "(08:00-18:00)"?
//      NAO: "(08:00-12:00)" tambem — aqui quem recusa e o SALAO. B existe para provar que o gate
//      esta vivo mesmo sem a Fase 2, entao ele passa HOJE.
//   C) salao 08-18, profissional 08-12, pedido 10:00 -> NAO pode ser outside_business_hours.
//      E o contrafactual: sem ele, um bug que fechasse a agenda inteira faria A passar.
//
// A ASSERCAO E NA MENSAGEM, nao so no codigo de erro. formatExpedienteMessage imprime
// `abre-fecha` do expediente EFETIVO: "(08:00-12:00)" so pode ter vindo da intersecao com o
// horario da profissional; "(08:00-18:00)" e o salao sozinho, ou seja, a Fase 2 nao chegou.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET ||= 'secret';
process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_PASS ||= 'test';
process.env.DB_NAME ||= 'test';

const { pool } = await import('../src/lib/db.js');
const { EST_TZ_OFFSET_MIN, makeUtcFromLocalYMDHM } = await import('../src/lib/datetime_tz.js');
const agendamentosRouter = (await import('../src/routes/agendamentos.js')).default;
const publicRouter = (await import('../src/routes/agendamentos_public.js')).default;

const ESTAB_ID = 9001;
const CLIENTE_ID = 9002;
const PROF_ID = 9003;
const SERVICO_ID = 9004;
const AGENDAMENTO_ID = 9100;

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

// Horario de todos os 7 dias, para o teste nao mudar de resultado conforme o dia da semana em
// que ele roda — o mesmo motivo do FUTURE_WEEK_START fixo em agenda-bloqueios.test.js.
const semanaToda = (start, end) =>
  JSON.stringify(
    ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      .map((day) => ({ day, start, end }))
  );

// --------------------------------------------------------------------------------------
// O instante de teste NUNCA sai de `new Date().setHours()`.
//
// setHours usa o fuso do PROCESSO; o app trabalha com America/Sao_Paulo fixo em UTC-3
// (EST_TZ_OFFSET_MIN = -180). No runner do CI, que roda em UTC, `setHours(14)` vira 11:00 em
// Sao Paulo — DENTRO da janela 08:00-12:00 da profissional. O teste ficaria verde na maquina
// do autor e verde no CI pelo motivo errado. Verificado: TZ=UTC muda o resultado.
// --------------------------------------------------------------------------------------
function amanhaNaHoraLocal(hora) {
  const amanhaLocal = new Date(Date.now() + 24 * 3600 * 1000 + EST_TZ_OFFSET_MIN * 60_000);
  return makeUtcFromLocalYMDHM(
    amanhaLocal.getUTCFullYear(),
    amanhaLocal.getUTCMonth() + 1,
    amanhaLocal.getUTCDate(),
    hora,
    0,
    EST_TZ_OFFSET_MIN
  );
}

// --------------------------------------------------------------------------------------
// Mock de pool ESTRITO. SQL que ninguem previu LANCA, em vez de devolver [].
//
// E a mesma disciplina de agenda-bloqueios.test.js:807 e :994, e ela e o que impede o teste
// de passar por acidente: uma query nova inserida ANTES do gate de expediente (por exemplo um
// guard que passe a recusar por outro motivo) explode aqui, em vez de virar `[]` silencioso e
// deixar a rota recusar pelo motivo errado com o mesmo status 400.
// --------------------------------------------------------------------------------------
function installPoolMock({ salao, profissional }) {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  const contadores = { horariosProfissional: 0, insertAgendamento: 0, updateInicio: 0 };
  const cauda = [];       // queries que so acontecem DEPOIS do gate
  let passouDoGate = false;

  const usuario = (id) => (id === ESTAB_ID
    ? { id: ESTAB_ID, nome: 'Salao', email: 'estab@t.local', telefone: '11999990000', tipo: 'estabelecimento', plan: 'premium', plan_status: 'active' }
    : { id: CLIENTE_ID, nome: 'Cliente', email: 'cli@t.local', telefone: '11988887777', tipo: 'cliente', plan: 'starter', plan_status: 'active' });

  const handle = async (sql, params = []) => {
    const statement = normalizeSql(sql);
    const low = statement.toLowerCase();

    // --- 1. auth (middleware/auth.js:49) ---
    if (/^select id, nome, email, telefone, .*onboarding_etapa from usuarios where id=\?/i.test(statement)) {
      return [[usuario(Number(params[0]))], []];
    }
    // --- 2. plano (lib/plans.js:234) — usado pelo middleware de assinatura E pela rota ---
    if (/^select plan, plan_status, .* from usuarios where id=\? and tipo='estabelecimento'/i.test(statement)) {
      return [[{ plan: 'premium', plan_status: 'active', plan_trial_ends_at: null, plan_active_until: null, plan_subscription_id: null, plan_cycle: 'mensal' }], []];
    }
    // --- 3. assinatura (lib/subscriptions.js:135). Zero linhas + plan_status 'active' no
    //        usuario ja fazem computeSubscriptionState devolver coreFeaturesAllowed=true. ---
    if (/from\s+subscriptions/i.test(statement)) return [[], []];
    // --- 4. servicos do agendamento ---
    if (/^select id, nome, duracao_min, preco_centavos, capacidade_por_horario from servicos/i.test(statement)) {
      return [[{ id: SERVICO_ID, nome: 'Corte', duracao_min: 30, preco_centavos: 5000, capacidade_por_horario: null }], []];
    }
    // --- 5. vinculo servico<->profissional ---
    if (/from\s+servico_profissionais/i.test(statement)) {
      return [[{ servico_id: SERVICO_ID, profissional_id: PROF_ID }], []];
    }
    // --- 6. O SELECT DA FASE 3 (expediente.js:531). E ESTE que a Fase 2 tem de disparar. ---
    if (/from\s+profissionais/i.test(statement) && /horarios_json/i.test(statement)) {
      contadores.horariosProfissional += 1;
      return [[{ horarios_json: profissional }], []];
    }
    // --- 7. profissional existe / ativo / e deste salao ---
    if (/from\s+profissionais/i.test(statement)) {
      return [[{ id: PROF_ID, nome: 'Bruna', avatar_url: null, ativo: 1 }], []];
    }
    // --- 8. expediente do salao (expediente.js:495) ---
    if (/from\s+estabelecimento_perfis/i.test(statement)) {
      return [[{ horarios_json: salao }], []];
    }
    // --- 9. o agendamento a remarcar (agendamentos.js:1997) ---
    if (/^select id, cliente_id, servico_id, profissional_id, status, inicio from agendamentos/i.test(statement)) {
      return [[{
        id: AGENDAMENTO_ID, cliente_id: CLIENTE_ID, servico_id: SERVICO_ID,
        // Aqui o profissional vem do BANCO, nao do corpo: e este valor que a Fase 2 precisa
        // normalizar (NULL -> null; numero -> Number). Uma string faz getExpediente lancar.
        profissional_id: PROF_ID, status: 'confirmado',
        inicio: new Date(Date.now() + 48 * 3600 * 1000),
      }], []];
    }
    if (/from\s+agendamento_itens ai/i.test(statement)) {
      return [[{ agendamento_id: AGENDAMENTO_ID, servico_id: SERVICO_ID, ordem: 1, duracao_min: 30, preco_snapshot: 5000, servico_nome: 'Corte' }], []];
    }
    // --- 10. janela de agendamento (lib/janela_agendamento.js). A rota PUBLICA resolve isto
    //         ANTES do gate (agendamentos_public.js:752). Linha ausente = modo 'livre' = sem
    //         horizonte; o horizonte tem cobertura propria em tests/janela-agendamento.test.js.
    if (/from\s+establishment_settings/i.test(statement)) return [[], []];

    // ------------------------------------------------------------------------------------
    // CAUDA: tudo que so roda DEPOIS do gate de expediente. Nos cenarios A e B a rota tem de
    // morrer antes de chegar aqui — o teste assere `cauda.length === 0`, que e a prova de que
    // a recusa veio do expediente e nao de um guard mais adiante (bloqueio, capacidade, limite).
    // ------------------------------------------------------------------------------------
    passouDoGate = true;
    cauda.push(statement.slice(0, 80));
    if (low.startsWith('insert into agendamentos')) { contadores.insertAgendamento += 1; return [{ insertId: AGENDAMENTO_ID, affectedRows: 1 }, []]; }
    if (low.startsWith('update agendamentos set inicio=')) { contadores.updateInicio += 1; return [{ affectedRows: 1 }, []]; }
    if (low.startsWith('insert into')) return [{ insertId: 1, affectedRows: 1 }, []];
    if (low.startsWith('update')) return [{ affectedRows: 1 }, []];
    if (/^select \* from agendamentos where id=\?/i.test(statement)) {
      return [[{ id: AGENDAMENTO_ID, cliente_id: CLIENTE_ID, estabelecimento_id: ESTAB_ID, servico_id: SERVICO_ID, profissional_id: PROF_ID, inicio: new Date(), fim: new Date(), status: 'confirmado', total_centavos: 5000 }], []];
    }
    // Busca de cliente por e-mail/telefone no painel: ZERO linhas, senao a rota devolve 409
    // "ja existe cliente com este e-mail" e o cenario C falharia por um motivo que nada tem a
    // ver com expediente — exatamente o falso-vermelho que este arquivo precisa evitar.
    if (/from\s+usuarios where (lower\(email\)|telefone)=/i.test(statement)) return [[], []];
    if (/from\s+usuarios/i.test(statement)) return [[usuario(Number(params[0]))], []];
    return [[], []];
  };

  pool.query = handle;
  pool.execute = handle;
  pool.getConnection = async () => ({
    query: handle,
    execute: handle,
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  });

  return {
    contadores,
    cauda,
    get passouDoGate() { return passouDoGate; },
    restore() { pool.query = originalQuery; pool.getConnection = originalGetConnection; },
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use('/agendamentos', agendamentosRouter);
  app.use('/public/agendamentos', publicRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const tokenDe = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '15m' });

async function call(baseUrl, { method, path: p, body, token }) {
  const response = await fetch(`${baseUrl}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* corpo nao-JSON = 500 cru; o assert mostra o texto */ }
  return { status: response.status, error: json?.error ?? null, message: json?.message ?? text.slice(0, 200) };
}

// Os quatro sitios, cada um como uma requisicao pronta a partir de um instante.
const SITIOS = [
  {
    nome: 'POST /agendamentos (cliente)',
    ref: 'src/routes/agendamentos.js:753',
    pedido: (inicio) => ({ method: 'POST', path: '/agendamentos', token: tokenDe(CLIENTE_ID),
      body: { estabelecimento_id: ESTAB_ID, servico_ids: [SERVICO_ID], profissional_id: PROF_ID, inicio } }),
  },
  {
    nome: 'POST /agendamentos/estabelecimento (painel)',
    ref: 'src/routes/agendamentos.js:1562',
    pedido: (inicio) => ({ method: 'POST', path: '/agendamentos/estabelecimento', token: tokenDe(ESTAB_ID),
      body: { servico_ids: [SERVICO_ID], profissional_id: PROF_ID, inicio, nome: 'Cliente Novo', email: 'novo@t.local', telefone: '11988887777' } }),
  },
  {
    nome: 'PUT /agendamentos/:id/reschedule-estab (remarcar)',
    ref: 'src/routes/agendamentos.js:2074',
    pedido: (inicio) => ({ method: 'PUT', path: `/agendamentos/${AGENDAMENTO_ID}/reschedule-estab`, token: tokenDe(ESTAB_ID),
      body: { inicio } }),
  },
  {
    nome: 'POST /public/agendamentos (bot e link publico)',
    ref: 'src/routes/agendamentos_public.js:806',
    pedido: (inicio) => ({ method: 'POST', path: '/public/agendamentos', token: null,
      body: { estabelecimento_id: ESTAB_ID, servico_ids: [SERVICO_ID], profissional_id: PROF_ID, inicio, nome: 'Cliente Publico', email: 'pub@t.local', telefone: '11988887777' } }),
  },
];

for (const sitio of SITIOS) {
  // ---------------------------------------------------------------------------------
  // A) O TESTE QUE IMPORTA. Vermelho ate a Fase 2 existir.
  // ---------------------------------------------------------------------------------
  test(`${sitio.nome} recusa horario fora do expediente DA PROFISSIONAL (${sitio.ref})`, async () => {
    const mock = installPoolMock({ salao: semanaToda('08:00', '18:00'), profissional: semanaToda('08:00', '12:00') });
    const server = await startServer();
    try {
      const res = await call(server.baseUrl, sitio.pedido(amanhaNaHoraLocal(14).toISOString()));

      assert.equal(res.status, 400, `esperado 400, veio ${res.status}: ${res.message}`);
      assert.equal(res.error, 'outside_business_hours');
      // A prova de QUAL janela recusou. "(08:00-18:00)" = so o salao foi consultado.
      assert.match(res.message, /08:00-12:00/, `a recusa citou a janela errada: ${res.message}`);
      // A rota nem chegou nos guards seguintes: nada de "recusou por bloqueio/capacidade".
      assert.deepEqual(mock.cauda, [], `a rota passou do gate de expediente: ${mock.cauda.join(' | ')}`);
      assert.equal(mock.contadores.insertAgendamento, 0);
      assert.equal(mock.contadores.updateInicio, 0);
      // E leu a coluna da Fase 3 — sem isto o 400 acima veio de outro lugar.
      assert.equal(mock.contadores.horariosProfissional, 1, 'profissionais.horarios_json nao foi consultado');
    } finally {
      await server.close();
      mock.restore();
    }
  });

  // ---------------------------------------------------------------------------------
  // B) O gate esta VIVO. Passa hoje; existe para que uma quebra do enforcement do salao
  //    nao seja confundida com "a Fase 2 ainda nao chegou".
  // ---------------------------------------------------------------------------------
  test(`${sitio.nome} continua recusando fora do expediente do SALAO (${sitio.ref})`, async () => {
    const mock = installPoolMock({ salao: semanaToda('08:00', '12:00'), profissional: semanaToda('08:00', '12:00') });
    const server = await startServer();
    try {
      const res = await call(server.baseUrl, sitio.pedido(amanhaNaHoraLocal(14).toISOString()));
      assert.equal(res.status, 400, `esperado 400, veio ${res.status}: ${res.message}`);
      assert.equal(res.error, 'outside_business_hours');
      assert.deepEqual(mock.cauda, []);
    } finally {
      await server.close();
      mock.restore();
    }
  });

  // ---------------------------------------------------------------------------------
  // C) O CONTRAFACTUAL. Mesmo fixture, hora DENTRO das duas janelas: nao pode recusar por
  //    expediente. Sem este, um bug que fechasse tudo faria (A) passar.
  // ---------------------------------------------------------------------------------
  test(`${sitio.nome} aceita horario dentro das duas janelas (${sitio.ref})`, async () => {
    const mock = installPoolMock({ salao: semanaToda('08:00', '18:00'), profissional: semanaToda('08:00', '12:00') });
    const server = await startServer();
    try {
      const res = await call(server.baseUrl, sitio.pedido(amanhaNaHoraLocal(10).toISOString()));
      assert.notEqual(res.error, 'outside_business_hours', `recusou por expediente as 10:00: ${res.message}`);
      assert.ok(res.status < 400, `esperado sucesso, veio ${res.status}: ${res.message}`);
      assert.ok(mock.passouDoGate, 'a requisicao nem chegou a passar do gate');
    } finally {
      await server.close();
      mock.restore();
    }
  });
}

// =======================================================================================
// GUARDA ESTATICA: o quinto sitio nao pode nascer aberto.
//
// Os testes acima provam os QUATRO caminhos que existem hoje. Eles nao dizem nada sobre o
// quinto — e o modo de falha real desta base nao e "alguem escreveu o gate errado", e sim
// "alguem criou um caminho novo copiando um handler e esqueceu uma linha". Foi assim que o
// bloqueio de agenda ficou cosmetico: a regra existia, os caminhos de escrita e que nao a
// consultavam.
//
// Esta guarda le o PROPRIO FONTE e falha se qualquer chamada de getExpediente em src/routes/
// nao passar profissionalId. Custa ~40 linhas e cobre mais do que centralizar o enforcement
// cobriria, porque pega tambem um sitio novo que nao passe pelos gargalos conhecidos.
//
// Se um dia existir chamada legitima sem profissional, a correcao NAO e apagar este teste: e
// passar `profissionalId: null` explicito, que documenta a intencao e mantem a guarda viva.
// =======================================================================================

const ROUTES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes');

// Recorta o objeto literal de cada `getExpediente({ ... })` contando chaves, em vez de regex
// preguicosa: um `.*?` pararia na primeira `}` aninhada e leria o argumento pela metade.
function chamadasDeGetExpediente(source) {
  const chamadas = [];
  const marcador = 'getExpediente({';
  let indice = source.indexOf(marcador);
  while (indice !== -1) {
    let profundidade = 0;
    let fim = indice + marcador.length - 1;
    for (let i = fim; i < source.length; i += 1) {
      if (source[i] === '{') profundidade += 1;
      else if (source[i] === '}') {
        profundidade -= 1;
        if (profundidade === 0) { fim = i; break; }
      }
    }
    chamadas.push({
      linha: source.slice(0, indice).split('\n').length,
      argumento: source.slice(indice, fim + 1),
    });
    indice = source.indexOf(marcador, fim);
  }
  return chamadas;
}

test('GUARDA: toda chamada de getExpediente em src/routes passa profissionalId', () => {
  const arquivos = fs.readdirSync(ROUTES_DIR).filter((nome) => nome.endsWith('.js'));
  const semProfissional = [];
  let total = 0;

  for (const nome of arquivos) {
    const source = fs.readFileSync(path.join(ROUTES_DIR, nome), 'utf8');
    for (const chamada of chamadasDeGetExpediente(source)) {
      total += 1;
      if (!/\bprofissionalId\s*:/.test(chamada.argumento)) {
        semProfissional.push(`src/routes/${nome}:${chamada.linha}`);
      }
    }
  }

  assert.equal(
    semProfissional.length,
    0,
    `chamada de getExpediente sem profissionalId (agenda aberta em silencio):\n  ${semProfissional.join('\n  ')}`
  );
  // Se este numero cair, um caminho de escrita perdeu o gate inteiro — o que os testes de rota
  // acima nao pegariam, porque eles so exercitam as rotas que ja conhecem.
  assert.equal(total, 4, `esperado 4 gates de expediente em src/routes, encontrados ${total}`);
});
