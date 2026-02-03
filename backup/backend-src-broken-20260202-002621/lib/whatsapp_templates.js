// backend/src/lib/whatsapp_templates.js

const toSafeText = (value) => {
const text = String(value == null ? '' : value).trim();
return text ? text : '-';
};
export function isConfirmacaoAgendamentoV2(name) {
return String(name || '').trim().toLowerCase() === 'confirmacao_agendamento_v2';
}

export function buildConfirmacaoAgendamentoV2Components({
serviceLabel, dataHoraLabel, estabelecimentoNome, } = {}) {
return [ toSafeText(serviceLabel), toSafeText(dataHoraLabel), toSafeText(estabelecimentoNome), ];
}


