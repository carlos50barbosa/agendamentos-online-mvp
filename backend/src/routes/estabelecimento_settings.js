// backend/src/routes/estabelecimento_settings.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import { getPlanContext, planAllowsDeposit } from '../lib/plans.js';
import { resolveDepositProvider } from '../lib/deposit_provider.js';
import { config } from '../lib/config.js';
import { setAudit, diffFields } from '../lib/audit.js';
import { getClientIp } from '../lib/client_ip.js';
import {
  ASAAS_ONBOARDING_TERMS_VERSION,
  AsaasOnboardingError,
  buildSubaccountDraft,
  createEstablishmentSubaccount,
} from '../lib/asaas_onboarding.js';

import {
  JANELA_MODO_LIVRE,
  JANELA_MODO_SEMANAL,
  computeJanela,
  fetchJanelaConfig,
} from '../lib/janela_agendamento.js';

const router = Router();
const DEFAULT_DEPOSIT_HOLD_MINUTES = 15;
// Teto igual ao da lib. Aqui a violação vira 400 em vez de cair no default: no PUT vindo da
// tela, clampar em silêncio transformaria um dedo errado em "domingo, 1 semana" sem avisar.
const JANELA_MAX_SEMANAS = 12;
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
            asaas_wallet_id, wallet_verified_at, asaas_subaccount_created_at,
            deposit_block_reason, deposit_blocked_at
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
    asaas_subaccount_created_at: row?.asaas_subaccount_created_at || null,
  };
}

function serializeDeposit(settings, allowed) {
  const enabled = Boolean(allowed && settings.deposit_enabled);
  const isAsaas = resolveDepositProvider() === 'asaas';
  // Quanto e' descontado de cada sinal antes do repasse (o mesmo que o `computeSplitCents`
  // subtrai). Vai para a tela para o dono saber o que recebe ANTES de ligar o recurso —
  // ate aqui ele so' descobria olhando o extrato e comparando os numeros na mao.
  //
  // Calculado aqui, e nao cravado no frontend: os dois valores vem do .env e mudam sem
  // deploy do front. Um numero fixo na tela viraria mentira silenciosa na primeira mudanca.
  const feeCents = isAsaas
    ? Number(config.signal.platformFeeCents || 0) + Number(config.signal.asaasPixFeeCents || 0)
    : 0;
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
    // Por que o sinal parou de sair. Preenchido quando uma cobranca falha por causa estrutural
    // (conta Asaas sem chave PIX, tipicamente). E o unico caminho para o dono saber: nao temos
    // a API key da subconta para perguntar o status ao Asaas.
    block_reason: settings.deposit_block_reason || null,
    blocked_at: settings.deposit_blocked_at || null,
    wallet_verified: Boolean(settings.wallet_verified_at),
    // Como a carteira chegou aqui: 'subconta' = a plataforma abriu a conta pelo dono;
    // 'manual' = ele colou o Wallet ID da conta Asaas que já tinha. O front mostra telas
    // diferentes — em 'subconta' não faz sentido oferecer edição do campo.
    wallet_source: settings.asaas_wallet_id
      ? (settings.asaas_subaccount_created_at ? 'subconta' : 'manual')
      : null,
    // Transparência da taxa (ver comentário acima).
    fee_cents: feeCents,
    min_signal_cents: isAsaas ? Number(config.signal.minCents || 0) : 0,
    // Com o split desligado nao ha repasse automatico: o sinal fica na conta da plataforma.
    // A tela precisa saber disso para nao prometer "cai direto na sua conta".
    split_enabled: isAsaas && !config.signal.splitDisabled,
  };
}

/**
 * Config crua + prévia do efeito. A tela precisa das duas coisas: os campos para editar, e
 * "hoje o cliente consegue marcar até X, a próxima leva abre em Y" para o dono conferir que
 * configurou o que queria antes de descobrir pelo cliente reclamando.
 */
