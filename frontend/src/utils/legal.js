// src/utils/legal.js

export const LEGAL_METADATA = Object.freeze({
  terms: {
    version: '2025-10-26',
    updatedAt: '26 de outubro de 2025',
    title: 'Termos de Uso',
  },
  privacy: {
    version: '2025-10-26',
    updatedAt: '26 de outubro de 2025',
    title: 'Política de Privacidade',
  },
});

/**
 * Identificação da pessoa jurídica por trás da plataforma.
 * A razão social precisa aparecer no site: a verificação de empresa da Meta
 * compara o texto do domínio com o nome registrado no CNPJ e recusa quando
 * não encontra. `cnpj` é opcional — só é renderizado quando preenchido.
 */
export const LEGAL_ENTITY = Object.freeze({
  name: '68.068.260 JOSE CARLOS BARBOSA',
  cnpj: '68.068.260/0001-32',
});

/** Ex.: "68.068.260 JOSE CARLOS BARBOSA — CNPJ 00.000.000/0001-00" */
export function getLegalEntityLine() {
  return [LEGAL_ENTITY.name, LEGAL_ENTITY.cnpj && `CNPJ ${LEGAL_ENTITY.cnpj}`]
    .filter(Boolean)
    .join(' — ');
}

export function getLegalVersion(key) {
  return LEGAL_METADATA[key]?.version || '';
}

export function getLegalUpdatedAt(key) {
  return LEGAL_METADATA[key]?.updatedAt || '';
}

