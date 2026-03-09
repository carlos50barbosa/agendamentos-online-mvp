import fetch from 'node-fetch';

const base = String(process.env.BOT_SIM_BASE_URL || 'http://127.0.0.1:3002').replace(/\/$/, '');
const webhookPath = process.env.BOT_SIM_WEBHOOK_PATH || '/api/webhooks/whatsapp';
const phoneNumberId = process.env.BOT_SIM_PHONE_NUMBER_ID || '123456789';
const from = process.env.BOT_SIM_FROM || '5511999999999';
const intent = String(process.env.BOT_SIM_INTENT || '').trim().toLowerCase();
const textByIntent = {
  menu: 'menu',
  humano: 'humano',
  agendar: 'agendar',
  remarcar: 'remarcar',
  cancelar: 'cancelar',
};
const fallbackText = textByIntent[intent] || 'menu';
const explicitText = process.env.BOT_SIM_TEXT;
const text = explicitText != null ? String(explicitText) : fallbackText;
const sequenceRaw = process.env.BOT_SIM_MESSAGES;
const baseSequence = sequenceRaw
  ? String(sequenceRaw).split('|').map((part) => part.trim()).filter(Boolean)
  : [text];

const burstCount = Math.max(0, Number(process.env.BOT_SIM_RATE_LIMIT_BURST || 0) || 0);
const burstText = String(process.env.BOT_SIM_RATE_LIMIT_TEXT || text || 'menu').trim();
const sequence = burstCount > 0
  ? [...baseSequence, ...Array.from({ length: burstCount }, () => burstText)]
  : baseSequence;

const delayMs = Math.max(0, Number(process.env.BOT_SIM_DELAY_MS || 250) || 0);
const forceOutsideWindow = /^(1|true|yes|on)$/i.test(String(process.env.BOT_SIM_FORCE_OUTSIDE_WINDOW || ''));
const explicitTenantId = Number(process.env.BOT_SIM_TENANT_ID || 0);

function parseBool(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === false) return value;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'sim'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off', 'nao'].includes(raw)) return false;
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveTenantId(pool) {
  let tenantId = Number.isFinite(explicitTenantId) && explicitTenantId > 0 ? explicitTenantId : null;
  if (!tenantId) {
    const [[row]] = await pool.query(
      'SELECT estabelecimento_id FROM wa_accounts WHERE phone_number_id=? LIMIT 1',
      [String(phoneNumberId)]
    );
    tenantId = Number(row?.estabelecimento_id || 0) || null;
  }
  return tenantId;
}

async function setOutsideWindowSession(pool, tenantId) {
  if (!tenantId) {
    console.warn('[simulate-wa-bot] nao encontrou tenant para BOT_SIM_FORCE_OUTSIDE_WINDOW');
    return;
  }
  await pool.query(
    `INSERT INTO wa_sessions
      (tenant_id, from_phone, state, context_json, updated_at, expires_at, last_interaction_at)
     VALUES (?,?,'START','{}',NOW(),DATE_ADD(NOW(), INTERVAL 2 HOUR),DATE_SUB(NOW(), INTERVAL 25 HOUR))
     ON DUPLICATE KEY UPDATE
       state='START',
       context_json='{}',
       updated_at=NOW(),
       expires_at=DATE_ADD(NOW(), INTERVAL 2 HOUR),
       last_interaction_at=DATE_SUB(NOW(), INTERVAL 25 HOUR)`,
    [tenantId, from]
  );
  console.log(`[simulate-wa-bot] last_interaction_at for tenant=${tenantId} set to now-25h`);
}

async function applyTenantSettings(pool, tenantId) {
  const enabled = parseBool(process.env.BOT_SIM_SET_ENABLED);
  const killSwitch = parseBool(process.env.BOT_SIM_SET_KILL_SWITCH);
  const modeRaw = process.env.BOT_SIM_SET_MODE;
  const rolloutRaw = process.env.BOT_SIM_SET_ROLLOUT_PERCENT;
  const hasAny = enabled !== null || killSwitch !== null || modeRaw != null || rolloutRaw != null;
  if (!hasAny) return;
  if (!tenantId) {
    console.warn('[simulate-wa-bot] tenant nao resolvido para aplicar BOT_SIM_SET_*');
    return;
  }
  const mode = ['bot_only', 'hybrid', 'human_only'].includes(String(modeRaw || '').toLowerCase())
    ? String(modeRaw).toLowerCase()
    : 'hybrid';
  const rollout = Number.isFinite(Number(rolloutRaw)) ? Math.max(0, Math.min(100, Math.trunc(Number(rolloutRaw)))) : 100;
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
      tenantId,
      enabled === null ? 1 : (enabled ? 1 : 0),
      mode,
      rollout,
      killSwitch === null ? 0 : (killSwitch ? 1 : 0),
    ]
  );
  console.log('[simulate-wa-bot] tenant settings applied', {
    tenant_id: tenantId,
    enabled: enabled === null ? '(default=1)' : enabled,
    mode,
    rollout_percent: rollout,
    kill_switch: killSwitch === null ? '(default=0)' : killSwitch,
  });
}

function buildPayload(messageText, index) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: `entry-test-${index + 1}`,
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '5511999998888',
            phone_number_id: phoneNumberId,
          },
          contacts: [{
            profile: { name: 'Teste CLI' },
            wa_id: from,
          }],
          messages: [{
            from,
            id: `wamid.${Date.now()}.${index + 1}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: messageText },
          }],
        },
      }],
    }],
  };
}

async function postMessage(messageText, index) {
  const payload = buildPayload(messageText, index);
  const url = `${base}${webhookPath}`;
  console.log(`[simulate-wa-bot] POST ${url}`);
  console.log(`[simulate-wa-bot] [${index + 1}/${sequence.length}] phone_number_id=${phoneNumberId} from=${from} text="${messageText}"`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  console.log(`[simulate-wa-bot] [${index + 1}/${sequence.length}] status=${res.status}`);
  console.log(`[simulate-wa-bot] [${index + 1}/${sequence.length}] body=${body}`);
}

try {
  const shouldUseDb =
    forceOutsideWindow ||
    process.env.BOT_SIM_SET_ENABLED != null ||
    process.env.BOT_SIM_SET_MODE != null ||
    process.env.BOT_SIM_SET_ROLLOUT_PERCENT != null ||
    process.env.BOT_SIM_SET_KILL_SWITCH != null;

  if (shouldUseDb) {
    const { pool } = await import('../src/lib/db.js');
    const tenantId = await resolveTenantId(pool);
    if (forceOutsideWindow) {
      await setOutsideWindowSession(pool, tenantId);
    }
    await applyTenantSettings(pool, tenantId);
  }
} catch (err) {
  console.warn('[simulate-wa-bot] setup warning:', err?.message || err);
}

if (burstCount > 0) {
  console.log(`[simulate-wa-bot] rate-limit burst enabled: +${burstCount} mensagens`);
}

for (let i = 0; i < sequence.length; i += 1) {
  await postMessage(sequence[i], i);
  if (i < sequence.length - 1 && delayMs > 0) await sleep(delayMs);
}
