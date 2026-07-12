// src/components/settings/helpers.js
// Helpers compartilhados pelas seções granulares de Configurações.

export const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

export function formatPhoneBR(s) {
  const d = onlyDigits(s).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function formatCep(s) {
  const d = onlyDigits(s).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

// Mensagem amigável a partir do erro do backend do perfil público (details[].code).
export function mapProfileError(err) {
  const detail = err?.data?.details?.[0];
  const byCode = {
    invalid_url: 'Confira os links (use o endereço completo, ex.: instagram.com/seu-perfil).',
    invalid_phone: 'Telefone inválido.',
    invalid_hex_color: 'Cor inválida — use um hexadecimal como #5049E5.',
  };
  if (detail) return byCode[detail.code] || 'Confira os campos destacados.';
  return err?.data?.message || 'Não foi possível salvar. Tente novamente.';
}
