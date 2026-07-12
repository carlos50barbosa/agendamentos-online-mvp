// backend/src/routes/estabelecimento_settings.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import { getPlanContext, planAllowsDeposit } from '../lib/plans.js';
import { resolveDepositProvider } from '../lib/deposit_provider.js';
import { config } from '../lib/config.js';

const router = Router();
const DEFAULT_DEPOSIT_HOLD_MINUTES = 15;
// Aceita UUID genérico (walletIds do Asaas podem não ser v4 estrito).
const WALLET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function parseCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.round(num));
}

async function fetchDepositSettings(estabelecimentoId) {
  const [rows] = await pool.query(
    `SELECT deposit_enabled, deposit_percent, deposit_hold_minutes,
            deposit_type, deposit_fixed_centavos, deposit_min_centavos, deposit_max_centavos,
            refund_window_hours, retain_on_no_show,
            asaas_wallet_id, wallet_verified_at
       FROM establishment_settings WHERE estabelecimento_id=? LIMIT 1`,
    [estabelecimentoId]
  );
  const row = rows?.[0];
  return {
    deposit_enabled: row ? Number(row.deposit_enabled || 0) : 0,
    deposit_percent: row?.deposit_percent ?? null,
    deposit_hold_minutes: row?.deposit_hold_minutes || DEFAULT_DEPOSIT_HOLD_MINUTES,
    deposit_type: String(row?.deposit_type || 'PERCENT').toUpperCase(),
    deposit_fixed_centavos: row?.deposit_fixed_centavos ?? null,
    deposit_min_centavos: row?.deposit_min_centavos ?? null,
    deposit_max_centavos: row?.deposit_max_centavos ?? null,
    refund_window_hours: row?.refund_window_hours ?? 24,
    retain_on_no_show: row?.retain_on_no_show != null ? Boolean(Number(row.retain_on_no_show)) : true,
    asaas_wallet_id: row?.asaas_wallet_id || null,
    wallet_verified_at: row?.wallet_verified_at || null,
  };
}

function serializeDeposit(settings, allowed) {
  const enabled = Boolean(allowed && settings.deposit_enabled);
  return {
    enabled,
    percent: settings.deposit_percent,
    hold_minutes: settings.deposit_hold_minutes,
    type: settings.deposit_type,
    fixed_centavos: settings.deposit_fixed_centavos,
    min_centavos: settings.deposit_min_centavos,
    max_centavos: settings.deposit_max_centavos,
    refund_window_hours: settings.refund_window_hours,
    retain_on_no_show: settings.retain_on_no_show,
    wallet_id: settings.asaas_wallet_id,
    wallet_verified: Boolean(settings.wallet_verified_at),
  };
}

