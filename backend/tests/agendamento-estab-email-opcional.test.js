// E-MAIL OPCIONAL NO PAINEL DO DONO — a rota do balcão alinhada com a pública.
//
// POST /agendamentos/estabelecimento exigia e-mail; POST /public/agendamentos não. A assimetria
// não gerava e-mail, gerava e-mail INVENTADO: o dono tem o cliente na frente, não tem o endereço
// dele, e digita qualquer coisa para o formulário fechar. `usuarios.email` é UNIQUE e é a chave
// pela qual o handler reencontra o cadastro — então o chute vira identidade, e um chute que por
// azar exista é a caixa de um terceiro recebendo agendamento alheio.
//
// A checagem é textual de propósito, como em route-handler-req-param.test.js: importar as rotas
// exigiria banco e ambiente. O que ela protege são as três peças que fazem o campo ser opcional
// SEM sujar a base — se alguém desfizer qualquer uma, o sintoma em produção é silencioso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isValidEmailFormat } from '../src/lib/email_format.js';
import { buildPlaceholderGuestEmail } from '../src/lib/guest_placeholder_email.js';
import { normalizePhoneBR } from '../src/lib/phone_br.js';

const ROUTES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes');
const lerRota = (arquivo) => readFileSync(path.join(ROUTES_DIR, arquivo), 'utf8');

// Fatia o handler: do `router.post('/estabelecimento'` até a próxima declaração de rota.
function handlerDoEstabelecimento() {
  const codigo = lerRota('agendamentos.js');
  const inicio = codigo.indexOf("router.post('/estabelecimento'");
  assert.notEqual(inicio, -1, 'POST /estabelecimento não foi encontrado — o teste passaria a vazio');
  const resto = codigo.slice(inicio + 1);
  const fim = resto.indexOf('\nrouter.');
  return fim === -1 ? resto : resto.slice(0, fim);
}

test('o gate de campos obrigatórios não exige mais e-mail', () => {
  const corpo = handlerDoEstabelecimento();
  const gate = corpo.match(/if \(!serviceIds\.length[^)]*\)/);
  assert.ok(gate, 'o gate de invalid_payload mudou de forma — reveja este teste');
  assert.doesNotMatch(gate[0], /!email\b/, 'e-mail voltou a ser obrigatório no painel do dono');
  assert.match(gate[0], /!nome\b/, 'nome continua obrigatório');
  assert.match(gate[0], /!telefone\b/, 'telefone continua obrigatório');
});

test('sem e-mail, o cadastro nasce com o placeholder por telefone', () => {
  const corpo = handlerDoEstabelecimento();
  // Sem isto, `usuarios.email` (NOT NULL UNIQUE) recebe null/'' e o INSERT quebra — ou pior,
  // '' passa e o segundo cliente sem e-mail colide com o primeiro.
  assert.match(corpo, /buildPlaceholderGuestEmail\(telNorm\)/);
});

test('o placeholder de um cadastro antigo não conta como "outro e-mail"', () => {
  const corpo = handlerDoEstabelecimento();
  // Quem chegou pelo link público sem e-mail carrega `guest-<telefone>@…`. Comparado com o
  // endereço real que o dono acabou de anotar, isso devolvia 409 `cliente_conflito` para a MESMA
  // pessoa — encontrada pelo telefone dela.
  assert.match(corpo, /isPlaceholderGuestEmail\(existingEmail\)/);
  // E, na mesma passagem, o endereço real é promovido por cima do placeholder.
  assert.match(corpo, /isPlaceholderGuestEmail\(existingUser\.email\)/);
});

test('sem e-mail, o telefone precisa normalizar — senão o placeholder colide', () => {
  const corpo = handlerDoEstabelecimento();
  assert.match(corpo, /if \(!emailProvided && !telNorm\)/);

  // O porquê, medido e não afirmado: telefone que não normaliza vira '' e produz a MESMA chave
  // para pessoas diferentes. A UNIQUE(email) então costura os dois cadastros num só.
  assert.equal(normalizePhoneBR('123'), '');
  assert.equal(
    buildPlaceholderGuestEmail(normalizePhoneBR('123')),
    buildPlaceholderGuestEmail(normalizePhoneBR('98765'))
  );
  // Com telefones de verdade, o mesmo cálculo separa.
  assert.notEqual(
    buildPlaceholderGuestEmail(normalizePhoneBR('11999990000')),
    buildPlaceholderGuestEmail(normalizePhoneBR('11999990001'))
  );
});

test('e-mail informado continua sendo validado no formato', () => {
  const corpo = handlerDoEstabelecimento();
  assert.match(corpo, /isValidEmailFormat\(emailInput\)/);

  // Vazio é ausência, não erro. Torto é erro: aceitar prometeria uma confirmação que não chega.
  assert.equal(isValidEmailFormat(''), false);
  assert.equal(isValidEmailFormat('   '), false);
  assert.equal(isValidEmailFormat('cliente@gmail'), false);
  assert.equal(isValidEmailFormat('cliente arroba gmail.com'), false);
  assert.equal(isValidEmailFormat('cliente@gmail.com'), true);
  assert.equal(isValidEmailFormat('  cliente@gmail.com  '), true);
});

test('as duas rotas usam a MESMA régua de formato — nenhuma reescreve a sua', () => {
  // A normalização de telefone já morou copiada nestes dois arquivos e as cópias divergiram,
  // deixando a base com 11 e 13 dígitos para o mesmo dado (ver lib/phone_br.js). Um regex é
  // menor que aquilo, mas falha do mesmo jeito: alguém aperta um lado e o outro segue frouxo.
  for (const arquivo of ['agendamentos.js', 'agendamentos_public.js']) {
    const codigo = lerRota(arquivo);
    assert.match(
      codigo,
      /import \{ isValidEmailFormat \} from '\.\.\/lib\/email_format\.js'/,
      `${arquivo} não importa a régua compartilhada`
    );
    assert.doesNotMatch(
      codigo,
      /const isValidEmailFormat\s*=/,
      `${arquivo} voltou a definir a própria validação de e-mail`
    );
  }
});
