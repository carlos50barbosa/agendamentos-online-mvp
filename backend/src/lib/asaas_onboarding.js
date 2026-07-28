// backend/src/lib/asaas_onboarding.js
// Abertura da subconta Asaas do estabelecimento PELA plataforma.
//
// O problema que isto resolve: ate aqui, para receber sinal, o dono precisava abrir conta no
// Asaas, achar o Wallet ID no menu de Integracoes e colar nas Configuracoes. Parte dos saloes
// empacava nesse passo. Com a conta da plataforma em CNPJ, `POST /v3/accounts` passa a ser
// possivel e o walletId nasce preenchido.
//
// O caminho manual NAO morre: um CPF/CNPJ que ja tem conta Asaas nao pode virar subconta, e
// para esses o unico caminho e' colar o Wallet ID.
//
// `db` e `accounts` sao injetaveis para os testes rodarem sem banco e sem rede.
import { pool } from './db.js';
import { createAsaasAccounts, COMPANY_TYPES } from '../services/asaas/accounts.js';
import { AsaasError } from '../services/asaas/client.js';
import {
  digitsOnly,
  documentKind,
  isValidCpfCnpj,
  normalizeBrazilMobile,
  normalizePostalCode,
} from './br_documents.js';

/**
 * Versao do texto de autorizacao exibido no aceite. Subir aqui quando o texto mudar — o valor
 * fica gravado na linha, entao da' para saber DEPOIS a que o dono aceitou, e nao so que aceitou.
 */
export const ASAAS_ONBOARDING_TERMS_VERSION = '2026-07-28';

export class AsaasOnboardingError extends Error {
  constructor(code, message, { status = 400, details = null } = {}) {
    super(message);
    this.name = 'AsaasOnboardingError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Campos que o Asaas exige, por tipo de documento. */
const COMMON_REQUIRED = ['name', 'email', 'cpfCnpj', 'mobilePhone', 'incomeValue', 'postalCode', 'address', 'addressNumber', 'province'];

function requiredFieldsFor(cpfCnpj) {
  const kind = documentKind(cpfCnpj);
  if (kind === 'CNPJ') return [...COMMON_REQUIRED, 'companyType'];
  // Sem documento ainda nao da' para saber o ramo; pedir nascimento e' o palpite seguro
  // (a maioria dos saloes se cadastra com CPF).
  return [...COMMON_REQUIRED, 'birthDate'];
}

function trimmed(value) {
  return value == null ? '' : String(value).trim();
}

/** 'YYYY-MM-DD' a partir do que o MySQL devolve (DATE vira Date em algumas configs). */
function toIsoDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

async function loadEstablishmentProfile(estabelecimentoId, db) {
  const [rows] = await db.query(
    `SELECT nome, email, telefone, data_nascimento, cpf_cnpj,
            cep, endereco, numero, complemento, bairro, cidade, estado
       FROM usuarios WHERE id=? LIMIT 1`,
    [estabelecimentoId],
  );
  return rows?.[0] || null;
}

async function loadAsaasSettings(estabelecimentoId, db) {
  const [rows] = await db.query(
    `SELECT asaas_wallet_id, asaas_account_id, asaas_subaccount_created_at,
            asaas_onboarding_accepted_at
       FROM establishment_settings WHERE estabelecimento_id=? LIMIT 1`,
    [estabelecimentoId],
  );
  return rows?.[0] || null;
}

/**
 * Monta o rascunho da subconta a partir do cadastro que o dono JA preencheu, e diz o que
 * falta. O front usa isso para pre-preencher o formulario e pedir so o buraco — pedir tudo de
 * novo seria reintroduzir o atrito que esta feature existe para remover.
 *
 * `incomeValue` e `companyType` nunca vem do cadastro: nao existem no perfil e sao sempre
 * perguntados.
 */
export async function buildSubaccountDraft(estabelecimentoId, { db = pool } = {}) {
  const profile = await loadEstablishmentProfile(estabelecimentoId, db);
  if (!profile) throw new AsaasOnboardingError('establishment_not_found', 'Estabelecimento não encontrado.', { status: 404 });

  const settings = await loadAsaasSettings(estabelecimentoId, db);
  const doc = digitsOnly(profile.cpf_cnpj);

  const draft = {
    name: trimmed(profile.nome),
    email: trimmed(profile.email).toLowerCase(),
    cpfCnpj: doc,
    documentKind: documentKind(doc),
    birthDate: toIsoDate(profile.data_nascimento),
    companyType: '',
    mobilePhone: normalizeBrazilMobile(profile.telefone) || '',
    incomeValue: '',
    postalCode: normalizePostalCode(profile.cep) || '',
    address: trimmed(profile.endereco),
    addressNumber: trimmed(profile.numero),
    complement: trimmed(profile.complemento),
    province: trimmed(profile.bairro),
  };

  const missing = requiredFieldsFor(doc).filter((field) => !trimmed(draft[field]));

  return {
    draft,
    missing,
    termsVersion: ASAAS_ONBOARDING_TERMS_VERSION,
    walletId: settings?.asaas_wallet_id || null,
    accountId: settings?.asaas_account_id || null,
    // A data de criacao e' o que distingue subconta (aberta por nos) de wallet colada na mao.
    walletSource: settings?.asaas_wallet_id
      ? (settings?.asaas_subaccount_created_at ? 'subconta' : 'manual')
      : null,
    subaccountCreatedAt: settings?.asaas_subaccount_created_at || null,
  };
}

/** Junta o cadastro com o que o dono corrigiu/completou no formulario e valida. */
function resolvePayload(draft, overrides = {}) {
  const merged = { ...draft };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value === undefined || value === null) continue;
    if (Object.prototype.hasOwnProperty.call(merged, key)) merged[key] = value;
  }

