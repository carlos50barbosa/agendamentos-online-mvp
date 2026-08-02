import crypto from 'node:crypto';
import { pool } from '../../lib/db.js';

const MODES = new Set(['bot_only', 'hybrid', 'human_only']);

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  mode: 'hybrid',
  rolloutPercent: 100,
  killSwitch: false,
  source: 'default',
});

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (MODES.has(mode)) return mode;
  return 'hybrid';
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.trunc(n)));
}

function normalizeSettingsRow(row) {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    enabled: Number(row.enabled || 0) === 1,
    mode: normalizeMode(row.mode),
    rolloutPercent: clampPercent(row.rollout_percent),
    killSwitch: Number(row.kill_switch || 0) === 1,
    source: 'db',
  };
}

async function getTenantBotSettings(tenantId) {
  const tenant = Number(tenantId);
  if (!Number.isFinite(tenant) || tenant <= 0) return { ...DEFAULT_SETTINGS };
  try {
    const [rows] = await pool.query(
      `SELECT enabled, mode, rollout_percent, kill_switch
         FROM wa_bot_settings
        WHERE tenant_id=?
        LIMIT 1`,
      [tenant]
    );
    return normalizeSettingsRow(rows?.[0] || null);
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) {
      return { ...DEFAULT_SETTINGS, source: 'default_table_missing' };
    }
    throw err;
  }
}

function rolloutBucket(fromPhone) {
  const raw = String(fromPhone || '').trim();
  if (!raw) return 0;
  const digest = crypto.createHash('sha256').update(raw).digest();
  const bucket = digest.readUInt32BE(0) % 100;
  return Number(bucket);
}

function isInsideRollout(fromPhone, rolloutPercent) {
  const percent = clampPercent(rolloutPercent);
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  return rolloutBucket(fromPhone) < percent;
}

function evaluateTenantPolicy({ settings, fromPhone }) {
  const cfg = settings || DEFAULT_SETTINGS;
  const inRollout = isInsideRollout(fromPhone, cfg.rolloutPercent);
  if (cfg.killSwitch) {
    return {
      allowEngine: false,
      allowAutoReply: false,
      openHandoff: false,
      reason: 'KILL_SWITCH',
      mode: cfg.mode,
      inRollout,
    };
  }
  if (!cfg.enabled) {
    return {
      allowEngine: false,
      allowAutoReply: true,
      openHandoff: true,
      reason: 'DISABLED',
      mode: cfg.mode,
      inRollout,
    };
  }
  if (cfg.mode === 'human_only') {
    return {
      allowEngine: false,
      allowAutoReply: true,
      openHandoff: true,
      reason: 'HUMAN_ONLY',
      mode: cfg.mode,
      inRollout,
    };
  }
  if (!inRollout) {
    return {
      allowEngine: false,
      allowAutoReply: true,
      openHandoff: true,
      reason: 'ROLLOUT_HOLDOUT',
      mode: cfg.mode,
      inRollout,
    };
  }
  return {
    allowEngine: true,
    allowAutoReply: true,
    openHandoff: false,
    reason: 'ENABLED',
    mode: cfg.mode,
    inRollout,
  };
}

async function upsertTenantBotSettings({ tenantId, enabled, mode, rolloutPercent, killSwitch }) {
  const tenant = Number(tenantId);
  if (!Number.isFinite(tenant) || tenant <= 0) return { ok: false, error: 'invalid_tenant' };
  await pool.query(
    `INSERT INTO wa_bot_settings (tenant_id, enabled, mode, rollout_percent, kill_switch, updated_at)
     VALUES (?,?,?,?,?,NOW())
     ON DUPLICATE KEY UPDATE
       enabled=VALUES(enabled),
       mode=VALUES(mode),
       rollout_percent=VALUES(rollout_percent),
       kill_switch=VALUES(kill_switch),
       updated_at=NOW()`,
    [
      tenant,
      enabled ? 1 : 0,
      normalizeMode(mode),
      clampPercent(rolloutPercent),
      killSwitch ? 1 : 0,
    ]
  );
  return { ok: true };
}

/**
 * Deixa o atendimento automático DESLIGADO para quem acabou de conectar o próprio número.
 *
 * ─── Por que isso existe ───────────────────────────────────────────────────────────────────────
 *
 * O padrão global é `enabled: true, rolloutPercent: 100` — e faz sentido no número GLOBAL da
 * plataforma, onde o cliente entende que está falando com um sistema.
 *
 * No número do próprio salão é o contrário. Ali quem conversa é a dona, no aplicativo dela, o dia
 * inteiro. Sem isto, a cliente manda "oi Ju, me encaixa amanhã?" e recebe, DO NÚMERO DA JU, um
 * menu numerado — enquanto a Ju digita a resposta de verdade e vê aquilo acontecer no celular.
 *
 * `killSwitch` em vez de só `enabled: false` porque desligar não basta: com `enabled: false` a
 * política ainda devolve `allowAutoReply: true` e `openHandoff: true`, ou seja, a plataforma
 * continua falando. `killSwitch` é o único estado de silêncio COMPLETO.
 *
 * Só insere se não houver linha: reconectar não pode desfazer a escolha de quem já ligou o
 * atendimento automático de propósito.
 */
async function ensureTenantBotSilentByDefault(tenantId, { deps = {} } = {}) {
  const tenant = Number(tenantId);
  if (!Number.isFinite(tenant) || tenant <= 0) return { ok: false, error: 'invalid_tenant' };
  const executar = deps.query || ((sql, params) => pool.query(sql, params));
  const [r] = await executar(
    `INSERT INTO wa_bot_settings (tenant_id, enabled, mode, rollout_percent, kill_switch, updated_at)
     VALUES (?, 0, 'human_only', 0, 1, NOW())
     ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
    [tenant]
  );
  // affectedRows 1 = inseriu (primeira conexão); 0 = já existia e foi respeitado.
  return { ok: true, criado: Number(r?.affectedRows || 0) === 1 };
}

export {
  DEFAULT_SETTINGS,
  getTenantBotSettings,
  rolloutBucket,
  isInsideRollout,
  evaluateTenantPolicy,
  upsertTenantBotSettings,
  ensureTenantBotSilentByDefault,
};
