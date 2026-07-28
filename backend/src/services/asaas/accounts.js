// backend/src/services/asaas/accounts.js
// Subcontas Asaas (`/v3/accounts`): a plataforma abre a conta de recebimento EM NOME do
// estabelecimento, para ele nao precisar se cadastrar no Asaas e colar um Wallet ID.
//
// So funciona a partir de conta PJ — o Asaas responde "Contas de pessoa fisica (CPF) nao
// podem criar subcontas" para conta PF. Vale por ambiente: a conta sandbox e' um cadastro
// separado da de producao e precisa ser PJ tambem.
//
// Mesmo desenho de `payments.js`: fabrica com client injetavel, para os testes rodarem sem rede.
import { getAsaasClient, AsaasError } from './client.js';
import { toDateOnly } from './payments.js';
import { digitsOnly, documentKind } from '../../lib/br_documents.js';

/** Tipos de empresa aceitos pelo Asaas para cadastro PJ. */
export const COMPANY_TYPES = Object.freeze(['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION']);

function requireField(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new AsaasError(`Campo obrigatório ausente: ${name}`, { code: 'missing_field' });
  }
  return value;
}

export function createAsaasAccounts(client = getAsaasClient()) {
  /**
   * Cria a subconta e devolve { id, walletId, accountNumber }.
   *
   * A `apiKey` vem no retorno e e' DESCARTADA de proposito: o modelo escolhido e' o salao
   * acessando a propria subconta com as credenciais que o Asaas manda para o `loginEmail`
   * dele. Guardar a chave aqui significaria a plataforma poder movimentar o dinheiro do
   * salao — outro patamar de responsabilidade, e nao e' o que esta contratado com ele.
   * Se um dia isso mudar, a chave tem de ir para um secret store (a coluna reservada
   * `establishment_settings.asaas_api_key_ref` guarda a REFERENCIA, nunca a chave).
   */
  async function createSubaccount({
    name,
    email,
    loginEmail,
    cpfCnpj,
    companyType,
    birthDate,
    mobilePhone,
    phone,
    incomeValue,
    address,
    addressNumber,
    complement,
    province,
    postalCode,
    site,
    externalReference,
  } = {}) {
    requireField(name, 'name');
    requireField(email, 'email');
    requireField(cpfCnpj, 'cpfCnpj');
    requireField(incomeValue, 'incomeValue');

    const doc = digitsOnly(cpfCnpj);
    const kind = documentKind(doc);
    if (!kind) throw new AsaasError('CPF/CNPJ inválido', { code: 'invalid_document' });

    // O Asaas exige `companyType` para CNPJ e RECUSA o campo para CPF — mandar o errado
    // derruba a criacao inteira com erro de validacao.
    if (kind === 'CNPJ') {
      const type = String(companyType || '').trim().toUpperCase();
      if (!COMPANY_TYPES.includes(type)) {
        throw new AsaasError(
          `Tipo de empresa inválido: ${companyType} (use ${COMPANY_TYPES.join('|')})`,
          { code: 'invalid_company_type' },
        );
      }
      companyType = type;
    } else {
      companyType = undefined;
      // Nascimento so faz sentido (e so e' exigido) para pessoa fisica.
      requireField(birthDate, 'birthDate');
    }

    const body = {
      name,
      email,
      loginEmail: loginEmail || email,
      cpfCnpj: doc,
      companyType,
      birthDate: kind === 'CPF' ? toDateOnly(birthDate) : undefined,
      mobilePhone: mobilePhone || undefined,
      phone: phone || undefined,
      incomeValue: Number(incomeValue),
      address: address || undefined,
      addressNumber: addressNumber || undefined,
      complement: complement || undefined,
      province: province || undefined,
      postalCode: postalCode ? digitsOnly(postalCode) : undefined,
      site: site || undefined,
      externalReference: externalReference || undefined,
    };

    const created = await client.post('/v3/accounts', { body });
    return {
      id: created?.id ? String(created.id) : null,
      walletId: created?.walletId ? String(created.walletId) : null,
      accountNumber: created?.accountNumber || null,
    };
  }

  /**
   * Busca uma subconta ja criada por CPF/CNPJ. Serve a idempotencia: se a criacao der certo
   * no Asaas e a gravacao local falhar (rede, deploy no meio), o retry acha a subconta em vez
   * de tentar criar a segunda — e o Asaas recusaria a segunda de qualquer forma, com erro
   * generico de documento duplicado.
   * @returns { id, walletId } ou null.
   */
  async function getSubaccountByCpfCnpj(cpfCnpj) {
    const doc = digitsOnly(cpfCnpj);
    if (!doc) return null;
    const res = await client.get('/v3/accounts', { query: { cpfCnpj: doc } });
    const found = Array.isArray(res?.data) ? res.data[0] : null;
    if (!found) return null;
    // Conferir o documento do retorno, e nao confiar no filtro: se o `cpfCnpj` da query fosse
    // ignorado, o primeiro item da lista seria a subconta de OUTRO estabelecimento — e o
    // chamador gravaria a carteira alheia, mandando o sinal para a conta errada.
    if (found.cpfCnpj && digitsOnly(found.cpfCnpj) !== doc) return null;
    return {
      id: found?.id ? String(found.id) : null,
      walletId: found?.walletId ? String(found.walletId) : null,
      accountNumber: found?.accountNumber || null,
    };
  }

  return { createSubaccount, getSubaccountByCpfCnpj };
}

// Instancia default ligada ao client de config.
const defaultAccounts = createAsaasAccounts();
export const { createSubaccount, getSubaccountByCpfCnpj } = defaultAccounts;
export default defaultAccounts;