  const cpfCnpj = digitsOnly(merged.cpfCnpj);
  if (!isValidCpfCnpj(cpfCnpj)) {
    // O Asaas devolve erro generico para documento invalido; falhar aqui da' mensagem util.
    throw new AsaasOnboardingError('invalid_document', 'CPF/CNPJ inválido. Confira os números informados.');
  }
  const kind = documentKind(cpfCnpj);

  const mobilePhone = normalizeBrazilMobile(merged.mobilePhone);
  if (!mobilePhone) {
    throw new AsaasOnboardingError('invalid_mobile_phone', 'Informe um celular válido com DDD (11 dígitos).');
  }

  const postalCode = normalizePostalCode(merged.postalCode);
  if (!postalCode) {
    throw new AsaasOnboardingError('invalid_postal_code', 'Informe um CEP válido (8 dígitos).');
  }

  // Renda/faturamento mensal: o Asaas usa como perfil de risco e retem saldo quando o volume
  // transacionado destoa do declarado. Nao ha default seguro — tem de vir do dono.
  const incomeValue = Number(String(merged.incomeValue).replace(',', '.'));
  if (!Number.isFinite(incomeValue) || incomeValue <= 0) {
    throw new AsaasOnboardingError('invalid_income_value', 'Informe o faturamento mensal aproximado.');
  }

  let companyType;
  let birthDate;
  if (kind === 'CNPJ') {
    companyType = String(merged.companyType || '').trim().toUpperCase();
    if (!COMPANY_TYPES.includes(companyType)) {
      throw new AsaasOnboardingError('invalid_company_type', 'Selecione o tipo de empresa do seu CNPJ.');
    }
  } else {
    birthDate = toIsoDate(merged.birthDate);
    if (!birthDate) {
      throw new AsaasOnboardingError('invalid_birth_date', 'Informe a data de nascimento do titular do CPF.');
    }
  }

  const missing = requiredFieldsFor(cpfCnpj).filter((field) => {
    if (field === 'cpfCnpj' || field === 'mobilePhone' || field === 'postalCode') return false;
    if (field === 'incomeValue' || field === 'companyType' || field === 'birthDate') return false;
    return !trimmed(merged[field]);
  });
  if (missing.length) {
    throw new AsaasOnboardingError('missing_fields', 'Complete os dados obrigatórios para abrir a conta.', {
      details: { missing },
    });
  }

  return {
    name: trimmed(merged.name),
    email: trimmed(merged.email).toLowerCase(),
    loginEmail: trimmed(merged.email).toLowerCase(),
    cpfCnpj,
    companyType,
    birthDate,
    mobilePhone,
    incomeValue,
    postalCode,
    address: trimmed(merged.address),
    addressNumber: trimmed(merged.addressNumber),
    complement: trimmed(merged.complement) || undefined,
    province: trimmed(merged.province),
  };
}

/**
 * Abre a subconta e grava walletId + accountId + a trilha do aceite.
 *
 * @param {object} p
 * @param {number} p.estabelecimentoId
 * @param {object} [p.overrides] campos corrigidos/completados no formulario
 * @param {{accepted:boolean, ip?:string, termsVersion?:string}} p.consent
 * @returns {{ walletId, accountId, created:boolean, reused:boolean }}
 */
