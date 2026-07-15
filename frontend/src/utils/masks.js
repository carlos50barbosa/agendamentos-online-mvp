// src/utils/masks.js
// Máscaras de digitação (pt-BR) reutilizáveis. Formatam apenas a exibição —
// os dígitos crus são extraídos com onlyDigits() na hora de enviar ao backend.
// Mesma lógica já usada em Cadastro.jsx, centralizada para reuso.

/** Só os dígitos de um valor (para validação/envio). */
export function onlyDigits(value = '') {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Dígitos locais (DDD + número), sem o código do país.
 *
 * O telefone é gravado em E.164 (5511999998888) no cadastro, no booking e no bot; quem editou o
 * perfil pode ter 11 dígitos. Aqui os dois casos convergem para o formato local.
 *
 * O 55 só é removido acima de 11 dígitos: 55 TAMBÉM É DDD (Santa Maria/RS), e um número local
 * nunca passa de 11 dígitos — cortar "55" de um (55) 99999-8888 apagaria o DDD de quem é de lá.
 */
export function onlyLocalDigits(value = '') {
  let digits = onlyDigits(value);
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length > 11) digits = digits.slice(-11);
  return digits;
}

/** Telefone BR: (99) 99999-9999 (celular) ou (99) 9999-9999 (fixo). */
export function formatBRPhone(value = '') {
  const digits = onlyLocalDigits(value);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/**
 * Os 67 DDDs que existem. Espelha lib/phone_br.js no backend — a fonte da verdade é lá; esta cópia
 * existe porque o front não importa código do backend. Se um mudar, mude o outro.
 */
const DDD_VALIDOS_BR = new Set([
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

/** Normaliza para E.164-BR (55 + DDD + número). '' quando não dá para normalizar com segurança. */
export function normalizePhoneBR(value = '') {
  const digits = onlyDigits(value).replace(/^0+/, '');
  if (!digits) return '';
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return '';
}

/**
 * Este número tem chance real de receber WhatsApp? Espelha isValidMobileBR de lib/phone_br.js
 * (a régua e o porquê estão documentados lá). Aceita celular (13 díg. com nono 9, ou 12 díg.
 * começando 6–9); rejeita fixo e DDD inexistente.
 */
export function isValidMobileBR(value = '') {
  const e164 = normalizePhoneBR(value);
  if (e164.length !== 12 && e164.length !== 13) return false;
  const ddd = Number(e164.slice(2, 4));
  if (!DDD_VALIDOS_BR.has(ddd)) return false;
  const primeiro = e164[4];
  if (e164.length === 13) return primeiro === '9';
  return primeiro >= '6' && primeiro <= '9';
}

/** CPF (999.999.999-99) ou CNPJ (99.999.999/9999-99), conforme o tamanho. */
export function formatCpfCnpj(value = '') {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length <= 11) {
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}
