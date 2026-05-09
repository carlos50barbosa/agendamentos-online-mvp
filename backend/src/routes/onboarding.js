import { Router } from 'express';
import { pool } from '../lib/db.js';
import { buildWorkingRules, fmtMin } from '../lib/expediente.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';

const router = Router();

const STEPS = new Set(['profissionais', 'servicos', 'horarios', 'revisao']);
const WEEKDAYS = [
  { key: 'sunday', label: 'Domingo' },
  { key: 'monday', label: 'Segunda' },
  { key: 'tuesday', label: 'Terca' },
  { key: 'wednesday', label: 'Quarta' },
  { key: 'thursday', label: 'Quinta' },
  { key: 'friday', label: 'Sexta' },
  { key: 'saturday', label: 'Sabado' },
];
const WEEKDAY_BY_KEY = new Map(WEEKDAYS.map((item) => [item.key, item]));

function toBool(value) {
  if (value === true || value === false) return value;
  const num = Number(value);
  if (Number.isFinite(num)) return num !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'sim'].includes(normalized);
}

function normalizeStep(value, fallback = 'profissionais') {
  const step = String(value || '').trim().toLowerCase();
  if (step === 'finalizado') return 'revisao';
  return STEPS.has(step) ? step : fallback;
}

function normalizeTime(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function timeToMinutes(value) {
  const time = normalizeTime(value);
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatCurrencyCentavos(value) {
  const cents = Number(value || 0);
  return Number.isFinite(cents) ? cents : 0;
}

function serializeHorarios(horariosJson) {
  if (!horariosJson) return [];
  let parsed = [];
  try {
    parsed = JSON.parse(horariosJson);
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => {
      const day = String(item?.day || item?.key || '').trim().toLowerCase();
      const weekday = WEEKDAY_BY_KEY.get(day);
      const start = normalizeTime(item?.start);
      const end = normalizeTime(item?.end);
      const blocks = Array.isArray(item?.blocks)
        ? item.blocks
            .map((block) => ({
              start: normalizeTime(block?.start),
              end: normalizeTime(block?.end),
            }))
            .filter((block) => block.start && block.end)
        : [];

      return {
        day,
        label: item?.label || weekday?.label || day,
        value: item?.value || (start && end ? `${start} - ${end}` : ''),
        start,
        end,
        blocks,
      };
    })
    .filter((item) => item.day && item.start && item.end);
}

function countActiveWorkingDays(horariosJson) {
  const rules = buildWorkingRules(horariosJson);
  if (!Array.isArray(rules)) return 0;
  return rules.reduce((total, rule) => total + (rule?.enabled ? 1 : 0), 0);
}

async function loadOnboardingState(establishmentId) {
  const [[user]] = await pool.query(
    `SELECT id, nome, onboarding_concluido, onboarding_etapa
       FROM usuarios
      WHERE id=? AND tipo='estabelecimento'
      LIMIT 1`,
    [establishmentId]
  );

  if (!user) return null;

  const [professionals] = await pool.query(
    `SELECT id, nome, descricao, avatar_url, ativo, created_at
       FROM profissionais
      WHERE estabelecimento_id=?
      ORDER BY nome`,
    [establishmentId]
  );

  const [services] = await pool.query(
    `SELECT id, nome, descricao, duracao_min, preco_centavos, capacidade_por_horario, ativo
       FROM servicos
      WHERE estabelecimento_id=?
      ORDER BY id DESC`,
    [establishmentId]
  );

  const serviceIds = (services || []).map((service) => service.id);
  const professionalsByService = new Map();
  if (serviceIds.length) {
    const placeholders = serviceIds.map(() => '?').join(',');
    const [links] = await pool.query(
      `SELECT sp.servico_id, p.id, p.nome
         FROM servico_profissionais sp
         JOIN profissionais p ON p.id = sp.profissional_id
        WHERE sp.servico_id IN (${placeholders})
        ORDER BY p.nome`,
      serviceIds
    );
    (links || []).forEach((row) => {
      const key = Number(row.servico_id);
      if (!professionalsByService.has(key)) professionalsByService.set(key, []);
      professionalsByService.get(key).push({ id: row.id, nome: row.nome });
    });
  }

  const [[profile]] = await pool.query(
    'SELECT horarios_json FROM estabelecimento_perfis WHERE estabelecimento_id=? LIMIT 1',
    [establishmentId]
  );

  const horariosJson = profile?.horarios_json || null;
  const serializedServices = (services || []).map((service) => {
    const professionalsLinked = professionalsByService.get(Number(service.id)) || [];
    return {
      id: service.id,
      nome: service.nome,
      descricao: service.descricao,
      duracao_min: service.duracao_min,
      preco_centavos: formatCurrencyCentavos(service.preco_centavos),
      capacidade_por_horario: service.capacidade_por_horario,
      ativo: toBool(service.ativo),
      professionals: professionalsLinked,
    };
  });

  const activeProfessionals = (professionals || []).filter((item) => toBool(item.ativo));
  const activeServices = serializedServices.filter((item) => toBool(item.ativo));
  const horariosCount = countActiveWorkingDays(horariosJson);

  const counts = {
    profissionais: activeProfessionals.length,
    servicos: activeServices.length,
    horarios: horariosCount,
  };

  return {
    onboarding: {
      concluido: toBool(user.onboarding_concluido),
      etapa: normalizeStep(user.onboarding_etapa, 'profissionais'),
    },
    counts,
    ready: {
      profissionais: counts.profissionais > 0,
      servicos: counts.servicos > 0,
      horarios: counts.horarios > 0,
      can_finish: counts.profissionais > 0 && counts.servicos > 0 && counts.horarios > 0,
    },
    professionals: professionals || [],
    services: serializedServices,
    horarios: serializeHorarios(horariosJson),
  };
}

function getStepBlock(step, counts) {
  if (step === 'servicos' && counts.profissionais < 1) {
    return {
      error: 'profissionais_obrigatorios',
      message: 'Cadastre pelo menos um profissional antes de avancar para servicos.',
    };
  }
  if ((step === 'horarios' || step === 'revisao') && counts.servicos < 1) {
    return {
      error: 'servicos_obrigatorios',
      message: 'Cadastre pelo menos um servico antes de avancar para horarios.',
    };
  }
  if (step === 'revisao' && counts.horarios < 1) {
    return {
      error: 'horarios_obrigatorios',
      message: 'Configure pelo menos um dia de funcionamento antes da revisao.',
    };
  }
  return null;
}

function getFinishErrors(counts) {
  const errors = [];
  if (counts.profissionais < 1) errors.push('profissionais_obrigatorios');
  if (counts.servicos < 1) errors.push('servicos_obrigatorios');
  if (counts.horarios < 1) errors.push('horarios_obrigatorios');
  return errors;
}

function sanitizeWorkingHours(payload) {
  const source = Array.isArray(payload?.horarios) ? payload.horarios : [];
  const entries = [];
  const seen = new Set();

  for (const item of source) {
    const dayKey = String(item?.day || item?.key || '').trim().toLowerCase();
    const weekday = WEEKDAY_BY_KEY.get(dayKey);
    if (!weekday || seen.has(dayKey)) continue;
    seen.add(dayKey);

    if (item?.enabled === false || item?.ativo === false) continue;

    const start = normalizeTime(item?.start ?? item?.abertura);
    const end = normalizeTime(item?.end ?? item?.fechamento);
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);

    if (!start || !end || startMinutes == null || endMinutes == null || startMinutes >= endMinutes) {
      const err = new Error(`Horario invalido para ${weekday.label}.`);
      err.status = 400;
      err.code = 'horario_invalido';
      throw err;
    }

    const blocks = [];
    const breakEnabled = toBool(item?.breakEnabled ?? item?.pausa_ativa ?? false);
    if (breakEnabled) {
      const blockStart = normalizeTime(item?.blockStart ?? item?.pauseStart ?? item?.pausa_inicio);
      const blockEnd = normalizeTime(item?.blockEnd ?? item?.pauseEnd ?? item?.pausa_fim);
      const blockStartMinutes = timeToMinutes(blockStart);
      const blockEndMinutes = timeToMinutes(blockEnd);
      if (
        !blockStart ||
        !blockEnd ||
        blockStartMinutes == null ||
        blockEndMinutes == null ||
        blockStartMinutes >= blockEndMinutes ||
        blockStartMinutes < startMinutes ||
        blockEndMinutes > endMinutes
      ) {
        const err = new Error(`Pausa invalida para ${weekday.label}.`);
        err.status = 400;
        err.code = 'pausa_invalida';
        throw err;
      }
      blocks.push({ start: blockStart, end: blockEnd });
    }

    entries.push({
      label: weekday.label,
      value: `${fmtMin(startMinutes)} - ${fmtMin(endMinutes)}`,
      day: dayKey,
      start,
      end,
      ...(blocks.length ? { blocks, breaks: blocks } : {}),
    });
  }

  if (!entries.length) {
    const err = new Error('Configure pelo menos um dia de funcionamento.');
    err.status = 400;
    err.code = 'horarios_obrigatorios';
    throw err;
  }

  return JSON.stringify(entries);
}

router.get('/', auth, isEstabelecimento, async (req, res) => {
  try {
    const state = await loadOnboardingState(req.user.id);
    if (!state) return res.status(404).json({ error: 'estabelecimento_inexistente' });
    return res.json({ ok: true, ...state });
  } catch (err) {
    console.error('[onboarding][status]', err);
    return res.status(500).json({ error: 'onboarding_status_failed' });
  }
});

router.patch('/', auth, isEstabelecimento, async (req, res) => {
  try {
    const nextStep = normalizeStep(req.body?.etapa, '');
    if (!nextStep) {
      return res.status(400).json({ error: 'etapa_invalida', message: 'Etapa invalida.' });
    }

    const state = await loadOnboardingState(req.user.id);
    if (!state) return res.status(404).json({ error: 'estabelecimento_inexistente' });

    const block = getStepBlock(nextStep, state.counts);
    if (block) {
      return res.status(409).json({ ...block, counts: state.counts });
    }

    await pool.query(
      'UPDATE usuarios SET onboarding_etapa=? WHERE id=? AND tipo=\'estabelecimento\'',
      [nextStep, req.user.id]
    );

    const updated = await loadOnboardingState(req.user.id);
    return res.json({ ok: true, ...updated });
  } catch (err) {
    console.error('[onboarding][step]', err);
    return res.status(500).json({ error: 'onboarding_step_failed' });
  }
});

router.put('/horarios', auth, isEstabelecimento, async (req, res) => {
  try {
    const horariosJson = sanitizeWorkingHours(req.body || {});
    await pool.query(
      `INSERT INTO estabelecimento_perfis (estabelecimento_id, horarios_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE horarios_json=VALUES(horarios_json)`,
      [req.user.id, horariosJson]
    );

    await pool.query(
      'UPDATE usuarios SET onboarding_etapa=? WHERE id=? AND tipo=\'estabelecimento\'',
      ['revisao', req.user.id]
    );

    const updated = await loadOnboardingState(req.user.id);
    return res.json({ ok: true, ...updated });
  } catch (err) {
    if (err?.status) {
      return res.status(err.status).json({ error: err.code || 'horario_invalido', message: err.message });
    }
    console.error('[onboarding][horarios]', err);
    return res.status(500).json({ error: 'onboarding_horarios_failed' });
  }
});

router.post('/finalizar', auth, isEstabelecimento, async (req, res) => {
  try {
    const state = await loadOnboardingState(req.user.id);
    if (!state) return res.status(404).json({ error: 'estabelecimento_inexistente' });

    const errors = getFinishErrors(state.counts);
    if (errors.length) {
      return res.status(409).json({
        error: 'onboarding_incompleto',
        message: 'Complete profissionais, servicos e horarios antes de finalizar.',
        details: errors,
        counts: state.counts,
      });
    }

    await pool.query(
      `UPDATE usuarios
          SET onboarding_concluido=1,
              onboarding_etapa='finalizado'
        WHERE id=? AND tipo='estabelecimento'`,
      [req.user.id]
    );

    const updated = await loadOnboardingState(req.user.id);
    return res.json({
      ok: true,
      ...updated,
      user_updates: {
        onboarding_concluido: true,
        onboarding_etapa: 'finalizado',
      },
    });
  } catch (err) {
    console.error('[onboarding][finish]', err);
    return res.status(500).json({ error: 'onboarding_finish_failed' });
  }
});

export default router;
