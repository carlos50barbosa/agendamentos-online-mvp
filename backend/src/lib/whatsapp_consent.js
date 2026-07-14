// backend/src/lib/whatsapp_consent.js
// Consentimento (opt-in) para receber mensagens no WhatsApp.
//
// Por que isto existe: a WABA da plataforma foi desabilitada pela Meta. O projeto nunca pediu
// autorização — bastava digitar o telefone para agendar e a pessoa passava a receber template
// message de um número que ela nunca autorizou. Quem não reconhece o remetente bloqueia ou
// denuncia; a nota de qualidade cai; a Meta desabilita a conta.
//
// A regra da Meta para mensagem iniciada pelo negócio (template) é: consentimento ATIVO, que
// NOMEIE o remetente e o canal, e que seja COMPROVÁVEL. Comprovável é a palavra que manda no
// desenho deste módulo — por isso ele guarda o TEXTO que a pessoa leu, e não um booleano.
// Num recurso, "aceitou=1" não prova nada.
//
// Duas garantias que este módulo dá:
//
//   1. FAIL-CLOSED. Não deu para confirmar o consentimento (sem registro, tabela ausente, banco
//      fora do ar)? Não envia. Enviar sem poder provar a autorização é exatamente o que custou a
//      conta. Um lembrete perdido é reversível; uma WABA banida, não.
//
//   2. O TEXTO É DO SERVIDOR. `buildConsentText()` renderiza aqui a frase que a tela mostra, e é
//      essa que vai para o banco. Se o texto viesse do corpo da requisição, a "prova" seria só o
//      que o cliente HTTP disse ter mostrado — e aí não é prova, é declaração.
import { pool } from './db.js';
import { normalizePhoneBR } from './phone_br.js';
import { log } from './logger.js';
import { CONSENT_VERSION, CONSENT_AUDIENCE, buildConsentText } from './whatsapp_consent_text.js';

// O texto vive num módulo puro porque é espelhado no frontend e comparado por teste — ver o
// cabeçalho de whatsapp_consent_text.js.
export { CONSENT_VERSION, CONSENT_AUDIENCE, buildConsentText };

export const OPTIN_SOURCES = Object.freeze({
  PUBLIC_BOOKING: 'agendamento_publico',
  CLIENT_BOOKING: 'agendamento_cliente',
  SIGNUP: 'cadastro',
  CLIENT_PANEL: 'painel_cliente',
  ESTAB_SETTINGS: 'configuracoes_estab',
  WHATSAPP_STOP: 'whatsapp_parar',
});

const EVENT_GRANTED = 'granted';
const EVENT_REVOKED = 'revoked';

const truncate = (value, max) => {
  if (value == null) return null;
  const str = String(value);
  return str.length > max ? str.slice(0, max) : str;
};

/** IP e user agent da requisição, do jeito que o resto do projeto já extrai (ver audit.js). */
export function requestFingerprint(req) {
  if (!req) return { ip: null, userAgent: null };
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return {
    ip: truncate(forwarded || req.ip || req.socket?.remoteAddress || null, 64),
    userAgent: truncate(req.headers?.['user-agent'] || null, 256),
  };
}

/**
 * O último evento deste telefone — ou null se ele nunca apareceu.
 * Devolve a linha inteira porque é ela que vira a prova (quando, com que texto, de onde).
 */
export async function getWhatsAppConsent(phone) {
  const e164 = normalizePhoneBR(phone);
  if (!e164) return null;
  const [rows] = await pool.query(
    `SELECT id, telefone_e164, evento, usuario_id, estabelecimento_id, origem,
            texto_versao, texto, ip, user_agent, criado_em
       FROM whatsapp_optins
      WHERE telefone_e164 = ?
      ORDER BY id DESC
      LIMIT 1`,
    [e164]
  );
  return rows?.[0] || null;
}

/**
 * Pode enviar mensagem iniciada pelo negócio para este número?
 *
 * Fail-closed de propósito: qualquer erro (tabela ausente, banco fora) responde `false`. É a única
 * resposta honesta — não conseguimos verificar a autorização, logo não temos autorização. O erro
 * vai para o log estruturado, e o bloqueio fica registrado na carteira pelo chamador, então isso
 * não some em silêncio.
 */
export async function hasWhatsAppConsent(phone) {
  try {
    const row = await getWhatsAppConsent(phone);
    return row?.evento === EVENT_GRANTED;
  } catch (err) {
    log.error('wa_optin_check_failed', {
      reason: err?.message || String(err),
      // O telefone não vai para o log: é dado pessoal e o log não é o lugar dele.
    });
    return false;
  }
}

