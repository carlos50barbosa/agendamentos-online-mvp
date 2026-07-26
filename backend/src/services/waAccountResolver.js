import { decryptAccessToken } from './waCrypto.js';
import { getWaAccountByEstabelecimentoId, getWaAccountByPhoneNumberId } from './waTenant.js';

function normalizeTenantId(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.trunc(numeric);
}

/** Aceita as duas grafias porque os chamadores divergem: `phoneNumberId` e `phone_number_id`. */
function normalizePhoneNumberId(context) {
  return String(context?.phoneNumberId || context?.phone_number_id || '').trim();
}

/** Uma conta serve para enviar? Precisa estar conectada E ter token que descriptografa. */
function accountToConfig(account, decryptToken) {
  if (
    !account ||
    account.status !== 'connected' ||
    !account.phone_number_id ||
    !account.access_token_enc
  ) {
    return null;
  }
  const token = decryptToken(account.access_token_enc);
  if (!token) return null;
  return {
    token,
    phoneId: account.phone_number_id,
    estabelecimentoId: account.estabelecimento_id,
    fallback: false,
  };
}

export async function resolveWhatsAppTenantConfig(context = {}, deps = {}) {
  const estabelecimentoId = normalizeTenantId(context?.estabelecimentoId);
  const phoneNumberId = normalizePhoneNumberId(context);
  const getAccount = deps.getWaAccountByEstabelecimentoId || getWaAccountByEstabelecimentoId;
  const getAccountByPhoneId = deps.getWaAccountByPhoneNumberId || getWaAccountByPhoneNumberId;
  const decryptToken = deps.decryptAccessToken || decryptAccessToken;
  const defaultToken = deps.defaultToken ?? process.env.WA_DEFAULT_TOKEN ?? process.env.WA_TOKEN ?? null;
  const defaultPhoneId = deps.defaultPhoneId ?? process.env.WA_PHONE_NUMBER_ID ?? null;

  if (estabelecimentoId) {
    try {
      const resolved = accountToConfig(await getAccount(estabelecimentoId), decryptToken);
      if (resolved) return resolved;
    } catch (err) {
      console.warn('[wa][tenant] resolve failed', err?.message || err);
    }
  }

  // Sem tenant explícito, o número QUE RECEBEU a mensagem é quem deve responder.
  //
  // Isto existe para as respostas de webhook (AUTORIZO, PARAR, "veio errado"): elas só conhecem o
  // `phoneNumberId`, e antes ele era carregado no contexto e ignorado aqui — então a resposta saía
  // sempre pelo número da plataforma. Quem escrevesse para o número de um estabelecimento receberia
  // resposta de OUTRO número, e para esse outro número a janela de 24h não está aberta na visão da
  // Meta: o texto falharia, cairia para template, e o envio morreria — o mesmo silêncio de sempre.
  //
  // Hoje isso quase não morde porque só existe a WABA da plataforma. Vira bug real no primeiro
  // tenant conectado por embedded signup, e a confirmação de saída é justamente a mensagem que a
  // Meta espera que saia.
  if (phoneNumberId) {
    try {
      const resolved = accountToConfig(await getAccountByPhoneId(phoneNumberId), decryptToken);
      if (resolved) return resolved;
    } catch (err) {
      console.warn('[wa][tenant] resolve by phone_number_id failed', err?.message || err);
    }
  }

  if (defaultToken && defaultPhoneId) {
    return {
      token: defaultToken,
      phoneId: defaultPhoneId,
      estabelecimentoId,
      fallback: true,
    };
  }

  return { token: null, phoneId: null, estabelecimentoId, fallback: false };
}

export default resolveWhatsAppTenantConfig;