function serializeJanelaSettings(config, now = new Date()) {
  const janela = computeJanela({ config, now });
  return {
    modo: config.modo,
    abre_dia: config.abreDia,
    abre_hora: config.abreHora,
    semanas: config.semanas,
    limite: janela.limiteUtc ? janela.limiteUtc.toISOString() : null,
    abre_em: janela.abreEmUtc ? janela.abreEmUtc.toISOString() : null,
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
    const janelaConfig = await fetchJanelaConfig(pool, estId);
    return res.json({
      deposit: serializeDeposit(settings, allowed),
      // Sem gate de plano: limitar o horizonte da própria agenda é ajuste de operação, não
      // recurso pago. Quem tiver conta ativa configura.
      janela: serializeJanelaSettings(janelaConfig),
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
    const AUDITED = [
      'deposit_enabled', 'deposit_type', 'deposit_percent', 'deposit_fixed_centavos',
      'deposit_min_centavos', 'deposit_max_centavos', 'refund_window_hours',
      'retain_on_no_show', 'asaas_wallet_id',
    ];
    const diff = diffFields(current, settings, AUDITED);
    setAudit(req, {
      acao: 'config.sinal',
      entidade: 'configuracao',
      entidade_id: estId,
      estabelecimento_id: estId,
      dados_antes: diff?.antes || null,
      dados_depois: diff?.depois || null,
      metadados: { wallet_alterada: walletChanged },
    });
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

/**
 * PUT /estabelecimento/settings/janela
 * body: { modo: 'livre'|'semanal', abreDia?: 0..6, abreHora?: 0..23, semanas?: 1..12 }
 *
 * PUT parcial: campo omitido preserva o atual. Trocar para 'livre' NÃO zera abreDia/hora —
 * quem desliga para testar e religa depois espera reencontrar a configuração de antes.
 */
router.put('/settings/janela', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = Number(req.user?.id);
    if (!Number.isFinite(estId) || estId <= 0) {
      return res.status(400).json({ error: 'missing_estabelecimento_id' });
    }
    const planContext = await getPlanContext(estId);
    if (!planContext) {
      return res.status(404).json({ error: 'estabelecimento_inexistente' });
    }

    const current = await fetchJanelaConfig(pool, estId);
    const body = req.body || {};
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

    let modo = current.modo;
    if (has('modo')) {
      modo = String(body.modo || '').trim().toLowerCase();
      if (modo !== JANELA_MODO_LIVRE && modo !== JANELA_MODO_SEMANAL) {
        return res.status(400).json({ error: 'invalid_modo', message: 'Modo inválido.' });
      }
    }

    // Inteiro dentro da faixa ou 400 — nada de clampar em silêncio (ver JANELA_MAX_SEMANAS).
    const parseRange = (raw, min, max) => {
      const num = Number(raw);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < min || num > max) return null;
      return num;
    };

    let abreDia = current.abreDia;
    if (has('abreDia')) {
      abreDia = parseRange(body.abreDia, 0, 6);
      if (abreDia === null) {
        return res.status(400).json({ error: 'invalid_abre_dia', message: 'Dia da semana inválido (0=domingo a 6=sábado).' });
      }
    }

    let abreHora = current.abreHora;
    if (has('abreHora')) {
      abreHora = parseRange(body.abreHora, 0, 23);
      if (abreHora === null) {
        return res.status(400).json({ error: 'invalid_abre_hora', message: 'Hora inválida (0 a 23).' });
      }
    }

    let semanas = current.semanas;
    if (has('semanas')) {
      semanas = parseRange(body.semanas, 1, JANELA_MAX_SEMANAS);
      if (semanas === null) {
        return res.status(400).json({ error: 'invalid_semanas', message: `Informe de 1 a ${JANELA_MAX_SEMANAS} semanas.` });
      }
    }

    await pool.query(
      `INSERT INTO establishment_settings
         (estabelecimento_id, janela_modo, janela_abre_dia, janela_abre_hora, janela_semanas)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         janela_modo=VALUES(janela_modo),
         janela_abre_dia=VALUES(janela_abre_dia),
         janela_abre_hora=VALUES(janela_abre_hora),
         janela_semanas=VALUES(janela_semanas)`,
      [estId, modo, abreDia, abreHora, semanas]
    );

    const saved = await fetchJanelaConfig(pool, estId);
    const diff = diffFields(current, saved, ['modo', 'abreDia', 'abreHora', 'semanas']);
    setAudit(req, {
      acao: 'config.janela_agendamento',
      entidade: 'configuracao',
      entidade_id: estId,
      estabelecimento_id: estId,
      dados_antes: diff?.antes || null,
      dados_depois: diff?.depois || null,
    });

    return res.json({ ok: true, janela: serializeJanelaSettings(saved) });
  } catch (err) {
    console.error('PUT /estabelecimento/settings/janela', err?.stack || err);
    return res.status(500).json({ error: 'settings_save_failed' });
  }
});

// ── Subconta Asaas ────────────────────────────────────────────────────────────────────────
// A plataforma abre a conta de recebimento pelo estabelecimento, para ele não precisar se
// cadastrar no Asaas nem copiar Wallet ID. Só é possível porque a conta da plataforma é PJ.

router.get('/asaas/subconta', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = Number(req.user?.id);
    if (!Number.isFinite(estId) || estId <= 0) {
      return res.status(400).json({ error: 'missing_estabelecimento_id' });
    }
    const planContext = await getPlanContext(estId);
    const allowed = planContext ? planAllowsDeposit(planContext.plan) : false;
    const status = await buildSubaccountDraft(estId);
    return res.json({ ...status, allowed, provider: resolveDepositProvider() });
  } catch (err) {
    if (err instanceof AsaasOnboardingError) {
      return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    }
    console.error('GET /estabelecimento/asaas/subconta', err?.stack || err);
    return res.status(500).json({ error: 'subaccount_status_failed' });
  }
});

