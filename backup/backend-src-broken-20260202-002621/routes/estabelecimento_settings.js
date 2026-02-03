// backend/src/routes/estabelecimento_settings.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import { getPlanContext } from '../lib/plans.js';
const router = Router();
const DEFAULT_DEPOSIT_HOLD_MINUTES = 15;
const DEPOSIT_ALLOWED_PLANS = new Set(['pro', 'premium']);
function normalizeBool(value) {
if (value === true || value === false) return value;
if (value == null) return null;
const normalized = String(value).trim().toLowerCase();
if (!normalized) return null;
if (['1', 'true', 'yes', 'on', 'sim'].includes(normalized)) return true;
if (['0', 'false', 'no', 'off', 'nao'].includes(normalized)) return false;
return null;
}

function parsePercent(value) {
if (value === null || value === undefined || value === '') return null;
const num = Number(value);
if (!Number.isFinite(num)) return null;
return Math.round(num);
}

async function fetchDepositSettings(estabelecimentoId) {
const [rows] = await pool.query(
    'SELECT deposit_enabled, deposit_percent, deposit_hold_minutes FROM establishment_settings WHERE estabelecimento_id= LIMIT 1', [estabelecimentoId] );
const row = rows?.[0];
return {
deposit_enabled: row ? Number(row.deposit_enabled || 0) : 0, deposit_percent: row?.deposit_percent ?? null, deposit_hold_minutes: row?.deposit_hold_minutes || DEFAULT_DEPOSIT_HOLD_MINUTES, };
}

router.get('/settings', auth, isEstabelecimento, async (req, res) => {
try {
const estId = req.user.id;
const planContext = await getPlanContext(estId);
if (!planContext) {
return res.status(404).json({ error: 'estabelecimento_inexistente' });
}
    const settings = await fetchDepositSettings(estId);
const allowed = DEPOSIT_ALLOWED_PLANS.has(String(planContext.plan || '').toLowerCase());
const enabled = Boolean(allowed && settings.deposit_enabled);
return res.json({
deposit: {
enabled, percent: settings.deposit_percent, hold_minutes: settings.deposit_hold_minutes, }, features: {
deposit: allowed, }, });
} catch (err) {
console.error('GET /estabelecimento/settings', err);
return res.status(500).json({ error: 'settings_fetch_failed' });
}
});
router.put('/settings/deposit', auth, isEstabelecimento, async (req, res) => {
try {
const estId = req.user.id;
const planContext = await getPlanContext(estId);
if (!planContext) {
return res.status(404).json({ error: 'estabelecimento_inexistente' });
}
    const allowed = DEPOSIT_ALLOWED_PLANS.has(String(planContext.plan || '').toLowerCase());
if (!allowed) {
return res.status(403).json({
error: 'plan_not_allowed', message: 'Disponivel apenas para planos Pro ou Premium.', });
}

    const enabled = normalizeBool(req.body?.enabled);
if (enabled === null) {
return res.status(400).json({ error: 'invalid_enabled', message: 'Informe enabled.' });
}

    const percent = parsePercent(req.body?.percent);
if (enabled) {
if (!Number.isFinite(percent)) {
return res.status(400).json({ error: 'invalid_percent', message: 'Informe o percentual do sinal.' });
}
      if (percent < 5 || percent > 90) {
return res.status(400).json({
error: 'percent_out_of_range', message: 'Percentual deve estar entre 5 e 90.', });
}
    }
await pool.query(
      `INSERT INTO establishment_settings
        (estabelecimento_id, deposit_enabled, deposit_percent, deposit_hold_minutes)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE
        deposit_enabled=VALUES(deposit_enabled),
        deposit_percent=VALUES(deposit_percent)`, [estId, enabled ? 1 : 0, percent, DEFAULT_DEPOSIT_HOLD_MINUTES] );
const settings = await fetchDepositSettings(estId);
return res.json({
ok: true, deposit: {
enabled: Boolean(settings.deposit_enabled), percent: settings.deposit_percent, hold_minutes: settings.deposit_hold_minutes, }, features: {
deposit: true, }, });
} catch (err) {
console.error('PUT /estabelecimento/settings/deposit', err);
return res.status(500).json({ error: 'settings_save_failed' });
}
});
export default router;


