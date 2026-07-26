// backend/src/lib/meta_signed_request.js
// Verificação do `signed_request` que a Meta envia nos callbacks de app (desautorização e
// exclusão de dados).
//
// O formato é `<assinatura>.<payload>`, ambos em base64url. A assinatura é um HMAC-SHA256 do
// PAYLOAD AINDA CODIFICADO (a string entre os pontos, não o JSON decodificado) usando o app secret.
// Decodificar antes de conferir é o erro clássico: a assinatura nunca bate e ninguém entende por quê.
//
// Isto é o único portão desses endpoints: eles são públicos, sem sessão e sem token. Quem forjar um
// signed_request válido desconecta a conta de WhatsApp de qualquer estabelecimento. Por isso:
//   - assinatura conferida com comparação de tempo constante (timingSafeEqual);
//   - algoritmo conferido — aceitar o `algorithm` que o payload declarar é aceitar "algorithm: none";
//   - sem app secret configurado, REJEITA. Falha fechada: sem segredo não há verificação possível,
//     e responder 200 nesse estado seria dizer "confio em qualquer um".
import crypto from 'node:crypto';

function base64UrlToBuffer(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

/**
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
export function parseMetaSignedRequest(signedRequest, appSecret) {
  const raw = String(signedRequest || '').trim();
  if (!raw) return { ok: false, error: 'missing_signed_request' };

  const secret = String(appSecret || '').trim();
  if (!secret) return { ok: false, error: 'app_secret_not_configured' };

  const partes = raw.split('.');
  if (partes.length !== 2) return { ok: false, error: 'malformed_signed_request' };

  const [assinaturaB64, payloadB64] = partes;
  if (!assinaturaB64 || !payloadB64) return { ok: false, error: 'malformed_signed_request' };

  let esperado;
  try {
    // HMAC sobre a string codificada, exatamente como veio no corpo.
    esperado = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  } catch {
    return { ok: false, error: 'hmac_failed' };
  }

  const recebido = base64UrlToBuffer(assinaturaB64);
  if (recebido.length !== esperado.length) return { ok: false, error: 'invalid_signature' };
  if (!crypto.timingSafeEqual(recebido, esperado)) return { ok: false, error: 'invalid_signature' };

  let data;
  try {
    data = JSON.parse(base64UrlToBuffer(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, error: 'invalid_payload' };
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'invalid_payload' };

  // Só depois de a assinatura bater é que olhamos o conteúdo — e ainda assim não confiamos no
  // algoritmo declarado: ele tem de ser o que nós verificamos.
  const algoritmo = String(data.algorithm || '').toUpperCase();
  if (algoritmo !== 'HMAC-SHA256') return { ok: false, error: 'unsupported_algorithm' };

  return { ok: true, data };
}

/** O ID do usuário na escala do app (app-scoped). É o que liga o callback a uma conexão nossa. */
export function getSignedRequestUserId(data) {
  const id = data?.user_id;
  if (id === undefined || id === null) return null;
  const texto = String(id).trim();
  return texto || null;
}
