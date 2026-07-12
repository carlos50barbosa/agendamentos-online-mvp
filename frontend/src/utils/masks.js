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
