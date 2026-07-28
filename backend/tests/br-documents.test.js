import test from 'node:test'
import assert from 'node:assert/strict'

const {
  isValidCpf,
  isValidCnpj,
  isValidCpfCnpj,
  documentKind,
  normalizeBrazilPhone,
  normalizeBrazilMobile,
  normalizePostalCode,
} = await import('../src/lib/br_documents.js')

// Por que estes testes existem: o Asaas recusa documento com digito verificador errado e
// responde erro generico. Se a validacao local afrouxar, o sintoma aparece la' na frente, na
// criacao da subconta, como "502" sem causa.

test('CPF: aceita valido, recusa digito errado e repetido', () => {
  assert.equal(isValidCpf('11144477735'), true)
  assert.equal(isValidCpf('111.444.777-35'), true, 'mascara nao deve atrapalhar')
  assert.equal(isValidCpf('11144477734'), false, 'digito verificador errado')
  assert.equal(isValidCpf('11111111111'), false, 'sequencia repetida passa no calculo, mas nao existe')
  assert.equal(isValidCpf('1114447773'), false, 'curto demais')
  assert.equal(isValidCpf(''), false)
  assert.equal(isValidCpf(null), false)
})

test('CNPJ: aceita valido, recusa digito errado e repetido', () => {
  assert.equal(isValidCnpj('68068260000132'), true)
  assert.equal(isValidCnpj('68.068.260/0001-32'), true)
  assert.equal(isValidCnpj('68068260000133'), false)
  assert.equal(isValidCnpj('11111111111111'), false)
  assert.equal(isValidCnpj('6806826000013'), false)
})

test('isValidCpfCnpj decide pelo comprimento', () => {
  assert.equal(isValidCpfCnpj('11144477735'), true)
  assert.equal(isValidCpfCnpj('68068260000132'), true)
  assert.equal(isValidCpfCnpj('123'), false)
  assert.equal(documentKind('11144477735'), 'CPF')
  assert.equal(documentKind('68068260000132'), 'CNPJ')
  assert.equal(documentKind('123'), null)
})

test('telefone: remove DDI 55 e distingue celular de fixo', () => {
  assert.equal(normalizeBrazilPhone('11915155349'), '11915155349')
  assert.equal(normalizeBrazilPhone('5511915155349'), '11915155349', 'DDI removido')
  assert.equal(normalizeBrazilPhone('(11) 91515-5349'), '11915155349')
  assert.equal(normalizeBrazilPhone('1130001000'), '1130001000', 'fixo de 10 digitos e valido')
  assert.equal(normalizeBrazilPhone('91515349'), null, 'sem DDD')
  assert.equal(normalizeBrazilPhone(''), null)

  // O Asaas separa `mobilePhone` de `phone` e recusa um fixo enviado como celular.
  assert.equal(normalizeBrazilMobile('11915155349'), '11915155349')
  assert.equal(normalizeBrazilMobile('1130001000'), null, 'fixo nao serve como celular')
})

test('CEP: 8 digitos ou null', () => {
  assert.equal(normalizePostalCode('06150-492'), '06150492')
  assert.equal(normalizePostalCode('06150492'), '06150492')
  assert.equal(normalizePostalCode('6150492'), null)
  assert.equal(normalizePostalCode(''), null)
})
