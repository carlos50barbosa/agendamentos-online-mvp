function parseBool(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

/**
 * Lista de estabelecimentos que enxergam a conexão do WhatsApp.
 *
 * ─── Por que existe ────────────────────────────────────────────────────────────────────────────
 *
 * A flag é booleana e global: ligada, os 93 estabelecimentos veem o botão de conectar. Só que
 * conectar hoje significa MIGRAR o número para a Cloud API — e o dono perde o aplicativo WhatsApp
 * Business naquele número, que é onde ele conversa com as clientes o dia inteiro. Enquanto a
 * coexistência não estiver de pé, deixar isso aberto convida a um estrago difícil de desfazer.
 *
 * Fechar tudo também não serve: os analistas da Meta têm as credenciais do estabelecimento de teste
 * e precisam ver a tela que a submissão do App Review descreve.
 *
 * Daí a lista. **Vazia ou ausente = comportamento de antes** (todos), para que ligá-la seja decisão
 * explícita e não efeito colateral de subir esta versão.
 *
 * Lida a cada chamada, e não no carregamento do módulo: assim adicionar um estabelecimento é uma
 * linha no `.env` mais `pm2 reload --update-env`, sem rebuild e sem deploy do frontend.
 */
export function getWhatsAppConnectAllowlist(env = process.env) {
  return String(env.WHATSAPP_CONNECT_ALLOWLIST || '')
    .split(',')
    .map((parte) => Number(String(parte).trim()))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * A feature está ligada de modo geral? SEM considerar a lista.
 *
 * Existe para o único caminho sem estabelecimento identificado — o callback do OAuth, que apenas
 * redireciona para o painel. Não use isto para decidir o que alguém pode ver ou fazer.
 */
export function isWhatsAppConnectFeatureOn(env = process.env) {
  return parseBool(env.WHATSAPP_CONNECT_ENABLED);
}

/**
 * Este estabelecimento pode usar a conexão do WhatsApp?
 *
 * Fail-closed quando há lista e não sabemos de quem se trata: sem identificar, não libera. O erro
 * caro aqui é liberar para quem não devia, não o contrário.
 */
export function isWhatsAppConnectEnabled(estabelecimentoId = null, env = process.env) {
  if (!isWhatsAppConnectFeatureOn(env)) return false;
  const lista = getWhatsAppConnectAllowlist(env);
  if (!lista.length) return true;
  const id = Number(estabelecimentoId);
  if (!Number.isFinite(id) || id <= 0) return false;
  return lista.includes(id);
}

/**
 * O que a TELA recebe. Quem está fora da lista vê exatamente o mesmo que veria com a feature
 * desligada — a existência da lista não é assunto do estabelecimento.
 */
export function getWhatsAppConnectFeatureState(estabelecimentoId = null, env = process.env) {
  const enabled = isWhatsAppConnectEnabled(estabelecimentoId, env);
  return {
    feature_enabled: enabled,
    mode: enabled ? 'enabled' : 'coming_soon',
    message: enabled
      ? 'Integração com WhatsApp Business habilitada.'
      : 'Integração com WhatsApp Business em breve.',
  };
}

export default {
  isWhatsAppConnectEnabled,
  isWhatsAppConnectFeatureOn,
  getWhatsAppConnectAllowlist,
  getWhatsAppConnectFeatureState,
};
