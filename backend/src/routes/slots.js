// src/routes/slots.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';

const router = Router();

// ===== Configuração padrão de funcionamento =====
const OPEN_HOUR = 9;      // 09:00
const CLOSE_HOUR = 18;    // até 18:00 (exclui 18:30)
const INTERVAL_MIN = 30;  // intervalo de 30min

// Helpers
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const toISO = (d) => new Date(d).toISOString();

/**
 * GET /slots?establishmentId=ID&weekStart=YYYY-MM-DD
 * Retorna { slots: [{ datetime, label, status }] }
 * - Busca agendamentos confirmados (agendamentos.status='confirmado')
 * - Busca bloqueios na tabela "bloqueios"
 */
router.get('/', async (req, res) => {
  const { establishmentId, weekStart } = req.query;
  if (!establishmentId || !weekStart) {
    return res.status(400).json({ error: 'missing_params' });
  }

  try {
    // Define o range da semana [weekStart .. weekStart+6]
    const start = new Date(`${weekStart}T00:00:00`);
    const end = addDays(start, 6);

    // Carrega agendamentos confirmados e bloqueios no período
    const [ags] = await pool.query(
      `
      SELECT inicio, fim
        FROM agendamentos
       WHERE estabelecimento_id = ?
         AND status = 'confirmado'
         AND DATE(inicio) BETWEEN DATE(?) AND DATE(?)
      `,
      [establishmentId, start, end]
    );

    const [blq] = await pool.query(
      `
      SELECT inicio, fim
        FROM bloqueios
       WHERE estabelecimento_id = ?
         AND DATE(inicio) BETWEEN DATE(?) AND DATE(?)
      `,
      [establishmentId, start, end]
    );

    // Monta grade da semana em passos de 30min
    const slots = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, d);
      for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
        for (let m = 0; m < 60; m += INTERVAL_MIN) {
          const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0);
          const e = new Date(s.getTime() + INTERVAL_MIN * 60000);

          const ocupado = ags.some(a => new Date(a.inicio) < e && new Date(a.fim) > s);
          const bloqueado = blq.some(b => new Date(b.inicio) < e && new Date(b.fim) > s);

          const label = ocupado ? 'agendado' : (bloqueado ? 'bloqueado' : 'disponível');
          const status = ocupado ? 'booked' : (bloqueado ? 'unavailable' : 'free');

          slots.push({
            datetime: toISO(s), // ISO-8601 (evita ambiguidade de timezone no front)
            label,
            status
          });
        }
      }
    }

    res.json({ slots });
  } catch (e) {
    console.error('GET /slots error:', e);
    res.status(500).json({ error: 'slots_fetch_failed' });
  }
});

/**
 * POST /slots/toggle
 * body: { slotDatetime }
 * — Bloqueia ou libera um intervalo de 30 min do estabelecimento logado
 */
router.post('/toggle', auth, isEstabelecimento, async (req, res) => {
  const { slotDatetime } = req.body;
  if (!slotDatetime) return res.status(400).json({ error: 'missing_slot' });

  try {
    const s = new Date(slotDatetime);
    const e = new Date(s.getTime() + INTERVAL_MIN * 60000);

    // Já existe bloqueio exato para esse intervalo?
    const [rows] = await pool.query(
      `SELECT id
         FROM bloqueios
        WHERE estabelecimento_id = ?
          AND inicio = ?
          AND fim = ?`,
      [req.user.id, s, e]
    );

    if (rows.length) {
      await pool.query(`DELETE FROM bloqueios WHERE id = ?`, [rows[0].id]);
      return res.json({ ok: true, action: 'liberado' });
    } else {
      // Antes de bloquear, você pode checar se já há agendamento nesse horário
      // e impedir o bloqueio; por ora, só criamos o bloqueio.
      await pool.query(
        `INSERT INTO bloqueios (estabelecimento_id, inicio, fim) VALUES (?,?,?)`,
        [req.user.id, s, e]
      );
      return res.json({ ok: true, action: 'bloqueado' });
    }
  } catch (e) {
    console.error('POST /slots/toggle error:', e);
    res.status(500).json({ error: 'toggle_failed' });
  }
});

export default router;
