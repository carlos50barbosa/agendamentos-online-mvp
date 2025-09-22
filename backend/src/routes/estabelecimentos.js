// backend/src/routes/estabelecimentos.js
import { Router } from "express";
import { pool } from "../lib/db.js";
import { auth, isEstabelecimento } from "../middleware/auth.js";
import {
  PLAN_TIERS,
  PLAN_STATUS,
  getPlanContext,
  resolvePlanConfig,
  countProfessionals,
  formatPlanLimitExceeded,
  isDelinquentStatus,
  serializePlanContext,
  isDowngrade,
} from "../lib/plans.js";

const router = Router();

// Lista todos os usuarios com perfil de estabelecimento
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nome, email FROM usuarios WHERE tipo = 'estabelecimento' ORDER BY nome"
    );
    res.json(rows);
  } catch (e) {
    console.error("GET /establishments", e);
    res.status(500).json({ error: "list_establishments_failed" });
  }
});

// Alias em pt-BR (opcional): /estabelecimentos
router.get("/pt", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nome, email FROM usuarios WHERE tipo = 'estabelecimento' ORDER BY nome"
    );
    res.json(rows);
  } catch (e) {
    console.error("GET /estabelecimentos", e);
    res.status(500).json({ error: "list_establishments_failed" });
  }
});

// Detalhe por ID ou slug
router.get('/:idOrSlug', async (req, res) => {
  try {
    const idOrSlug = String(req.params.idOrSlug || '').trim();
    let rows;
    const id = Number(idOrSlug);
    if (Number.isFinite(id)) {
      [rows] = await pool.query(
        "SELECT id, nome, email, telefone, slug, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE id=? AND tipo='estabelecimento' LIMIT 1",
        [id]
      );
    } else {
      [rows] = await pool.query(
        "SELECT id, nome, email, telefone, slug, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE slug=? AND tipo='estabelecimento' LIMIT 1",
        [idOrSlug]
      );
    }
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const est = rows[0];
    const planContext = await getPlanContext(est.id);
    return res.json({ ...est, plan_context: serializePlanContext(planContext) });
  } catch (e) {
    console.error('GET /establishments/:id', e);
    res.status(500).json({ error: 'establishment_fetch_failed' });
  }
});

