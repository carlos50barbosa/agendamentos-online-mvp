// "MEUS AGENDAMENTOS <código>" — a prova de posse que substitui o OTP.
//
// O que está travado aqui é a fronteira, não a mecânica: o código só vale uma vez, só vale
// pendente, só vale no prazo, e a mensagem NÃO pode virar consentimento de WhatsApp. Esse último é
// o que a WABA desta plataforma já pagou caro duas vezes: consentimento deduzido de gesto ambíguo.
// Pedir para ver a própria agenda não é autorizar lembretes — quem autoriza é o AUTORIZO.
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET ??= 'test-secret';
process.env.WA_PUBLIC_NUMBER ??= '5511911451733';

import {
  buildLinkMessage,
  buildWaLink,
  confirmLinkRequestByCode,
  consumeConfirmedLinkRequest,
  createLinkRequest,
  extractLinkCodeCandidates,
  generateLinkCode,
  hashLinkCode,
} from '../src/lib/wa_link_requests.js';
import { handleInboundAppointmentsLink } from '../src/whatsapp/inbound/appointmentsLink.js';

/* ───────────────────────── código e link ───────────────────────── */

test('o código evita caracteres ambíguos (I, O, 0, 1)', () => {
  // A pessoa às vezes redigita à mão: o wa.me abre sem o texto pronto em navegador embutido.
  for (let i = 0; i < 200; i += 1) {
    const code = generateLinkCode();
    assert.equal(code.length, 8);
    assert.equal(/[IO01]/.test(code), false, `código com caractere ambíguo: ${code}`);
  }
});

test('extrai o código de texto livre, em qualquer caixa e com a frase junto', () => {
  const code = 'A2B3C4D5';
  assert.deepEqual(extractLinkCodeCandidates(`MEUS AGENDAMENTOS ${code}`), [code]);
  assert.deepEqual(extractLinkCodeCandidates(`meus agendamentos ${code.toLowerCase()}`), [code]);
  assert.deepEqual(extractLinkCodeCandidates(`oi, é ${code}.`), [code]);
  assert.deepEqual(extractLinkCodeCandidates('bom dia'), []);
});

test('o link wa.me aponta para o número que RECEBE as mensagens', () => {
  const link = buildWaLink('A2B3C4D5');
  assert.ok(link.startsWith('https://wa.me/5511911451733?text='));
  assert.ok(decodeURIComponent(link.split('text=')[1]).includes('MEUS AGENDAMENTOS A2B3C4D5'));
  // Sem número configurado não existe link: devolver um quebrado deixaria a aba esperando para
  // sempre, sem dizer por quê.
  assert.equal(buildWaLink('A2B3C4D5', {}), null);
});

/* ───────────────────────── ciclo de vida do pedido ───────────────────────── */

// Banco de mentira com a semântica que importa: UPDATE condicional devolve affectedRows.
function fakeDb() {
  const rows = [];
  return {
    rows,
    async query(sql, params) {
      const text = String(sql);
      if (text.includes('INSERT INTO wa_link_requests')) {
        rows.push({
          id: rows.length + 1,
          request_id: params[0],
          code_hash: params[1],
          expires_at: params[2],
          telefone_e164: null,
          wamid: null,
          confirmado_em: null,
          consumido_em: null,
        });
        return [{ insertId: rows.length }, []];
      }
      if (text.includes('UPDATE wa_link_requests') && text.includes('confirmado_em = NOW()')) {
        const [phone, wamid, codeHash] = params;
        const row = rows.find((r) => r.code_hash === codeHash
          && !r.confirmado_em
          && new Date(r.expires_at).getTime() > Date.now());
        if (!row) return [{ affectedRows: 0 }, []];
        row.telefone_e164 = phone;
        row.wamid = wamid;
        row.confirmado_em = new Date();
        return [{ affectedRows: 1 }, []];
      }
      if (text.includes('SELECT id, telefone_e164')) {
        const row = rows.find((r) => r.request_id === params[0]);
        return [row ? [row] : [], []];
      }
      if (text.includes('SET consumido_em = NOW()')) {
        const row = rows.find((r) => r.id === params[0] && !r.consumido_em);
        if (!row) return [{ affectedRows: 0 }, []];
        row.consumido_em = new Date();
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`SQL inesperado: ${text.slice(0, 100)}`);
    },
  };
}

