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
  CONSENT_AUDIENCE,
  buildConsentText as backendText,
} from '../src/lib/whatsapp_consent_text.js';

import {
  CONSENT_VERSION as FRONTEND_VERSION,
  WA_SENDER_NAME as FRONTEND_SENDER,
  CONSENT_AUDIENCE as FRONTEND_AUDIENCE,
  buildConsentText as frontendText,
} from '../../frontend/src/utils/whatsappConsent.js';

import { isOptOutText, isWrongPersonText } from '../src/whatsapp/inbound/optOut.js';

// --- 1. O espelho: o que a tela mostra é o que o banco guarda -----------------------------------
//
// O backend renderiza e persiste o texto (o cliente HTTP não pode forjá-lo); o frontend renderiza
// o que a pessoa lê. Se divergirem, o registro deixa de provar o que foi mostrado — e uma prova
// que não bate com a realidade é pior do que nenhuma prova.

test('o texto do aceite é IDÊNTICO no frontend e no backend, nas DUAS audiências', () => {
  const casos = [
    { establishmentName: 'Studio Dihcampos' },
    { establishmentName: 'Salão da Ana & Cia.' },
    { establishmentName: '' },        // sem nome: a frase ainda tem de fechar
    {},                                // sem argumento nenhum
    undefined,                         // chamada sem objeto
    { audience: CONSENT_AUDIENCE.CLIENT, establishmentName: 'Studio Dihcampos' },
    { audience: CONSENT_AUDIENCE.ESTABLISHMENT },
    // O dono não tem "em nome de": mesmo passando o nome, o texto dele ignora — e o espelho
    // precisa ignorar do mesmo jeito.
    { audience: CONSENT_AUDIENCE.ESTABLISHMENT, establishmentName: 'Studio Dihcampos' },
  ];
  for (const caso of casos) {
    assert.equal(
      frontendText(caso),
      backendText(caso),
      `divergiu para ${JSON.stringify(caso)} — a tela mostraria uma frase e o banco guardaria outra`
    );
  }
});

test('frontend e backend concordam na versão, no remetente e nas audiências', () => {
  assert.equal(FRONTEND_VERSION, BACKEND_VERSION);
  assert.equal(FRONTEND_SENDER, BACKEND_SENDER);
  assert.deepEqual(FRONTEND_AUDIENCE, CONSENT_AUDIENCE);
});

test('o texto do CLIENTE diz tudo que a Meta exige: canal, remetente, salão, escopo e como sair', () => {
  const texto = backendText({ establishmentName: 'Studio Dihcampos' });
  assert.match(texto, /WhatsApp/, 'precisa nomear o canal');
  assert.match(texto, new RegExp(BACKEND_SENDER), 'precisa nomear QUEM envia (o que a pessoa verá)');
  assert.match(texto, /Studio Dihcampos/, 'precisa nomear o salão');
  assert.match(texto, /confirmação e os lembretes/i, 'precisa delimitar o escopo (transacional)');
  assert.match(texto, /PARAR/, 'precisa dizer como sair');
});

test('o texto do DONO descreve o que ELE recebe — não "seu agendamento foi confirmado"', () => {
  // O dono recebe "novo cliente agendou". Se o aceite dele falasse em "confirmação do meu
  // agendamento", ele estaria autorizando uma coisa e recebendo outra — e o registro deixaria de
  // provar o que interessa.
  const texto = backendText({ audience: CONSENT_AUDIENCE.ESTABLISHMENT });
  assert.match(texto, /WhatsApp/);
  assert.match(texto, new RegExp(BACKEND_SENDER));
  assert.match(texto, /avisos da minha agenda/);
  assert.match(texto, /PARAR/);
  assert.doesNotMatch(texto, /em nome de/, 'o dono não recebe mensagem "em nome de" ninguém');
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

// --- 3. "Vocês erraram a pessoa" -----------------------------------------------------------------
//
// O sinal mais perigoso que existe, e o que o bot ignorava.
//
// Caso real (14/07/2026): alguém criou um estabelecimento falso com o telefone de uma pessoa
// aleatória e marcou a caixa de opt-in POR ELA. Ela recebeu um lembrete de agendamento e respondeu
// a frase abaixo. O bot não reconheceu, caiu no generic_fallback e mandou MAIS uma mensagem. Para
// alguém importunado por um número que não conhece, o passo seguinte é DENUNCIAR — e denúncia é o
// que derruba a WABA.

test('a frase REAL que ela escreveu é reconhecida como "erraram a pessoa"', () => {
  // Textual, do log de produção. Se um dia alguém "simplificar" o matcher, é este caso que quebra.
  assert.equal(isWrongPersonText('veio errado não tenho agenda com voces'), true);
});

test('reconhece as outras formas de dizer "não é comigo"', () => {
  for (const t of [
    'número errado',
    'pessoa errada',
    'não conheço vocês',
    'não sou cliente de vocês',
    'nunca fui cliente',
    'não pedi isso',
    'não solicitei',
    'não me cadastrei em lugar nenhum',
    'não fui eu que cadastrei',
    'não tenho agendamento com vocês',
  ]) {
    assert.equal(isWrongPersonText(t), true, `deveria reconhecer: "${t}"`);
  }
});

test('NÃO confunde o cliente real que só está sem horário marcado', () => {
  // É o falso positivo que me preocupa: "não tenho agenda" dito por um cliente DE VERDADE significa
  // "estou sem horário marcado", não "não te conheço". Por isso as frases exigem a negação de
  // VÍNCULO ("com vocês", "sou cliente"), e não só "não tenho agenda".
  for (const t of [
    'não tenho agenda essa semana',
    'não tenho agenda hoje, pode ser amanhã?',
    'oi, queria remarcar',
    'confirmo!',
    'que horas é meu horário?',
    '',
  ]) {
    assert.equal(isWrongPersonText(t), false, `NÃO deveria reconhecer: "${t}"`);
  }
});

test('o descadastro comum e o "pessoa errada" são coisas distintas', () => {
  // Um pede para sair; o outro nunca entrou. O tom da resposta muda — quem não te conhece não quer
  // instrução de descadastro, quer um pedido de desculpas.
  assert.equal(isOptOutText('veio errado não tenho agenda com voces'), false);
  assert.equal(isWrongPersonText('parar'), false);
});