async function insertEvent({
  evento,
  phone,
  usuarioId = null,
  estabelecimentoId = null,
  origem,
  texto = null,
  textoVersao = null,
  ip = null,
  userAgent = null,
}) {
  const e164 = normalizePhoneBR(phone);
  if (!e164) return { ok: false, error: 'telefone_invalido' };
  if (!origem) return { ok: false, error: 'origem_obrigatoria' };

  await pool.query(
    `INSERT INTO whatsapp_optins
       (telefone_e164, evento, usuario_id, estabelecimento_id, origem, texto_versao, texto, ip, user_agent)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      e164,
      evento,
      usuarioId ?? null,
      estabelecimentoId ?? null,
      truncate(origem, 32),
      truncate(textoVersao, 16),
      texto,
      truncate(ip, 64),
      truncate(userAgent, 256),
    ]
  );
  return { ok: true, phone: e164, evento };
}

/** O nome do salão que entra no texto do aceite. Uma consulta, para o chamador não ter de fazê-la. */
async function resolveEstablishmentName(estabelecimentoId) {
  if (!estabelecimentoId) return null;
  try {
    const [[row]] = await pool.query('SELECT nome FROM usuarios WHERE id=? LIMIT 1', [estabelecimentoId]);
    return row?.nome || null;
  } catch {
    return null; // sem o nome o texto ainda é válido; sem o aceite é que não haveria envio.
  }
}

/**
 * Registra o aceite. O texto é renderizado AQUI (nunca aceita texto vindo do chamador HTTP) —
 * é o que transforma o registro em prova.
 *
 * Idempotente: quem já está autorizado não gera linha nova. O cliente fiel que agenda toda semana
 * marca a caixa toda semana; sem isto, a tabela viraria um log de cliques e a prova ficaria
 * enterrada. Uma linha por MUDANÇA de estado é o que se leva para um recurso.
 */
export async function grantWhatsAppConsent({
  phone,
  usuarioId = null,
  estabelecimentoId = null,
  establishmentName = null,
  origem,
  // Muda a frase, não a exigência: o dono do salão precisa de aceite igual ao cliente — só que o
  // que ele recebe é outra coisa, e o texto tem de descrever o que ele de fato vai receber.
  audience = CONSENT_AUDIENCE.CLIENT,
  req = null,
}) {
  const e164 = normalizePhoneBR(phone);
  if (!e164) return { ok: false, error: 'telefone_invalido' };

  const current = await getWhatsAppConsent(e164);
  if (current?.evento === EVENT_GRANTED) {
    return { ok: true, phone: e164, evento: EVENT_GRANTED, unchanged: true };
  }

  // O nome do salão só entra no texto do CLIENTE ("em nome de X"). Buscá-lo para o dono seria uma
  // consulta jogada fora.
  const nome = audience === CONSENT_AUDIENCE.ESTABLISHMENT
    ? null
    : (establishmentName ?? (await resolveEstablishmentName(estabelecimentoId)));

  const { ip, userAgent } = requestFingerprint(req);
  return insertEvent({
    evento: EVENT_GRANTED,
    phone: e164,
    usuarioId,
    estabelecimentoId,
    origem,
    texto: buildConsentText({ establishmentName: nome, audience }),
    textoVersao: CONSENT_VERSION,
    ip,
    userAgent,
  });
}

/**
 * Registra a saída. Sem texto: ninguém precisa provar que quis sair — e exigir prova para sair
 * seria transformar o opt-out em obstáculo, que é o oposto do que a Meta cobra.
 */
export async function revokeWhatsAppConsent({
  phone,
  usuarioId = null,
  estabelecimentoId = null,
  origem,
  req = null,
}) {
  const e164 = normalizePhoneBR(phone);
  if (!e164) return { ok: false, error: 'telefone_invalido' };

  // Já está fora (revogado ou nunca aceitou): nada a gravar. Quem manda PARAR duas vezes não vira
  // duas linhas.
  const current = await getWhatsAppConsent(e164);
  if (current?.evento !== EVENT_GRANTED) {
    return { ok: true, phone: e164, evento: EVENT_REVOKED, unchanged: true };
  }

  const { ip, userAgent } = requestFingerprint(req);
  return insertEvent({
    evento: EVENT_REVOKED,
    phone: e164,
    usuarioId,
    estabelecimentoId,
    origem,
    ip,
    userAgent,
  });
}

/** Estado atual em forma de API pública (para a tela do cliente e para o recurso junto à Meta). */
export async function describeWhatsAppConsent(phone) {
  const row = await getWhatsAppConsent(phone).catch(() => null);
  if (!row) {
    return { optin: false, aceito_em: null, texto: null, versao: null, origem: null };
  }
  const granted = row.evento === EVENT_GRANTED;
  return {
    optin: granted,
    aceito_em: granted ? row.criado_em : null,
    revogado_em: granted ? null : row.criado_em,
    texto: granted ? row.texto : null,
    versao: granted ? row.texto_versao : null,
    origem: row.origem,
  };
}
