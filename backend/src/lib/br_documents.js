// backend/src/lib/br_documents.js
// Validacao de CPF/CNPJ e normalizacao de telefone BR. Funcoes PURAS, sem I/O.
//
// Por que existe: o Asaas recusa documento com digito verificador errado e telefone mal
// formado, e responde com erro generico — o diagnostico sai caro justamente onde dinheiro
// esta em jogo (criacao de cliente, de cobranca e de subconta). Validar ANTES de chamar o
// gateway transforma isso num 400 com mensagem util.
//
// A implementacao de CPF/CNPJ vinha de `client_loyalty_billing.js`, onde era privada. Foi
// movida para ca (e reimportada la) quando o onboarding de subconta passou a precisar da
// mesma regra: uma segunda copia divergiria em silencio.

export function digitsOnly(value) {
  return String(value || '').trim().replace(/\D/g, '')
}

export function isValidCpf(value) {
  const cpf = digitsOnly(value)
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false

  let sum = 0
  for (let i = 0; i < 9; i += 1) sum += Number(cpf[i]) * (10 - i)
  let digit = (sum * 10) % 11
  if (digit === 10) digit = 0
  if (digit !== Number(cpf[9])) return false

  sum = 0
  for (let i = 0; i < 10; i += 1) sum += Number(cpf[i]) * (11 - i)
  digit = (sum * 10) % 11
  if (digit === 10) digit = 0
  return digit === Number(cpf[10])
}

export function isValidCnpj(value) {
  const cnpj = digitsOnly(value)
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false

  const calcDigit = (length) => {
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = weights.reduce((total, weight, index) => total + Number(cnpj[index]) * weight, 0)
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }

  return calcDigit(12) === Number(cnpj[12]) && calcDigit(13) === Number(cnpj[13])
}

/** true para CPF (11 dig.) OU CNPJ (14 dig.) com digito verificador valido. */
export function isValidCpfCnpj(value) {
  const doc = digitsOnly(value)
  if (doc.length === 11) return isValidCpf(doc)
  if (doc.length === 14) return isValidCnpj(doc)
  return false
}

/** 'CPF' | 'CNPJ' | null — pelo COMPRIMENTO, sem validar o digito. */
export function documentKind(value) {
  const doc = digitsOnly(value)
  if (doc.length === 11) return 'CPF'
  if (doc.length === 14) return 'CNPJ'
  return null
}

/**
 * Telefone BR em digitos, sem DDI: 10 (fixo) ou 11 (celular). Fora disso, null.
 * Nao "conserta" numero curto — devolver null e' o que permite ao chamador decidir entre
 * omitir o campo (opcional no Asaas) e recusar a operacao.
 */
export function normalizeBrazilPhone(value) {
  const digits = digitsOnly(value)
  if (!digits) return null
  const normalized = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits
  return normalized.length >= 10 && normalized.length <= 11 ? normalized : null
}

/** Celular BR (11 digitos) — o Asaas separa `mobilePhone` de `phone` e valida cada um. */
export function normalizeBrazilMobile(value) {
  const phone = normalizeBrazilPhone(value)
  return phone && phone.length === 11 ? phone : null
}

/** CEP em 8 digitos, ou null. */
export function normalizePostalCode(value) {
  const cep = digitsOnly(value)
  return cep.length === 8 ? cep : null
}
