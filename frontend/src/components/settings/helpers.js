// src/components/settings/helpers.js
// Helpers compartilhados pelas seções granulares de Configurações.

import { formatBRPhone } from '../../utils/masks.js';

export const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

/**
 * Máscara do telefone. Delega para utils/masks.js — que é a fonte única e trata o código do
 * país corretamente.
 *
 * A versão que vivia aqui fazia `onlyDigits(s).slice(0, 11)`: cortava em 11 dígitos SEM
 * remover o "55" do país. Com o telefone gravado em E.164 (5512981686284), a tela passava a
 * exibir "(55) 12981-6862" — DDD errado — e, ao salvar, o backend via 11 dígitos, entendia
 * como número local e prefixava outro 55:
 *
 *   banco 5512981686284  ->  tela 55129816862  ->  banco 5555129816862
 *
 * Ou seja: bastava o dono abrir Configurações e salvar QUALQUER coisa para o WhatsApp dele
 * ser destruído — e ele parava de receber as notificações de agendamento, sem nenhum aviso.
 * E piorava a cada save (5555555512981...). A corrupção ainda PERDE os 2 últimos dígitos, o
 * que a torna irreversível: não dá para recuperar o número original a partir do corrompido.
 *
 * O masks.js já fazia certo, e explica o motivo de não se poder cortar o "55" cegamente:
 * 55 também é DDD (Santa Maria/RS).
 */
export const formatPhoneBR = formatBRPhone;

export function formatCep(s) {
  const d = onlyDigits(s).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

// Origem pública usada nos links divulgados (sempre o domínio de produção, mesmo em dev).
export function publicOrigin() {
  let origin = 'https://agenda0.com.br';
  if (typeof window !== 'undefined' && window.location?.origin?.includes('agenda0.com.br')) {
    origin = window.location.origin;
  }
  return origin;
}

// Link curto da página pública: agenda0.com.br/<slug>. Sem slug, cai no formato antigo por id.
export function publicLinkFor({ slug, id } = {}) {
  const s = String(slug || '').trim();
  if (s) return `${publicOrigin()}/${s}`;
  return id ? `${publicOrigin()}/agendar/${id}` : '';
}

export const SLUG_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

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
