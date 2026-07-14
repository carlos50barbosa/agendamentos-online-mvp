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

/**
 * Os 67 DDDs que existem. Não é 11..99: 20, 23, 25, 26, 29, 30, 36, 39, 40, 50, 52, 56-60, 70, 72,
 * 76, 78, 80 e 90 nunca foram atribuídos.
 */
const DDD_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Este número tem chance real de existir e receber WhatsApp?
 *
 * `isValidPhoneBR` só conta dígitos — aceita DDD 00, aceita telefone fixo, aceita celular começando
 * com 8. Serve para "cadastrei um telefone"; não serve para decidir um ENVIO.
 *
 * Por que a distinção passou a importar: enquanto a WABA estava banida, mandar para número
 * impossível não custava nada. Agora custa. Não é que a nota de qualidade despenque por entrega
 * falha — ela é dirigida por bloqueio e denúncia. O problema é outro, e é mais sério: uma taxa alta
 * de destinatário inexistente é a assinatura de lista raspada ou comprada, que é exatamente o
 * padrão que a Meta procura. E, no caminho, cada tentativa dessas debita a carteira do
 * estabelecimento por uma mensagem que nunca chegou a lugar nenhum.
 *
 * A régua é o IMPOSSÍVEL, não o improvável:
 *
 *   13 dígitos + nono dígito 9 ....... celular atual. Aceita.
 *   12 dígitos + primeiro 6..9 ....... celular anterior à migração do nono dígito. Aceita — a Meta
 *                                      normaliza, e é um envio que está FUNCIONANDO em produção
 *                                      (551199873664). Barrar isso quebraria cliente de verdade.
 *   12 dígitos + primeiro 2..5 ....... telefone FIXO. Rejeita: não recebe WhatsApp.
 *   13 dígitos + nono dígito != 9 .... não existe. Nenhum celular brasileiro começa com 8.
 *   DDD fora da lista ................ não existe.
 */
export function isValidMobileBR(value) {
  const e164 = normalizePhoneBR(value);
  if (e164.length !== 12 && e164.length !== 13) return false;

  const ddd = Number(e164.slice(2, 4));
  if (!DDD_VALIDOS.has(ddd)) return false;

  const primeiro = e164[4];
  if (e164.length === 13) return primeiro === '9';
  return primeiro >= '6' && primeiro <= '9';
}
