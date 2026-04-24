import {
  disconnectEstablishmentMpAccount,
  getEstablishmentMpAccountByEstabelecimentoId,
  getEstablishmentMpAccountByMpCollectorId,
  getEstablishmentMpAccountByMpUserId,
  getEstablishmentMpAccountBySellerIdentifier,
  getEstablishmentMpPublicKey,
  isMpDepositFallbackAllowed,
  refreshEstablishmentMpAccessToken,
  resolveEstablishmentMpAccessToken,
  summarizeEstablishmentMpAccount,
  upsertEstablishmentMpAccount,
} from './establishmentMpAccounts.js'

export { isMpDepositFallbackAllowed }

export async function getMpAccountByEstabelecimentoId(estabelecimentoId) {
  return getEstablishmentMpAccountByEstabelecimentoId(estabelecimentoId)
}

export async function getMpAccountByMpUserId(mpUserId) {
  return getEstablishmentMpAccountByMpUserId(mpUserId)
}

export async function getMpAccountByMpCollectorId(mpCollectorId) {
  return getEstablishmentMpAccountByMpCollectorId(mpCollectorId)
}

export async function getMpAccountBySellerIdentifier(identifier) {
  return getEstablishmentMpAccountBySellerIdentifier(identifier)
}

export async function upsertMpAccount({
  estabelecimentoId,
  mpUserId,
  mpCollectorId = null,
  accessTokenEnc = null,
  accessTokenEncrypted = null,
  refreshTokenEnc = null,
  refreshTokenEncrypted = null,
  publicKey = null,
  expiresAt = null,
  tokenExpiresAt = null,
  scope = null,
  status = 'connected',
  rawOauthMetadata = null,
  tokenLast4 = null,
}) {
  return upsertEstablishmentMpAccount({
    estabelecimentoId,
    mpUserId,
    mpCollectorId,
    accessTokenEnc,
    accessTokenEncrypted,
    refreshTokenEnc,
    refreshTokenEncrypted,
    publicKey,
    expiresAt,
    tokenExpiresAt,
    scope,
    status,
    rawOauthMetadata,
    tokenLast4,
  })
}

export async function disconnectMpAccount(estabelecimentoId) {
  return disconnectEstablishmentMpAccount(estabelecimentoId)
}

export async function resolveMpAccessToken(estabelecimentoId, options = {}) {
  return resolveEstablishmentMpAccessToken(estabelecimentoId, options)
}

export async function refreshMpAccessToken(accountOrEstabelecimentoId) {
  return refreshEstablishmentMpAccessToken(accountOrEstabelecimentoId)
}

export async function getMpPublicKey(estabelecimentoId, options = {}) {
  return getEstablishmentMpPublicKey(estabelecimentoId, options)
}

export function summarizeMpAccount(account) {
  return summarizeEstablishmentMpAccount(account)
}
