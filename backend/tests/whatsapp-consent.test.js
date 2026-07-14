// Consentimento de WhatsApp — as garantias que não dependem de banco.
//
// Contexto: a WABA da plataforma foi desabilitada pela Meta. Passamos a exigir opt-in registrado
// antes de qualquer mensagem iniciada pelo negócio. Este arquivo trava as duas coisas que, se
// quebrarem em silêncio, invalidam o consentimento inteiro:
//
//   1. o texto que a pessoa LÊ tem de ser o texto que o servidor GUARDA;
//   2. o "PARAR" tem de ser reconhecido — e só ele.
//
// Rodar: node --test tests/whatsapp-consent.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONSENT_VERSION as BACKEND_VERSION,
  WA_SENDER_NAME as BACKEND_SENDER,
  buildConsentText as backendText,
} from '../src/lib/whatsapp_consent_text.js';

import {
  CONSENT_VERSION as FRONTEND_VERSION,
  WA_SENDER_NAME as FRONTEND_SENDER,
  buildConsentText as frontendText,
} from '../../frontend/src/utils/whatsappConsent.js';

import { isOptOutText } from '../src/whatsapp/inbound/optOut.js';

// --- 1. O espelho: o que a tela mostra é o que o banco guarda -----------------------------------
//
// O backend renderiza e persiste o texto (o cliente HTTP não pode forjá-lo); o frontend renderiza
// o que a pessoa lê. Se divergirem, o registro deixa de provar o que foi mostrado — e uma prova
// que não bate com a realidade é pior do que nenhuma prova.

test('o texto do aceite é IDÊNTICO no frontend e no backend', () => {
  const casos = [
    { establishmentName: 'Studio Dihcampos' },
    { establishmentName: 'Salão da Ana & Cia.' },
    { establishmentName: '' },        // sem nome: a frase ainda tem de fechar
    {},                                // sem argumento nenhum
    undefined,                         // chamada sem objeto
  ];
  for (const caso of casos) {
    assert.equal(
      frontendText(caso),
      backendText(caso),
      `divergiu para ${JSON.stringify(caso)} — a tela mostraria uma frase e o banco guardaria outra`
    );
  }
});

test('frontend e backend concordam na versão e no nome do remetente', () => {
  assert.equal(FRONTEND_VERSION, BACKEND_VERSION);
  assert.equal(FRONTEND_SENDER, BACKEND_SENDER);
});

test('o texto diz tudo que a Meta exige: canal, remetente, salão, escopo e como sair', () => {
  const texto = backendText({ establishmentName: 'Studio Dihcampos' });
  assert.match(texto, /WhatsApp/, 'precisa nomear o canal');
  assert.match(texto, new RegExp(BACKEND_SENDER), 'precisa nomear QUEM envia (o que a pessoa verá)');
  assert.match(texto, /Studio Dihcampos/, 'precisa nomear o salão');
  assert.match(texto, /confirmação e os lembretes/i, 'precisa delimitar o escopo (transacional)');
  assert.match(texto, /PARAR/, 'precisa dizer como sair');
});

test('sem o nome do salão a frase continua íntegra (não sobra "em nome de .")', () => {
  const texto = backendText({ establishmentName: '' });
  assert.doesNotMatch(texto, /em nome de\s*[.,]/);
  // Deriva do próprio remetente em vez de cravar o nome: numa troca de marca, o que TEM de
  // quebrar é o espelho frontend↔backend, não esta asserção de gramática.
  assert.ok(texto.includes(`enviados por ${BACKEND_SENDER}.`));
});

// --- 2. O "PARAR" -------------------------------------------------------------------------------
//
// Ignorar um pedido de saída é violação — e é o clique que vem ANTES de "denunciar spam", que é o
// que derruba a conta. Mas um matcher frouxo é igualmente perigoso: descadastrar um cliente
// satisfeito porque ele escreveu "não consigo parar de indicar vocês" é um bug invisível, que só
// aparece quando ele reclama que nunca recebeu o lembrete.

test('reconhece os pedidos de saída, com pontuação, acento e caixa variados', () => {
  for (const t of ['parar', 'PARAR', 'Parar.', ' pare ', 'SAIR', 'stop', 'Remover',
                   'descadastrar', 'não quero receber', 'NÃO QUERO MAIS RECEBER',
                   'cancelar inscrição']) {
    assert.equal(isOptOutText(t), true, `deveria reconhecer: "${t}"`);
  }
});

test('NÃO confunde uma frase que apenas contém a palavra com um pedido de saída', () => {
  for (const t of [
    'não consigo parar de indicar vocês',   // elogio — descadastrar aqui seria um bug mudo
    'vou parar na frente do salão',
    'posso sair mais cedo?',
    'quero remarcar',
    '',
  ]) {
    assert.equal(isOptOutText(t), false, `não deveria reconhecer: "${t}"`);
  }
});

test('"cancelar" sozinho NÃO é opt-out — no bot ela significa cancelar o AGENDAMENTO', () => {
  // Tratar as duas coisas como a mesma faria quem quer desmarcar um horário perder, de quebra e
  // sem ser avisado, todas as notificações.
  assert.equal(isOptOutText('cancelar'), false);
  assert.equal(isOptOutText('Cancelar'), false);
});
