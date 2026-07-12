// backend/src/lib/audit.js
// Trilha de auditoria persistida (tabela audit_log): quem fez o quê, de onde, com que resultado.
//
// Duas formas de alimentar:
//
// 1) AUTOMÁTICA — o middleware de acesso (index.js) grava toda requisição que MUDA ESTADO
//    (POST/PUT/PATCH/DELETE), com ator, rota, status e resultado. Isso garante que nenhuma
//    mutação passe despercebida, mesmo em rota que ninguém instrumentou.
//
// 2) ENRIQUECIDA — o handler chama setAudit(req, {...}) para dar nome e detalhe ao ato
//    ('auth.login_failed', entidade, antes/depois, motivo). Os campos se fundem ao registro
//    automático no fim da requisição, então não há linha duplicada e o handler não precisa
//    saber nada sobre banco, status ou transação.
//
// Regra inegociável: auditoria NUNCA derruba nem atrasa a request. Toda escrita é fire-and-forget
// e todo erro é engolido (com um log de aviso) — perder uma linha de auditoria é ruim, devolver
// 500 a um cliente porque o INSERT do log falhou é pior.
import { pool } from './db.js';
import { log, sanitizeForLog } from './logger.js';

const AUDIT_ENABLED = String(process.env.AUDIT_LOG_ENABLED ?? 'true').trim().toLowerCase() !== 'false';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Rotas que mudam estado mas são ruído puro de máquina (webhooks de provedor entram no access log
// e têm seus próprios logs de domínio). Auditoria é sobre ATOS DE PESSOAS.
const AUTO_AUDIT_SKIP = [
  /^\/(api\/)?webhooks?\//i,
  /^\/(api\/)?wa\/webhook/i,
  /^\/(api\/)?billing\/webhook/i,
  /^\/(api\/)?payments\/webhook/i,
];

function truncate(value, max) {
  if (value == null) return null;
  const str = String(value);
  return str.length > max ? str.slice(0, max) : str;
}

function toJsonColumn(value) {
  if (value == null) return null;
  try {
    const json = JSON.stringify(sanitizeForLog(value));
    if (!json || json === '{}' || json === 'null') return null;
    return json.length > 60000 ? `${json.slice(0, 60000)}…[truncated]` : json;
  } catch {
    return null;
  }
}

// Só os campos que realmente mudaram — um diff cheio de "igual a antes" polui a trilha e esconde
// o que interessa.
export function diffFields(before, after, fields) {
  const antes = {};
  const depois = {};
  const keys = fields || Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
  for (const key of keys) {
    const a = before?.[key];
    const b = after?.[key];
    if (a === undefined && b === undefined) continue;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    antes[key] = a ?? null;
    depois[key] = b ?? null;
  }
  if (!Object.keys(depois).length && !Object.keys(antes).length) return null;
  return { antes, depois };
}

/**
 * Anota a requisição com detalhes de auditoria. Pode ser chamada mais de uma vez (os campos se
 * acumulam) e não escreve nada por si — quem persiste é o middleware, no fim da request.
 */
export function setAudit(req, details = {}) {
  if (!req) return;
  const current = req.audit || {};
  req.audit = { ...current, ...details };
  if (details.metadados || details.metadata) {
    req.audit.metadados = { ...(current.metadados || {}), ...(details.metadados || details.metadata || {}) };
  }
}

/** Marca a requisição para NÃO gerar registro automático (ex.: leitura sem relevância). */
export function skipAudit(req) {
  if (req) req.auditSkip = true;
}

function resolveActor(req) {
  const user = req?.user || null;
  if (user?.id) {
    return { id: user.id, tipo: user.tipo || null, email: user.email || null };
  }
  // Rotas admin não usam JWT: autenticam por X-Admin-Token.
  if (req?.isAdminRequest) return { id: null, tipo: 'admin', email: null };
  return { id: null, tipo: 'anonimo', email: null };
}

function defaultAction(req) {
  const method = String(req?.method || '').toUpperCase();
  const path = String(req?.route?.path || req?.path || '').replace(/^\/+|\/+$/g, '');
  const base = path.split('?')[0].replace(/\//g, '.') || 'root';
  return `http.${method.toLowerCase()}.${base}`.slice(0, 64);
}

function resultFromStatus(status) {
  if (status === 401 || status === 403) return 'negado';
  if (status >= 400) return 'falha';
  return 'sucesso';
}

/**
 * Grava uma linha de auditoria. Fire-and-forget: devolve imediatamente, nunca lança.
 */
export function recordAudit(entry = {}) {
  if (!AUDIT_ENABLED) return;

  const row = {
    request_id: truncate(entry.request_id, 128),
    ator_id: entry.ator_id ?? null,
    ator_tipo: truncate(entry.ator_tipo, 32),
    ator_email: truncate(entry.ator_email, 255),
    acao: truncate(entry.acao || 'desconhecida', 64),
    entidade: truncate(entry.entidade, 64),
    entidade_id: truncate(entry.entidade_id, 64),
    estabelecimento_id: entry.estabelecimento_id ?? null,
    resultado: truncate(entry.resultado || 'sucesso', 16),
    status_http: entry.status_http ?? null,
    motivo: truncate(entry.motivo, 255),
    metodo: truncate(entry.metodo, 10),
    rota: truncate(entry.rota, 255),
    ip: truncate(entry.ip, 64),
    user_agent: truncate(entry.user_agent, 256),
    dados_antes: toJsonColumn(entry.dados_antes),
    dados_depois: toJsonColumn(entry.dados_depois),
    metadados: toJsonColumn(entry.metadados),
  };

  pool.query(
    `INSERT INTO audit_log
      (request_id, ator_id, ator_tipo, ator_email, acao, entidade, entidade_id, estabelecimento_id,
       resultado, status_http, motivo, metodo, rota, ip, user_agent, dados_antes, dados_depois, metadados)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      row.request_id, row.ator_id, row.ator_tipo, row.ator_email, row.acao, row.entidade,
      row.entidade_id, row.estabelecimento_id, row.resultado, row.status_http, row.motivo,
      row.metodo, row.rota, row.ip, row.user_agent, row.dados_antes, row.dados_depois, row.metadados,
    ]
  ).catch((err) => {
    // Um INSERT de auditoria que falha não pode quebrar a request — mas também não pode sumir
    // em silêncio, senão a trilha tem buracos invisíveis. Vai para o stdout estruturado.
    log.error('audit_write_failed', {
      reason: err?.message || String(err),
      acao: row.acao,
      request_id: row.request_id,
    });
  });
}

/**
 * Decide se a requisição vira registro de auditoria e monta a linha a partir do que a rota anotou
 * (req.audit) + o contexto HTTP. Chamado uma vez, no `finish` da response.
 */
export function auditRequest(req, res, context = {}) {
  if (!AUDIT_ENABLED || req?.auditSkip) return;

  const explicit = req?.audit || null;
  const method = String(req?.method || '').toUpperCase();
  const isMutation = MUTATING_METHODS.has(method);
  const path = String(req?.originalUrl || req?.path || '').split('?')[0];

  // Sem anotação da rota, só mutações viram trilha. Uma rota de leitura sensível (export de CSV,
  // por exemplo) entra na trilha chamando setAudit() explicitamente.
  if (!explicit && !isMutation) return;
  if (!explicit && AUTO_AUDIT_SKIP.some((re) => re.test(path))) return;

  const actor = resolveActor(req);
  const status = res?.statusCode ?? null;
  const estabelecimentoId = explicit?.estabelecimento_id
    ?? (actor.tipo === 'estabelecimento' ? actor.id : null);

  recordAudit({
    request_id: req?.requestId || null,
    ator_id: explicit?.ator_id ?? actor.id,
    ator_tipo: explicit?.ator_tipo ?? actor.tipo,
    ator_email: explicit?.ator_email ?? actor.email,
    acao: explicit?.acao || defaultAction(req),
    entidade: explicit?.entidade ?? null,
    entidade_id: explicit?.entidade_id ?? null,
    estabelecimento_id: estabelecimentoId,
    resultado: explicit?.resultado || resultFromStatus(status),
    status_http: status,
    motivo: explicit?.motivo ?? null,
    metodo: method,
    rota: path,
    ip: context.ip ?? null,
    user_agent: context.user_agent ?? null,
    dados_antes: explicit?.dados_antes ?? null,
    dados_depois: explicit?.dados_depois ?? null,
    metadados: explicit?.metadados ?? null,
  });
}
