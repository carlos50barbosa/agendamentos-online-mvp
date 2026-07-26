// src/utils/legal.js

export const LEGAL_METADATA = Object.freeze({
  terms: {
    // 2026-07-26: nova seção 10 (Conexão do WhatsApp Business). Repassa ao estabelecimento as
    // proibições que a Meta exige no contrato com o cliente (Tech Provider Terms, §5).
    // ATENÇÃO: subir a versão NÃO coleta reaceite — `termsVersion` só é enviado no cadastro.
    // Quem já tem conta segue vinculado ao texto anterior até aceitar em algum fluxo.
    version: '2026-07-26',
    updatedAt: '26 de julho de 2026',
    title: 'Termos de Uso',
  },
  privacy: {
    // 2026-07-26: nova seção 7 (Solicitações de autoridades públicas) e identificação do
    // controlador pela razão social. Mudança material — por isso a versão sobe.
    version: '2026-07-26',
    updatedAt: '26 de julho de 2026',
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

