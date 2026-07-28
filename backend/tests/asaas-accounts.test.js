import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const { createAsaasAccounts, COMPANY_TYPES } = await import('../src/services/asaas/accounts.js')
const { AsaasError } = await import('../src/services/asaas/client.js')

function stubClient(byKey = {}) {
  const calls = []
  const handle = (method) => async (path, opts = {}) => {
    calls.push({ method, path, ...opts })
    const canned = byKey[`${method} ${path}`] ?? byKey[path]
    if (canned instanceof Error) throw canned
    return typeof canned === 'function' ? canned(path, opts) : canned ?? {}
  }
  return { calls, get: handle('GET'), post: handle('POST'), put: handle('PUT'), delete: handle('DELETE') }
}

const CPF_PAYLOAD = {
  name: 'Salão da Ana',
  email: 'ana@salao.com.br',
  cpfCnpj: '111.444.777-35',
  birthDate: '1990-05-02',
  mobilePhone: '11915155349',
  incomeValue: 8000,
  address: 'Rua das Flores',
  addressNumber: '100',
  province: 'Centro',
  postalCode: '01001-000',
}

test('CPF: envia birthDate, digitos limpos e NENHUM companyType', async () => {
  const client = stubClient({ 'POST /v3/accounts': { id: 'acc_1', walletId: 'w-1' } })
  const accounts = createAsaasAccounts(client)

  const res = await accounts.createSubaccount({ ...CPF_PAYLOAD, externalReference: 'estabelecimento:7' })

  assert.deepEqual(res, { id: 'acc_1', walletId: 'w-1', accountNumber: null })
  const body = client.calls[0].body
  assert.equal(body.cpfCnpj, '11144477735', 'mascara removida')
  assert.equal(body.postalCode, '01001000')
  assert.equal(body.birthDate, '1990-05-02')
  assert.equal(body.externalReference, 'estabelecimento:7')
  // O Asaas RECUSA companyType em cadastro de pessoa fisica.
  assert.equal(body.companyType, undefined)
  assert.equal(body.loginEmail, 'ana@salao.com.br', 'sem loginEmail explicito, usa o email')
})

test('CNPJ: exige companyType valido e NAO envia birthDate', async () => {
  const client = stubClient({ 'POST /v3/accounts': { id: 'acc_2', walletId: 'w-2' } })
  const accounts = createAsaasAccounts(client)

  const pj = { ...CPF_PAYLOAD, cpfCnpj: '68068260000132', companyType: 'mei', birthDate: undefined }
  const res = await accounts.createSubaccount(pj)

  assert.equal(res.walletId, 'w-2')
  const body = client.calls[0].body
  assert.equal(body.companyType, 'MEI', 'normalizado para maiusculo')
  assert.equal(body.birthDate, undefined, 'nascimento nao se aplica a PJ')
})

test('CNPJ sem companyType falha ANTES de chamar o Asaas', async () => {
  const client = stubClient()
  const accounts = createAsaasAccounts(client)

  await assert.rejects(
    () => accounts.createSubaccount({ ...CPF_PAYLOAD, cpfCnpj: '68068260000132' }),
    (err) => err instanceof AsaasError && err.code === 'invalid_company_type',
  )
  assert.equal(client.calls.length, 0, 'nao deve gastar uma chamada de rede com body invalido')
  assert.deepEqual(COMPANY_TYPES, ['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION'])
})

test('CPF sem data de nascimento falha antes da rede', async () => {
  const client = stubClient()
  const accounts = createAsaasAccounts(client)
  await assert.rejects(
    () => accounts.createSubaccount({ ...CPF_PAYLOAD, birthDate: undefined }),
    (err) => err instanceof AsaasError && err.code === 'missing_field',
  )
  assert.equal(client.calls.length, 0)
})

test('erro do Asaas sobe com a mensagem dele, nao mascarado', async () => {
  const boom = new AsaasError('O documento informado já está em uso.', { status: 400 })
  const client = stubClient({ 'POST /v3/accounts': boom })
  const accounts = createAsaasAccounts(client)

  await assert.rejects(
    () => accounts.createSubaccount(CPF_PAYLOAD),
    (err) => err instanceof AsaasError && /já está em uso/.test(err.message),
  )
})

test('getSubaccountByCpfCnpj devolve a primeira ou null', async () => {
  const found = createAsaasAccounts(
    stubClient({ 'GET /v3/accounts': { data: [{ id: 'acc_9', walletId: 'w-9' }] } }),
  )
  assert.deepEqual(await found.getSubaccountByCpfCnpj('111.444.777-35'), {
    id: 'acc_9',
    walletId: 'w-9',
    accountNumber: null,
  })

  const empty = createAsaasAccounts(stubClient({ 'GET /v3/accounts': { data: [] } }))
  assert.equal(await empty.getSubaccountByCpfCnpj('11144477735'), null)

  const noDoc = createAsaasAccounts(stubClient())
  assert.equal(await noDoc.getSubaccountByCpfCnpj(''), null)
})

test('dedupe ignora retorno de OUTRO documento (filtro que não filtra)', async () => {
  // Se o `?cpfCnpj=` fosse ignorado, o 1º item seria a subconta de outro estabelecimento —
  // e gravá-la aqui mandaria o sinal para a conta errada. Melhor devolver null e criar.
  const client = stubClient({
    'GET /v3/accounts': { data: [{ id: 'acc_outro', walletId: 'w-outro', cpfCnpj: '68068260000132' }] },
  })
  const accounts = createAsaasAccounts(client)

  assert.equal(await accounts.getSubaccountByCpfCnpj('11144477735'), null)

  const mesmo = createAsaasAccounts(
    stubClient({ 'GET /v3/accounts': { data: [{ id: 'acc_ok', walletId: 'w-ok', cpfCnpj: '111.444.777-35' }] } }),
  )
  assert.equal((await mesmo.getSubaccountByCpfCnpj('11144477735'))?.walletId, 'w-ok')
})
