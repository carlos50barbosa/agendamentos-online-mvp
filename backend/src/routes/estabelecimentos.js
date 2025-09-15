// backend/src/routes/estabelecimentos.js
import { Router } from "express";
import { pool } from "../lib/db.js";
import { auth, isEstabelecimento } from "../middleware/auth.js";

const router = Router();

// Lista todos os usuários com perfil de estabelecimento
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
        "SELECT id, nome, email, telefone, slug FROM usuarios WHERE id=? AND tipo='estabelecimento' LIMIT 1",
        [id]
      );
    } else {
      [rows] = await pool.query(
        "SELECT id, nome, email, telefone, slug FROM usuarios WHERE slug=? AND tipo='estabelecimento' LIMIT 1",
        [idOrSlug]
      );
    }
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
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
      return res.status(400).json({ error: 'invalid_slug', message: 'Use apenas letras, números e hífens. Mín 3, máx 160.' });
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

export default router;