router.get('/settings', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = Number(req.user?.id);
    if (!Number.isFinite(estId) || estId <= 0) {
      return res.status(400).json({ ok: false, error: 'missing_estabelecimento_id' });
    }
    const planContext = await getPlanContext(estId);
    if (!planContext) {
      return res.status(404).json({ error: 'estabelecimento_inexistente' });
    }
    const settings = await fetchDepositSettings(estId);
    const allowed = planAllowsDeposit(planContext.plan);
    return res.json({
      deposit: serializeDeposit(settings, allowed),
      provider: resolveDepositProvider(),
      features: { deposit: allowed },
    });
  } catch (err) {
    console.error('GET /estabelecimento/settings', err?.stack || err);
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
    const allowed = planAllowsDeposit(planContext.plan);
    if (!allowed) {
      return res.status(403).json({
        error: 'plan_not_allowed',
        message: 'Disponível apenas para planos Pro ou Premium.',
      });
    }

    const provider = resolveDepositProvider();

    const enabled = normalizeBool(req.body?.enabled);
    if (enabled === null) {
      return res.status(400).json({ error: 'invalid_enabled', message: 'Informe enabled.' });
    }

    // Merge com o valor atual: um PUT parcial (ex.: só {enabled, percent}) preserva os
    // demais campos — em especial o walletId, que não pode ser apagado sem intenção.
    const current = await fetchDepositSettings(estId);
    const body = req.body || {};
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

    const type = has('type')
      ? (String(body.type).toUpperCase() === 'FIXED' ? 'FIXED' : 'PERCENT')
      : current.deposit_type;
    const percent = has('percent') ? parsePercent(body.percent) : current.deposit_percent;
    const fixedCents = has('fixedCents') ? parseCents(body.fixedCents) : current.deposit_fixed_centavos;
    const minCents = has('minCents') ? parseCents(body.minCents) : current.deposit_min_centavos;
    const maxCents = has('maxCents') ? parseCents(body.maxCents) : current.deposit_max_centavos;
    const refundWindowHoursRaw = has('refundWindowHours') ? parsePercent(body.refundWindowHours) : current.refund_window_hours;
    const refundWindowHours = Number.isFinite(refundWindowHoursRaw) && refundWindowHoursRaw > 0 ? refundWindowHoursRaw : 24;
    const retainOnNoShow = has('retainOnNoShow') ? (normalizeBool(body.retainOnNoShow) !== false) : current.retain_on_no_show;

    // walletId: valida formato quando informado; omitido preserva o atual.
    let walletId = current.asaas_wallet_id;
    let walletChanged = false;
    if (has('walletId')) {
      walletId = body.walletId != null ? String(body.walletId).trim() : null;
      if (walletId === '') walletId = null;
      if (walletId && !WALLET_ID_RE.test(walletId)) {
        return res.status(400).json({
          error: 'invalid_wallet_id',
          message: 'Wallet ID inválido. Copie o identificador exato da sua conta Asaas.',
        });
      }
      walletChanged = walletId !== current.asaas_wallet_id;
    }

    if (enabled) {
      if (provider === 'asaas' && !walletId) {
        return res.status(400).json({
          error: 'wallet_required',
          message: 'Cadastre seu Wallet ID do Asaas para habilitar o sinal.',
        });
      }
      if (type === 'FIXED') {
        if (!Number.isFinite(fixedCents) || fixedCents <= 0) {
          return res.status(400).json({ error: 'invalid_fixed', message: 'Informe o valor do sinal.' });
        }
      } else {
        if (!Number.isFinite(percent)) {
          return res.status(400).json({ error: 'invalid_percent', message: 'Informe o percentual do sinal.' });
        }
        if (percent < 5 || percent > 90) {
          return res.status(400).json({ error: 'percent_out_of_range', message: 'Percentual deve estar entre 5 e 90.' });
        }
      }
      if (minCents != null && maxCents != null && minCents > maxCents) {
        return res.status(400).json({ error: 'min_gt_max', message: 'O piso do sinal não pode ser maior que o teto.' });
      }
      // Sob Asaas, o piso mínimo do sistema garante split viável; um teto abaixo dele conflita.
      const systemMinCents = provider === 'asaas' ? Number(config.signal?.minCents || 0) : 0;
      if (systemMinCents > 0 && maxCents != null && maxCents < systemMinCents) {
        return res.status(400).json({
          error: 'max_below_system_min',
          message: `O teto do sinal não pode ser menor que R$ ${(systemMinCents / 100).toFixed(2)} (mínimo do sistema).`,
        });
      }
    }

    // Gravar novo walletId reseta a verificação (revalidada na 1ª cobrança OK).
    const walletVerifiedAt = walletChanged ? null : current.wallet_verified_at;

    await pool.query(
      `INSERT INTO establishment_settings
        (estabelecimento_id, deposit_enabled, deposit_percent, deposit_hold_minutes,
         deposit_type, deposit_fixed_centavos, deposit_min_centavos, deposit_max_centavos,
         refund_window_hours, retain_on_no_show, asaas_wallet_id, wallet_verified_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        deposit_enabled=VALUES(deposit_enabled),
        deposit_percent=VALUES(deposit_percent),
        deposit_type=VALUES(deposit_type),
        deposit_fixed_centavos=VALUES(deposit_fixed_centavos),
        deposit_min_centavos=VALUES(deposit_min_centavos),
        deposit_max_centavos=VALUES(deposit_max_centavos),
        refund_window_hours=VALUES(refund_window_hours),
        retain_on_no_show=VALUES(retain_on_no_show),
        asaas_wallet_id=VALUES(asaas_wallet_id),
        wallet_verified_at=VALUES(wallet_verified_at)`,
      [
        estId,
        enabled ? 1 : 0,
        percent,
        DEFAULT_DEPOSIT_HOLD_MINUTES,
        type,
        type === 'FIXED' ? fixedCents : null,
        minCents,
        maxCents,
        refundWindowHours,
        retainOnNoShow ? 1 : 0,
        walletId,
        walletVerifiedAt,
      ]
    );

    const settings = await fetchDepositSettings(estId);
    return res.json({
      ok: true,
      deposit: serializeDeposit(settings, true),
      provider,
      features: { deposit: true },
    });
  } catch (err) {
    console.error('PUT /estabelecimento/settings/deposit', err);
    return res.status(500).json({ error: 'settings_save_failed' });
  }
});

