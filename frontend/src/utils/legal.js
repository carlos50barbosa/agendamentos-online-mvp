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

export function getLegalVersion(key) {
  return LEGAL_METADATA[key]?.version || '';
}

export function getLegalUpdatedAt(key) {
  return LEGAL_METADATA[key]?.updatedAt || '';
}