test('pedido -> mensagem recebida -> token, uma vez só', async () => {
  const db = fakeDb();
  const { requestId, code } = await createLinkRequest({ db });

  assert.equal((await consumeConfirmedLinkRequest({ requestId, db })).status, 'pending');

  const confirm = await confirmLinkRequestByCode({ code, phoneE164: '5511999999999', wamid: 'wamid.X', db });
  assert.equal(confirm.ok, true);
  assert.equal(confirm.phone, '5511999999999');

  const consumed = await consumeConfirmedLinkRequest({ requestId, db });
  assert.equal(consumed.status, 'confirmed');
  assert.equal(consumed.phone, '5511999999999');

  // Segunda leitura não vale: sem isto, quem guardasse a URL do polling reabriria o acesso depois,
  // sem nova prova de posse.
  assert.equal((await consumeConfirmedLinkRequest({ requestId, db })).status, 'used');
});

test('o mesmo código não confirma duas vezes', async () => {
  const db = fakeDb();
  const { code } = await createLinkRequest({ db });
  assert.equal((await confirmLinkRequestByCode({ code, phoneE164: '5511999999999', db })).ok, true);
  // Segunda mensagem igual (reenvio, ou alguém que copiou o texto) não sequestra o pedido.
  const second = await confirmLinkRequestByCode({ code, phoneE164: '5521888888888', db });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'not_found_or_used');
});

test('código expirado não confirma', async () => {
  const db = fakeDb();
  const { code } = await createLinkRequest({ db });
  db.rows[0].expires_at = new Date(Date.now() - 1000);
  assert.equal((await confirmLinkRequestByCode({ code, phoneE164: '5511999999999', db })).ok, false);
});

test('hashLinkCode é estável e ignora caixa e espaços', () => {
  assert.equal(hashLinkCode('a2b3c4d5'), hashLinkCode(' A2B3C4D5 '));
  assert.notEqual(hashLinkCode('A2B3C4D5'), hashLinkCode('A2B3C4D6'));
});

/* ───────────────────────── handler de inbound ───────────────────────── */

function inboundDeps(db, extra = {}) {
  const calls = { inbound: [] };
  return {
    calls,
    deps: {
      pool: db,
      recordWhatsAppInbound: async (arg) => { calls.inbound.push(arg); },
      logger: { warn() {}, error() {} },
      ...extra,
    },
  };
}

test('mensagem com código válido confirma e consome o turno', async () => {
  const db = fakeDb();
  const { requestId, code } = await createLinkRequest({ db });
  const { calls, deps } = inboundDeps(db);

  const res = await handleInboundAppointmentsLink({
    phoneNumberId: '123',
    value: {},
    message: { from: '5511999999999', id: 'wamid.ABC', type: 'text', text: { body: buildLinkMessage(code) } },
    deps,
  });

  assert.equal(res.handled, true);
  // A janela de 24h passa a existir por causa da mensagem dela; quem grava isso é este handler,
  // porque ele corta o fluxo principal do webhook ao devolver handled:true.
  assert.equal(calls.inbound.length, 1);
  assert.equal((await consumeConfirmedLinkRequest({ requestId, db })).phone, '5511999999999');
});

test('texto sem código não é consumido — o bot continua atendendo', async () => {
  const db = fakeDb();
  const { deps, calls } = inboundDeps(db);
  const res = await handleInboundAppointmentsLink({
    phoneNumberId: '123',
    value: {},
    message: { from: '5511999999999', id: 'wamid.ABC', type: 'text', text: { body: 'quero marcar um horário' } },
    deps,
  });
  assert.equal(res.handled, false);
  assert.equal(calls.inbound.length, 0);
});

test('oito maiúsculas que não são um pedido real não consomem o turno', async () => {
  // O regex é lenient de propósito; quem decide é o banco. Se um "BOMBOMBO" qualquer devolvesse
  // handled:true, ele engoliria a mensagem e o bot ficaria mudo.
  const db = fakeDb();
  const { deps } = inboundDeps(db);
  const res = await handleInboundAppointmentsLink({
    phoneNumberId: '123',
    value: {},
    message: { from: '5511999999999', id: 'wamid.ABC', type: 'text', text: { body: 'ATENDEUX' } },
    deps,
  });
  assert.equal(res.handled, false);
});

test('confirmar a lista NÃO grava consentimento de WhatsApp', async () => {
  // A asserção mais importante do arquivo. Se alguém "melhorar" isto ligando o opt-in aqui, a
  // pessoa passa a receber lembretes por ter pedido para ver a agenda — e foi assim que a conta
  // caiu. O handler nem importa grantWhatsAppConsent; este teste trava a intenção.
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync('src/whatsapp/inbound/appointmentsLink.js', 'utf8'));
  assert.equal(/grantWhatsAppConsent|whatsapp_consent/.test(source), false);
});