// Painel financeiro do estabelecimento: extrato dos sinais + totais do mês.
router.get('/financeiro/sinais', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = Number(req.user?.id);
    if (!Number.isFinite(estId) || estId <= 0) {
      return res.status(400).json({ error: 'missing_estabelecimento_id' });
    }
    const planContext = await getPlanContext(estId);
    const allowed = planContext ? planAllowsDeposit(planContext.plan) : false;

    const [rows] = await pool.query(
      `SELECT ap.id, ap.status, ap.amount_centavos,
              COALESCE(ap.split_centavos, ap.amount_centavos) AS repasse_centavos,
              ap.asaas_fee_centavos, ap.provider,
              ap.created_at, ap.paid_at, ap.refunded_at,
              a.id AS agendamento_id, a.inicio, a.no_show,
              c.nome AS cliente_nome,
              s0.nome AS servico_nome
         FROM appointment_payments ap
         JOIN agendamentos a ON a.id = ap.agendamento_id
         LEFT JOIN usuarios c ON c.id = a.cliente_id
         LEFT JOIN servicos s0 ON s0.id = a.servico_id
        WHERE ap.estabelecimento_id=? AND ap.type='deposit'
          AND ap.status IN ('pending','paid','refunded')
        ORDER BY ap.created_at DESC
        LIMIT 200`,
      [estId]
    );

    const [[totals]] = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN ap.status='paid' AND ap.paid_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
                           THEN COALESCE(ap.split_centavos, ap.amount_centavos) ELSE 0 END), 0) AS recebido_centavos,
         COALESCE(SUM(CASE WHEN ap.status='refunded' AND ap.refunded_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
                           THEN COALESCE(ap.split_centavos, ap.amount_centavos) ELSE 0 END), 0) AS estornado_centavos,
         COALESCE(SUM(CASE WHEN ap.status='paid' AND a.no_show=1 AND ap.paid_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
                           THEN COALESCE(ap.split_centavos, ap.amount_centavos) ELSE 0 END), 0) AS retido_noshow_centavos
         FROM appointment_payments ap
         JOIN agendamentos a ON a.id = ap.agendamento_id
        WHERE ap.estabelecimento_id=? AND ap.type='deposit'`,
      [estId]
    );

    const sinais = (rows || []).map((r) => ({
      id: r.id,
      agendamento_id: r.agendamento_id,
      status: r.status,
      amount_centavos: Number(r.amount_centavos || 0),
      repasse_centavos: Number(r.repasse_centavos || 0),
      asaas_fee_centavos: r.asaas_fee_centavos != null ? Number(r.asaas_fee_centavos) : null,
      provider: r.provider || null,
      cliente_nome: r.cliente_nome || null,
      servico_nome: r.servico_nome || null,
      inicio: r.inicio || null,
      no_show: Boolean(Number(r.no_show || 0)),
      created_at: r.created_at || null,
      paid_at: r.paid_at || null,
      refunded_at: r.refunded_at || null,
    }));

    return res.json({
      sinais,
      totals: {
        recebido_centavos: Number(totals?.recebido_centavos || 0),
        estornado_centavos: Number(totals?.estornado_centavos || 0),
        retido_noshow_centavos: Number(totals?.retido_noshow_centavos || 0),
      },
      features: { deposit: allowed },
    });
  } catch (err) {
    console.error('GET /estabelecimento/financeiro/sinais', err?.stack || err);
    return res.status(500).json({ error: 'financeiro_fetch_failed' });
  }
});

export default router;
