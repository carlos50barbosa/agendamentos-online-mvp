import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_USER ??= 'root'
process.env.DB_PASS ??= 'root'
process.env.DB_NAME ??= 'test'
process.env.JWT_SECRET ??= 'test-secret'

const {
  ASAAS_ONBOARDING_TERMS_VERSION,
  AsaasOnboardingError,
  buildSubaccountDraft,
  createEstablishmentSubaccount,
} = await import('../src/lib/asaas_onboarding.js')
const { AsaasError } = await import('../src/services/asaas/client.js')

const PERFIL_COMPLETO = {
  nome: 'Salão da Ana',
  email: 'Ana@Salao.com.BR',
  telefone: '5511915155349',
  data_nascimento: '1990-05-02',
  cpf_cnpj: '11144477735',
  cep: '06150-492',
  endereco: 'Estrada das Palmeiras',
  numero: '70',
  complemento: 'Casa 4',
  bairro: 'Santa Maria',
  cidade: 'Osasco',
  estado: 'SP',
}

/** db falso: `usuarios` devolve o perfil, `establishment_settings` devolve o estado atual. */
function fakeDb({ perfil = PERFIL_COMPLETO, settings = null } = {}) {
  const writes = []
  return {
    writes,
    query: async (sql, params) => {
      const flat = sql.replace(/\s+/g, ' ').trim()
      if (/^SELECT .* FROM usuarios/i.test(flat)) return [perfil ? [perfil] : []]
      if (/^SELECT .* FROM establishment_settings/i.test(flat)) return [settings ? [settings] : []]
      writes.push({ sql: flat, params })
      return [{ affectedRows: 1 }]
    },
  }
}

function fakeAccounts({ existing = null, created = { id: 'acc_1', walletId: 'w-1' }, onCreate } = {}) {
  const calls = { get: 0, create: 0, lastBody: null }
  return {
    calls,
    getSubaccountByCpfCnpj: async () => {
      calls.get += 1
      return existing
    },
    createSubaccount: async (body) => {
      calls.create += 1
      calls.lastBody = body
      if (onCreate) return onCreate(body)
      return created
    },
  }
}

const ACEITE = { accepted: true, ip: '203.0.113.7', termsVersion: ASAAS_ONBOARDING_TERMS_VERSION }

test('draft: pre-preenche do cadastro e pede so o que falta', async () => {
  const res = await buildSubaccountDraft(7, { db: fakeDb() })

  assert.equal(res.draft.name, 'Salão da Ana')
  assert.equal(res.draft.email, 'ana@salao.com.br', 'e-mail normalizado')
  assert.equal(res.draft.mobilePhone, '11915155349', 'DDI removido')
  assert.equal(res.draft.postalCode, '06150492')
  assert.equal(res.draft.birthDate, '1990-05-02')
  assert.equal(res.draft.documentKind, 'CPF')
  // Faturamento nunca vem do cadastro: nao existe no perfil e e' sempre perguntado.
  assert.deepEqual(res.missing, ['incomeValue'])
  assert.equal(res.walletSource, null)
})

test('draft: cadastro incompleto lista TODOS os buracos, nao so o primeiro', async () => {
  const db = fakeDb({ perfil: { ...PERFIL_COMPLETO, cep: null, bairro: '', telefone: '' } })
  const { missing } = await buildSubaccountDraft(7, { db })

  assert.deepEqual(missing.sort(), ['incomeValue', 'mobilePhone', 'postalCode', 'province'].sort())
})

test('draft: distingue subconta (aberta por nos) de wallet colada na mao', async () => {
  const manual = await buildSubaccountDraft(7, {
    db: fakeDb({ settings: { asaas_wallet_id: 'w-manual', asaas_subaccount_created_at: null } }),
  })
  assert.equal(manual.walletSource, 'manual')

  const sub = await buildSubaccountDraft(7, {
    db: fakeDb({ settings: { asaas_wallet_id: 'w-sub', asaas_subaccount_created_at: new Date() } }),
  })
  assert.equal(sub.walletSource, 'subconta')
})

