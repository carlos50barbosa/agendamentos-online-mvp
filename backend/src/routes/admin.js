// backend/src/routes/admin.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { cleanupPasswordResets } from '../lib/maintenance.js';

const router = Router();

function checkAdmin(req, res, next){
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return res.status(404).json({ error: 'admin_disabled' });
  const header = req.headers['x-admin-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header && header === adminToken) return next();
  return res.status(403).json({ error: 'forbidden' });
}

router.post('/cleanup', checkAdmin, async (_req, res) => {
  const r = await cleanupPasswordResets(pool);
  res.json({ ok: true, ...r });
});

export default router;

