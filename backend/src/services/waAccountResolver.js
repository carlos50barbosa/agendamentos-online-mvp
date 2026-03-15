import { decryptAccessToken } from './waCrypto.js';
import { getWaAccountByEstabelecimentoId } from './waTenant.js';

function normalizeTenantId(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.trunc(numeric);
}

export async function resolveWhatsAppTenantConfig(context = {}, deps = {}) {
  const estabelecimentoId = normalizeTenantId(context?.estabelecimentoId);
  const getAccount = deps.getWaAccountByEstabelecimentoId || getWaAccountByEstabelecimentoId;
  const decryptToken = deps.decryptAccessToken || decryptAccessToken;
  const defaultToken = deps.defaultToken ?? process.env.WA_DEFAULT_TOKEN ?? process.env.WA_TOKEN ?? null;
  const defaultPhoneId = deps.defaultPhoneId ?? process.env.WA_PHONE_NUMBER_ID ?? null;

  if (estabelecimentoId) {
    try {
      const account = await getAccount(estabelecimentoId);
      if (
        account &&
        account.status === 'connected' &&
        account.phone_number_id &&
        account.access_token_enc
      ) {
        const token = decryptToken(account.access_token_enc);
        if (token) {
          return {
            token,
            phoneId: account.phone_number_id,
            estabelecimentoId: account.estabelecimento_id,
            fallback: false,
          };
        }
      }
    } catch (err) {
      console.warn('[wa][tenant] resolve failed', err?.message || err);
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