test('sem aceite NAO cria conta — nem chega a falar com o Asaas', async () => {
  const accounts = fakeAccounts()
  const db = fakeDb()

  await assert.rejects(
    () => createEstablishmentSubaccount({ estabelecimentoId: 7, consent: { accepted: false }, db, accounts }),
    (err) => err instanceof AsaasOnboardingError && err.code === 'consent_required',
  )
  assert.equal(accounts.calls.create, 0)
  assert.equal(db.writes.length, 0)
})

test('quem ja tem carteira nao ganha uma segunda', async () => {
  const accounts = fakeAccounts()
  const db = fakeDb({ settings: { asaas_wallet_id: 'w-existente' } })

  await assert.rejects(
    () => createEstablishmentSubaccount({ estabelecimentoId: 7, consent: ACEITE, db, accounts }),
    (err) => err instanceof AsaasOnboardingError && err.code === 'wallet_already_configured' && err.status === 409,
  )
  assert.equal(accounts.calls.create, 0)
})

test('cria, grava a carteira e a trilha do aceite', async () => {
  const accounts = fakeAccounts()
  const db = fakeDb()

  const res = await createEstablishmentSubaccount({
    estabelecimentoId: 7,
    overrides: { incomeValue: '8000' },
    consent: ACEITE,
    db,
    accounts,
  })

  assert.deepEqual(res, { walletId: 'w-1', accountId: 'acc_1', created: true, reused: false })
  assert.equal(accounts.calls.lastBody.externalReference, 'estabelecimento:7')
  assert.equal(accounts.calls.lastBody.incomeValue, 8000, 'string do formulario vira numero')
  assert.equal(accounts.calls.lastBody.loginEmail, 'ana@salao.com.br', 'o acesso vai para o e-mail DELE')

  assert.equal(db.writes.length, 1, 'uma unica instrucao — ja e atomica')
  const { sql, params } = db.writes[0]
  assert.match(sql, /INSERT INTO establishment_settings/)
  assert.match(sql, /ON DUPLICATE KEY UPDATE/, 'a linha pode nao existir ainda')
  assert.deepEqual(params, [7, 'w-1', 'acc_1', ASAAS_ONBOARDING_TERMS_VERSION, '203.0.113.7'])
  // wallet_verified_at fica NULL: "verificada" significa exercitada numa cobranca real.
  assert.match(sql, /wallet_verified_at=NULL/)
})

test('overrides do formulario vencem o cadastro (dado corrigido na hora)', async () => {
  const accounts = fakeAccounts()
  const db = fakeDb({ perfil: { ...PERFIL_COMPLETO, cpf_cnpj: '11144477735' } })

  await createEstablishmentSubaccount({
    estabelecimentoId: 7,
    overrides: { cpfCnpj: '68.068.260/0001-32', companyType: 'MEI', incomeValue: 12000, name: 'ANA LTDA' },
    consent: ACEITE,
    db,
    accounts,
  })

  assert.equal(accounts.calls.lastBody.cpfCnpj, '68068260000132')
  assert.equal(accounts.calls.lastBody.companyType, 'MEI')
  assert.equal(accounts.calls.lastBody.name, 'ANA LTDA')
  assert.equal(accounts.calls.lastBody.birthDate, undefined, 'PJ nao manda nascimento')
})

test('retry reaproveita subconta ja criada em vez de duplicar', async () => {
  // Cenario real: a criacao deu certo no Asaas e a gravacao local morreu no meio.
  const accounts = fakeAccounts({ existing: { id: 'acc_ja', walletId: 'w-ja' } })
  const db = fakeDb()

  const res = await createEstablishmentSubaccount({
    estabelecimentoId: 7,
    overrides: { incomeValue: 8000 },
    consent: ACEITE,
    db,
    accounts,
  })

  assert.deepEqual(res, { walletId: 'w-ja', accountId: 'acc_ja', created: false, reused: true })
  assert.equal(accounts.calls.create, 0, 'nao pode tentar criar a segunda')
  assert.equal(db.writes.length, 1, 'mas grava a carteira que ficou orfa')
})