export async function createEstablishmentSubaccount({
  estabelecimentoId,
  overrides = {},
  consent = {},
  db = pool,
  accounts = createAsaasAccounts(),
} = {}) {
  // Sem aceite nao se abre conta financeira em nome de terceiro. Antes de qualquer chamada
  // ao Asaas: o consentimento e' pre-requisito, nao detalhe de auditoria.
  if (consent?.accepted !== true) {
    throw new AsaasOnboardingError('consent_required', 'É necessário autorizar a abertura da conta de recebimento.');
  }

  const existing = await loadAsaasSettings(estabelecimentoId, db);
  if (existing?.asaas_wallet_id) {
    throw new AsaasOnboardingError(
      'wallet_already_configured',
      'Este estabelecimento já tem uma carteira Asaas configurada.',
      { status: 409, details: { walletId: existing.asaas_wallet_id } },
    );
  }

  const { draft } = await buildSubaccountDraft(estabelecimentoId, { db });
  const payload = resolvePayload(draft, overrides);

  // Idempotencia: se uma tentativa anterior criou a subconta e morreu antes de gravar
  // (rede, restart), o retry reaproveita em vez de bater num erro de documento duplicado.
  let account = await accounts.getSubaccountByCpfCnpj(payload.cpfCnpj).catch(() => null);
  const reused = Boolean(account?.walletId);

  if (!reused) {
    try {
      account = await accounts.createSubaccount({
        ...payload,
        externalReference: `estabelecimento:${estabelecimentoId}`,
      });
    } catch (err) {
      if (err instanceof AsaasError) {
        // 403 = a PLATAFORMA nao pode criar subcontas (permissao da nossa conta), e nao um
        // problema no cadastro que o dono acabou de preencher. Medido em 28/07/2026: com a
        // conta ja PJ, MEI e com general/commercialInfo/documentation APPROVED, o Asaas ainda
        // devolvia 403 dizendo "contas de pessoa fisica nao podem criar subcontas" — mensagem
        // que nao descreve o estado real e culpa o usuario errado. Repassa-la seria mandar o
        // dono do salao caçar um problema que e' nosso.
        if (err.status === 403) {
          console.error('[asaas][subconta] criacao NEGADA pelo Asaas (403):', err.message);
          throw new AsaasOnboardingError(
            'subaccount_not_enabled',
            'A abertura automática de conta está indisponível no momento. Enquanto isso, se você já tem conta no Asaas, informe o Wallet ID em "Já tenho conta no Asaas".',
            { status: 503, details: err.body || null },
          );
        }
        // Nos demais casos a mensagem do Asaas E' acionavel pelo dono ("documento ja
        // cadastrado", "telefone invalido") — repassar e' melhor que traduzir para um texto
        // generico, que ja custou caro em diagnostico nos outros fluxos.
        throw new AsaasOnboardingError('asaas_rejected', err.message, { status: 400, details: err.body || null });
      }
      throw err;
    }
  }

  if (!account?.walletId) {
    throw new AsaasOnboardingError('subaccount_without_wallet', 'O Asaas criou a conta mas não devolveu o Wallet ID. Verifique no painel antes de tentar de novo.', { status: 502 });
  }

  // UPSERT unico: a linha pode nao existir (settings nunca salvos) e todas as colunas de
  // deposito tem default, entao o INSERT parcial e' valido. Uma instrucao so' ja e' atomica.
  //
  // `wallet_verified_at` fica NULL de proposito: "verificada" no painel significa exercitada
  // numa cobranca real, e essa carteira ainda nao recebeu nenhuma.
  await db.query(
    `INSERT INTO establishment_settings
       (estabelecimento_id, asaas_wallet_id, asaas_account_id, wallet_verified_at,
        asaas_subaccount_created_at, asaas_onboarding_terms_version,
        asaas_onboarding_accepted_at, asaas_onboarding_accepted_ip)
     VALUES (?,?,?,NULL,NOW(),?,NOW(3),?)
     ON DUPLICATE KEY UPDATE
       asaas_wallet_id=VALUES(asaas_wallet_id),
       asaas_account_id=VALUES(asaas_account_id),
       wallet_verified_at=NULL,
       asaas_subaccount_created_at=VALUES(asaas_subaccount_created_at),
       asaas_onboarding_terms_version=VALUES(asaas_onboarding_terms_version),
       asaas_onboarding_accepted_at=VALUES(asaas_onboarding_accepted_at),
       asaas_onboarding_accepted_ip=VALUES(asaas_onboarding_accepted_ip)`,
    [
      estabelecimentoId,
      account.walletId,
      account.id || null,
      consent.termsVersion || ASAAS_ONBOARDING_TERMS_VERSION,
      consent.ip || null,
    ],
  );

  return { walletId: account.walletId, accountId: account.id || null, created: !reused, reused };
}