// Templates por estabelecimento (protegido)
router.get('/:id/messages', auth, isEstabelecimento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || req.user.id !== id) return res.status(403).json({ error: 'forbidden' });
    const [rows] = await pool.query('SELECT email_subject, email_html, wa_template FROM estab_messages WHERE estabelecimento_id=?', [id]);
    res.json(rows[0] || { email_subject: null, email_html: null, wa_template: null });
  } catch (e) {
    console.error('GET /establishments/:id/messages', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.put('/:id/messages', auth, isEstabelecimento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || req.user.id !== id) return res.status(403).json({ error: 'forbidden' });
    const subject = req.body?.email_subject ?? null;
    const html = req.body?.email_html ?? null;
    const wa = req.body?.wa_template ?? null;
    await pool.query(
      'INSERT INTO estab_messages (estabelecimento_id, email_subject, email_html, wa_template) VALUES (?,?,?,?)\n       ON DUPLICATE KEY UPDATE email_subject=?, email_html=?, wa_template=?',
      [id, subject, html, wa, subject, html, wa]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /establishments/:id/messages', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Atualizar slug do estabelecimento
router.put('/:id/slug', auth, isEstabelecimento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || req.user.id !== id) return res.status(403).json({ error: 'forbidden' });
    const slugRaw = String(req.body?.slug || '').trim().toLowerCase();
    if (!/^([a-z0-9]+(?:-[a-z0-9]+)*)$/.test(slugRaw) || slugRaw.length < 3 || slugRaw.length > 160) {
      return res.status(400).json({ error: 'invalid_slug', message: 'Use apenas letras, numeros e hifens. Min 3, max 160.' });
    }
    // checa unicidade
    const [rows] = await pool.query("SELECT id FROM usuarios WHERE slug=? LIMIT 1", [slugRaw]);
    if (rows.length && rows[0].id !== id) return res.status(409).json({ error: 'slug_taken' });
    await pool.query('UPDATE usuarios SET slug=? WHERE id=? AND tipo=\'estabelecimento\'', [slugRaw, id]);
    return res.json({ ok: true, slug: slugRaw });
  } catch (e) {
    console.error('PUT /establishments/:id/slug', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.put('/:id/plan', auth, isEstabelecimento, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || req.user.id !== id) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const rawPlan = String(req.body?.plan || '').toLowerCase();
    if (!PLAN_TIERS.includes(rawPlan)) {
      return res.status(400).json({ error: 'invalid_plan', message: 'Plano invalido.' });
    }

    const context = await getPlanContext(id);
    if (!context) {
      return res.status(404).json({ error: 'not_found' });
    }

    const currentPlan = context.plan;
    const currentStatus = context.status;
    const targetConfig = resolvePlanConfig(rawPlan);

    if (isDowngrade(currentPlan, rawPlan)) {
      const [[svcRow]] = await pool.query(
        'SELECT COUNT(*) AS total FROM servicos WHERE estabelecimento_id=?',
        [id]
      );
      const totalServices = Number(svcRow?.total || 0);
      if (targetConfig.maxServices !== null && totalServices > targetConfig.maxServices) {
        return res.status(409).json({
          error: 'plan_downgrade_blocked',
          message: formatPlanLimitExceeded(targetConfig, 'services'),
          details: { services: totalServices, limit: targetConfig.maxServices },
        });
      }

      if (targetConfig.maxProfessionals !== null) {
        const totalProfessionals = await countProfessionals(id);
        if (totalProfessionals > targetConfig.maxProfessionals) {
          return res.status(409).json({
            error: 'plan_downgrade_blocked',
            message: formatPlanLimitExceeded(targetConfig, 'professionals'),
            details: { professionals: totalProfessionals, limit: targetConfig.maxProfessionals },
          });
        }
      }
    }

    let planStatus = currentStatus;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
      const nextStatus = String(req.body.status || '').toLowerCase();
      if (!PLAN_STATUS.includes(nextStatus)) {
        return res.status(400).json({ error: 'invalid_status', message: 'Status de plano invalido.' });
      }
      planStatus = nextStatus;
    }

    let planTrialEndsAt = context.trialEndsAt;
    if (req.body?.trialEndsAt) {
      const parsed = new Date(req.body.trialEndsAt);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'invalid_trial', message: 'trialEndsAt invalido.' });
      }
      planTrialEndsAt = parsed;
    } else if (req.body?.trialDays) {
      const days = Number(req.body.trialDays);
      if (!Number.isFinite(days) || days <= 0 || days > 60) {
        return res.status(400).json({ error: 'invalid_trial', message: 'trialDays deve ser entre 1 e 60.' });
      }
      const dt = new Date();
      dt.setDate(dt.getDate() + days);
      planTrialEndsAt = dt;
    } else if (rawPlan === 'starter') {
      planTrialEndsAt = null;
    }

    if (planStatus !== 'trialing') {
      planTrialEndsAt = null;
    }

    let planActiveUntil = context.activeUntil;
    if (req.body?.activeUntil) {
      const parsed = new Date(req.body.activeUntil);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'invalid_active_until', message: 'activeUntil invalido.' });
      }
      planActiveUntil = parsed;
    }

    let subscriptionId = context.subscriptionId;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'subscriptionId')) {
      const nextSubId = String(req.body.subscriptionId || '').trim();
      subscriptionId = nextSubId ? nextSubId : null;
    }

    await pool.query(
      "UPDATE usuarios SET plan=?, plan_status=?, plan_trial_ends_at=?, plan_active_until=?, plan_subscription_id=? WHERE id=? AND tipo='estabelecimento'",
      [rawPlan, planStatus, planTrialEndsAt, planActiveUntil, subscriptionId, id]
    );

    const updatedContext = await getPlanContext(id);
    if (!updatedContext) {
      return res.status(404).json({ error: 'not_found' });
    }

    req.user = {
      ...req.user,
      plan: updatedContext.plan,
      plan_status: updatedContext.status,
      plan_trial_ends_at: updatedContext.trialEndsAt ? updatedContext.trialEndsAt.toISOString() : null,
      plan_active_until: updatedContext.activeUntil ? updatedContext.activeUntil.toISOString() : null,
      plan_subscription_id: updatedContext.subscriptionId,
    };

    return res.json({
      ok: true,
      plan: serializePlanContext(updatedContext),
    });
  } catch (e) {
    console.error('PUT /establishments/:id/plan', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;