router.post('/asaas/subconta', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = Number(req.user?.id);
    if (!Number.isFinite(estId) || estId <= 0) {
      return res.status(400).json({ error: 'missing_estabelecimento_id' });
    }
    const planContext = await getPlanContext(estId);
    if (!planContext) {
      return res.status(404).json({ error: 'estabelecimento_inexistente' });
    }
    if (!planAllowsDeposit(planContext.plan)) {
      return res.status(403).json({
        error: 'plan_not_allowed',
        message: 'Disponível apenas para planos Pro ou Premium.',
      });
    }

    const body = req.body || {};
    const result = await createEstablishmentSubaccount({
      estabelecimentoId: estId,
      overrides: body.dados || {},
      consent: {
        accepted: body.aceite === true,
        termsVersion: String(body.termsVersion || ASAAS_ONBOARDING_TERMS_VERSION),
        ip: getClientIp(req) || null,
      },
    });

    const settings = await fetchDepositSettings(estId);
    setAudit(req, {
      acao: 'config.sinal.subconta',
      entidade: 'configuracao',
      entidade_id: estId,
      estabelecimento_id: estId,
      dados_antes: null,
      // O walletId identifica a carteira e não é segredo (vai no split de toda cobrança);
      // os dados pessoais do cadastro, sim — por isso não entram na trilha.
      dados_depois: { asaas_wallet_id: result.walletId, asaas_account_id: result.accountId },
      metadados: { reaproveitada: result.reused, terms_version: ASAAS_ONBOARDING_TERMS_VERSION },
    });

    return res.json({
      ok: true,
      walletId: result.walletId,
      reused: result.reused,
      deposit: serializeDeposit(settings, true),
    });
  } catch (err) {
    if (err instanceof AsaasOnboardingError) {
      return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    }
    console.error('POST /estabelecimento/asaas/subconta', err?.stack || err);
    return res.status(500).json({ error: 'subaccount_create_failed' });
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
