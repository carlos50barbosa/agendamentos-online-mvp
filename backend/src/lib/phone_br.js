// backend/src/lib/phone_br.js
// Fonte única da normalização de telefone BR. Antes a regra estava duplicada em
// agendamentos.js e agendamentos_public.js, e o PUT /auth/me não normalizava nada — o que deixou
// a base com uma mistura de 11 e 13 dígitos para o mesmo tipo de dado.
//
// Formato canônico no banco: E.164 sem o "+", ou seja 55 + DDD + número (12 ou 13 dígitos).

export function toDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Normaliza para E.164-BR (55 + DDD + número).
 *
 * A sutileza que as cópias antigas erravam: 55 TAMBÉM É DDD (Santa Maria/RS). Um `startsWith('55')`
 * cru trata 55999998888 (número local de 11 dígitos) como se já tivesse código de país e grava sem
 * o 55 — ficando indistinguível de um DDD 55 sem país. Por isso o teste é pelo COMPRIMENTO:
 * número local tem 10 ou 11 dígitos; com país, 12 ou 13.
 *
 * Devolve '' quando não dá para normalizar com segurança (o chamador decide se rejeita).
 */
export function normalizePhoneBR(value) {
  let digits = toDigits(value).replace(/^0+/, '');
  if (!digits) return '';

  // Já em E.164-BR: 55 + 10/11 dígitos.
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;

  // Local (DDD + número) → prefixa o país.
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;

  return '';
}

/** true quando o valor vira um telefone BR válido. */
export function isValidPhoneBR(value) {
  return normalizePhoneBR(value).length >= 12;
}
