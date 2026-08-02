import test from 'node:test';
import assert from 'node:assert/strict';
import { getActiveHandoff, claimHandoffNotice, TTL_HORAS } from '../src/bot/storage/handoffStore.js';

// O handoff tinha DUAS saidas quebradas, e as duas produziam silencio sem sintoma:
//   1. so fechava se o CLIENTE digitasse "voltar bot" / "menu" / "0" — palavras que ninguem nunca
//      disse a ele. Sem prazo, um handoff aberto calava o robo para sempre naquele par.
//   2. a frase de "atendimento humano em andamento" saia a CADA mensagem da cliente.

function bancoFalso(linhas, { afetadasNoUpdate = 1 } = {}) {
  const chamadas = [];
  return {
    chamadas,
    query: async (sql, params) => {
      const texto = String(sql).replace(/\s+/g, ' ').trim();
      chamadas.push({ sql: texto, params });
      if (/^SELECT/i.test(texto)) return [linhas];
      return [{ affectedRows: afetadasNoUpdate }];
    },
  };
}

test('handoff dentro do prazo continua valendo', async () => {
  const b = bancoFalso([{ id: 7, status: 'open', vencido: 0 }]);
  const r = await getActiveHandoff({ tenantId: 26, fromPhone: '5511999990000' }, { deps: { query: b.query } });
  assert.equal(r.id, 7);
  assert.equal(b.chamadas.length, 1, 'nao deve fechar nada');
});

test('handoff VENCIDO e fechado e devolve null — o robo volta a atender', async () => {
  const b = bancoFalso([{ id: 7, status: 'open', vencido: 1 }]);
  const r = await getActiveHandoff({ tenantId: 26, fromPhone: '5511999990000' }, { deps: { query: b.query } });
  assert.equal(r, null, 'devolver o vencido manteria o mudo permanente');
  const fechou = b.chamadas.find((c) => /UPDATE wa_handoff_queue SET status='closed'/i.test(c.sql));
  assert.ok(fechou, 'o vencido precisa ser FECHADO, nao so ignorado — senao a fila enche de lixo');
  assert.ok(String(fechou.params[0]).startsWith('ttl_'), 'quem fechou fica registrado');
});

test('o prazo entra na consulta e e configuravel', async () => {
  const b = bancoFalso([]);
  await getActiveHandoff({ tenantId: 26, fromPhone: '5511999990000' }, { deps: { query: b.query } });
  assert.match(b.chamadas[0].sql, /created_at < \(NOW\(\) - INTERVAL \? HOUR\)/i);
  assert.equal(b.chamadas[0].params[0], TTL_HORAS);
});

test('sem handoff nenhum devolve null sem tentar fechar', async () => {
  const b = bancoFalso([]);
  assert.equal(await getActiveHandoff({ tenantId: 26, fromPhone: '5511999990000' }, { deps: { query: b.query } }), null);
  assert.equal(b.chamadas.length, 1);
});

test('parametros invalidos nem tocam o banco', async () => {
  let tocou = false;
  const query = async () => { tocou = true; return [[]]; };
  assert.equal(await getActiveHandoff({ tenantId: 0, fromPhone: '551199' }, { deps: { query } }), null);
  assert.equal(await getActiveHandoff({ tenantId: 26, fromPhone: '' }, { deps: { query } }), null);
  assert.equal(tocou, false);
});

// ─── o aviso sai uma vez so ────────────────────────────────────────────────────────────────────

test('a primeira chamada ganha o direito de avisar', async () => {
  const b = bancoFalso([], { afetadasNoUpdate: 1 });
  assert.equal(await claimHandoffNotice(7, { deps: { query: b.query } }), true);
  assert.match(b.chamadas[0].sql, /SET avisado_em=NOW\(3\)/i);
  assert.match(b.chamadas[0].sql, /avisado_em IS NULL/i, 'e o IS NULL que torna a reivindicacao atomica');
});

test('as seguintes NAO avisam — fim da frase repetida a cada mensagem', async () => {
  const b = bancoFalso([], { afetadasNoUpdate: 0 });
  assert.equal(await claimHandoffNotice(7, { deps: { query: b.query } }), false);
});

test('coluna ausente (migracao nao aplicada) avisa em vez de calar', async () => {
  // Degradar para o comportamento antigo e chato; degradar para silencio esconderia do cliente que
  // ha um humano no meio da conversa.
  const query = async () => { const e = new Error('unknown column'); e.errno = 1054; throw e; };
  assert.equal(await claimHandoffNotice(7, { deps: { query } }), true);
});

test('id invalido nao avisa e nao toca o banco', async () => {
  let tocou = false;
  const query = async () => { tocou = true; return [{ affectedRows: 1 }]; };
  assert.equal(await claimHandoffNotice(0, { deps: { query } }), false);
  assert.equal(tocou, false);
});