test('erro do Asaas chega ao dono com a mensagem do Asaas', async () => {
  // Caso mais provavel: o CPF/CNPJ ja tem conta Asaas propria e nao pode virar subconta.
  const accounts = fakeAccounts({
    onCreate: () => {
      throw new AsaasError('Já existe uma conta com este CPF/CNPJ.', { status: 400 })
    },
  })
  const db = fakeDb()

  await assert.rejects(
    () => createEstablishmentSubaccount({
      estabelecimentoId: 7,
      overrides: { incomeValue: 8000 },
      consent: ACEITE,
      db,
      accounts,
    }),
    (err) => err instanceof AsaasOnboardingError
      && err.code === 'asaas_rejected'
      && /Já existe uma conta/.test(err.message),
  )
  assert.equal(db.writes.length, 0, 'nada gravado quando a criacao falha')
})

test('403 do Asaas nao vira culpa do dono do salao', async () => {
  // Medido em 28/07/2026: conta da plataforma ja PJ/MEI e APPROVED, e mesmo assim o Asaas
  // devolve 403 com "contas de pessoa fisica nao podem criar subcontas". Repassar esse texto
  // mandaria o dono conferir um cadastro que esta certo — o problema e' permissao NOSSA.
  const accounts = fakeAccounts({
    onCreate: () => {
      throw new AsaasError(
        'Contas de pessoa física (CPF) não podem criar subcontas no Asaas.',
        { status: 403 },
      )
    },
  })
  const db = fakeDb()

  await assert.rejects(
    () => createEstablishmentSubaccount({
      estabelecimentoId: 7,
      overrides: { incomeValue: 8000 },
      consent: ACEITE,
      db,
      accounts,
    }),
    (err) => err instanceof AsaasOnboardingError
      && err.code === 'subaccount_not_enabled'
      && err.status === 503
      && !/pessoa física/.test(err.message)
      && /Wallet ID/.test(err.message),
  )
  assert.equal(db.writes.length, 0)
})

test('validacao local barra dado que o Asaas recusaria com erro cego', async () => {
  const casos = [
    [{ cpfCnpj: '11144477734', incomeValue: 8000 }, 'invalid_document'],
    [{ incomeValue: 0 }, 'invalid_income_value'],
    [{ incomeValue: 8000, mobilePhone: '1130001000' }, 'invalid_mobile_phone'],
    [{ incomeValue: 8000, postalCode: '123' }, 'invalid_postal_code'],
    [{ incomeValue: 8000, cpfCnpj: '68068260000132', companyType: 'SA' }, 'invalid_company_type'],
    [{ incomeValue: 8000, birthDate: '' }, 'invalid_birth_date'],
  ]

  for (const [overrides, code] of casos) {
    const accounts = fakeAccounts()
    await assert.rejects(
      () => createEstablishmentSubaccount({ estabelecimentoId: 7, overrides, consent: ACEITE, db: fakeDb(), accounts }),
      (err) => err instanceof AsaasOnboardingError && err.code === code,
      `esperava ${code} para ${JSON.stringify(overrides)}`,
    )
    assert.equal(accounts.calls.create, 0, `${code} deveria falhar antes da rede`)
  }
})

test('campo obrigatorio em branco volta a lista de pendencias', async () => {
  const db = fakeDb({ perfil: { ...PERFIL_COMPLETO, endereco: '', bairro: '' } })
  const accounts = fakeAccounts()

  await assert.rejects(
    () => createEstablishmentSubaccount({ estabelecimentoId: 7, overrides: { incomeValue: 8000 }, consent: ACEITE, db, accounts }),
    (err) => err instanceof AsaasOnboardingError
      && err.code === 'missing_fields'
      && err.details.missing.includes('address')
      && err.details.missing.includes('province'),
  )
})

test('estabelecimento inexistente vira 404, nao 500', async () => {
  await assert.rejects(
    () => buildSubaccountDraft(999, { db: fakeDb({ perfil: null }) }),
    (err) => err instanceof AsaasOnboardingError && err.code === 'establishment_not_found' && err.status === 404,
  )
})
