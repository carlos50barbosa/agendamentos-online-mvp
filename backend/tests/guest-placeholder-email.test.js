import test from 'node:test'
import assert from 'node:assert/strict'

// ATENÇÃO — ISTO PRECISA VIR ANTES DO import de notifications.js.
//
// A cadeia de imports daquele módulo carrega `dotenv`, então o backend/.env de VERDADE entra em
// process.env: SMTP_HOST e SMTP_USER reais. O notifications.js escolhe o transporter no momento em
// que é carregado — com credencial presente, ele monta um SMTP de produção, e qualquer teste que
// chame notifyEmail com um endereço plausível MANDA O E-MAIL DE VERDADE. Foi o que aconteceu na
// primeira versão deste arquivo: um teste entregou uma mensagem numa caixa de terceiro.
//
// Atribuir string vazia (em vez de deletar) é o que desarma isso: o dotenv não sobrescreve chave
// que já existe em process.env, e '' é falsy — o módulo cai no streamTransport, que só bufferiza.
process.env.SMTP_HOST = ''
process.env.SMTP_USER = ''
process.env.SMTP_PASS = ''

const {
  GUEST_PLACEHOLDER_EMAIL_DOMAIN,
  buildPlaceholderGuestEmail,
  isPlaceholderGuestEmail,
} = await import('../src/lib/guest_placeholder_email.js')

const { notifyEmail } = await import('../src/lib/notifications.js')

// Domínio reservado para exemplos que nunca resolvem (RFC 2606). Mesmo se o streamTransport falhar
// um dia, não existe caixa do outro lado — nenhum endereço deste arquivo pertence a alguém.
const EMAIL_REAL_DE_MENTIRA = 'nao-enviar@example.invalid'

test('o domínio do placeholder é uma TLD reservada', () => {
  // `.local` (RFC 6762) nunca é delegada na raiz do DNS: ninguém pode comprar este domínio e
  // passar a receber, na caixa dele, endereços derivados do telefone dos nossos clientes.
  assert.match(GUEST_PLACEHOLDER_EMAIL_DOMAIN, /\.local$/)
})

test('o placeholder é determinístico pelo telefone', () => {
  // É o que faz o mesmo número reencontrar o mesmo cadastro em vez de criar um duplicado a cada
  // agendamento — a UNIQUE(email) depende disso.
  assert.equal(buildPlaceholderGuestEmail('5512981747659'), 'guest-5512981747659@sem-email.agendou.local')
  assert.equal(
    buildPlaceholderGuestEmail('5512981747659'),
    buildPlaceholderGuestEmail('5512981747659')
  )
  assert.notEqual(buildPlaceholderGuestEmail('5512981747659'), buildPlaceholderGuestEmail('5511999990000'))
})

test('reconhece o placeholder em qualquer caixa e com espaço em volta', () => {
  assert.equal(isPlaceholderGuestEmail('guest-5512981747659@sem-email.agendou.local'), true)
  assert.equal(isPlaceholderGuestEmail('  GUEST-5512981747659@SEM-EMAIL.AGENDOU.LOCAL  '), true)
})

test('não confunde e-mail real com placeholder', () => {
  assert.equal(isPlaceholderGuestEmail('cliente@gmail.com'), false)
  assert.equal(isPlaceholderGuestEmail('guest-551199@outro.com'), false)
  // Sufixo parecido não basta: um domínio de verdade poderia terminar assim.
  assert.equal(isPlaceholderGuestEmail('alguem@nao-sem-email.agendou.local.com'), false)
  assert.equal(isPlaceholderGuestEmail(''), false)
  assert.equal(isPlaceholderGuestEmail(null), false)
  assert.equal(isPlaceholderGuestEmail(undefined), false)
})

test('notifyEmail recusa o placeholder antes de tentar o SMTP', async () => {
  // O guard mora no notifyEmail, e não nos call sites, porque o placeholder satisfaz o
  // `if (cli?.email)` de TODOS eles (confirmação, lembrete de 8h, reagendamento...). Um choke
  // point cobre inclusive o call site que ainda não foi escrito.
  const res = await notifyEmail(
    'guest-5512981747659@sem-email.agendou.local',
    'Lembrete do seu agendamento',
    '<p>oi</p>'
  )
  assert.equal(res.ok, false)
  assert.equal(res.error, 'placeholder_email')
})

test('notifyEmail continua distinguindo "sem endereço" de "endereço que não recebe"', async () => {
  // Dois motivos diferentes, dois códigos diferentes: quem lê o log precisa saber se o cliente
  // não tem e-mail ou se ele tem um que nunca vai chegar.
  const semTo = await notifyEmail('', 'assunto', '<p>oi</p>')
  assert.equal(semTo.error, 'missing_to')
})

test('endereço comum NÃO é recusado pelo guard', async () => {
  // Se um dia o guard ficar guloso demais (um `includes` no lugar do `endsWith`, por exemplo),
  // este teste cai — e o sintoma em produção seria e-mail sumindo em silêncio.
  const res = await notifyEmail(EMAIL_REAL_DE_MENTIRA, 'assunto', '<p>oi</p>')
  assert.notEqual(res.error, 'placeholder_email')
})

test('o teste roda com SMTP desarmado — nada sai desta suíte', () => {
  // Guarda de si mesma: se alguém remover as três linhas do topo do arquivo, este teste cai antes
  // que a suíte volte a entregar mensagem na caixa de alguém.
  assert.equal(process.env.SMTP_HOST, '')
  assert.equal(process.env.SMTP_USER, '')
})
