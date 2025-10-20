// backend/src/routes/auth.js
import { Router } from 'express';
import { pool } from '../lib/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { auth } from '../middleware/auth.js';
import dotenv from 'dotenv'; dotenv.config();
import { notifyEmail } from '../lib/notifications.js';
import crypto from 'crypto';
import { consumeLinkToken } from '../lib/wa_store.js';
import { saveAvatarFromDataUrl, removeAvatarFile } from '../lib/avatar.js';

const router = Router();

const toBool = (value) => {
  if (value === true || value === false) return Boolean(value);
  const num = Number(value);
  if (!Number.isNaN(num)) return num !== 0;
  if (typeof value === 'string') {
    const norm = value.trim().toLowerCase();
    if (['true', 'on', 'yes', 'sim', '1'].includes(norm)) return true;
    if (['false', 'off', 'no', 'nao', '0'].includes(norm)) return false;
  }
  return false;
};

router.post('/register', async (req, res) => {
  try {
    const {
      nome,
      email,
      senha,
      tipo,
      telefone,
      cep,
      endereco,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      notifyEmailEstab,
      notifyWhatsappEstab,
    } = req.body || {};

    if (!nome || !email || !senha || !['cliente','estabelecimento'].includes(tipo)) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const telefoneTrim = telefone === undefined || telefone === null ? null : String(telefone).trim();
    if (!telefoneTrim) {
      return res.status(400).json({ error: 'telefone_obrigatorio', message: 'Informe um telefone com DDD.' });
    }
    if (telefoneTrim.length > 20) {
      return res.status(400).json({ error: 'telefone_invalido' });
    }

    const nomeTrim = String(nome).trim();
    const emailTrim = String(email).trim();
    const emailNorm = emailTrim.toLowerCase();
    const cepDigits = (cep ? String(cep) : '').replace(/[^0-9]/g, '').slice(0, 8);
    const enderecoTrim = endereco ? String(endereco).trim() : '';
    const numeroTrim = numero ? String(numero).trim() : '';
    const complementoTrim = complemento ? String(complemento).trim() : '';
    const bairroTrim = bairro ? String(bairro).trim() : '';
    const cidadeTrim = cidade ? String(cidade).trim() : '';
    const estadoTrim = estado ? String(estado).trim().toUpperCase() : '';

    if (tipo === 'estabelecimento') {
      if (cepDigits.length !== 8) {
        return res.status(400).json({ error: 'cep_invalido', message: 'Informe um CEP valido com 8 digitos.' });
      }
      if (!enderecoTrim) {
        return res.status(400).json({ error: 'endereco_obrigatorio', message: 'Informe o endereco do estabelecimento.' });
      }
      if (!numeroTrim) {
        return res.status(400).json({ error: 'numero_obrigatorio', message: 'Informe o numero do endereco.' });
      }
      if (!bairroTrim) {
        return res.status(400).json({ error: 'bairro_obrigatorio', message: 'Informe o bairro do endereco.' });
      }
      if (!cidadeTrim) {
        return res.status(400).json({ error: 'cidade_obrigatoria', message: 'Informe a cidade.' });
      }
      if (!/^[A-Z]{2}$/.test(estadoTrim)) {
        return res.status(400).json({ error: 'estado_invalido', message: 'Informe a UF com 2 letras.' });
      }
    } else {
      if (cepDigits.length && cepDigits.length !== 8) {
        return res.status(400).json({ error: 'cep_invalido', message: 'Informe um CEP valido com 8 digitos.' });
      }
      if (estadoTrim && !/^[A-Z]{2}$/.test(estadoTrim)) {
        return res.status(400).json({ error: 'estado_invalido', message: 'Informe a UF com 2 letras.' });
      }
    }

    const [rows] = await pool.query('SELECT id FROM usuarios WHERE LOWER(email)=? LIMIT 1', [emailNorm]);
    if (rows.length) return res.status(400).json({ error: 'email_exists' });

    const now = new Date();
    const trialEndsAt = tipo === 'estabelecimento' ? new Date(now.getTime() + 14 * 86400000) : null;

    const hash = await bcrypt.hash(String(senha), 10);
    const [r] = await pool.query(
      'INSERT INTO usuarios (nome, email, telefone, cep, endereco, numero, complemento, bairro, cidade, estado, avatar_url, senha_hash, tipo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        nomeTrim,
        emailTrim,
        telefoneTrim || null,
        cepDigits || null,
        enderecoTrim || null,
        numeroTrim || null,
        complementoTrim || null,
        bairroTrim || null,
        cidadeTrim || null,
        estadoTrim || null,
        null,
        hash,
        tipo,
      ]
    );

    if (trialEndsAt) {
      try {
        await pool.query('UPDATE usuarios SET plan_trial_ends_at=? WHERE id=?', [trialEndsAt, r.insertId]);
      } catch (err) {
        console.error('[auth/register] failed to set trial end', err);
      }
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'server_config', message: 'JWT_SECRET ausente.' });

    const user = {
      id: r.insertId,
      nome: nomeTrim,
      email: emailTrim,
      telefone: telefoneTrim || null,
      cep: cepDigits || null,
      endereco: enderecoTrim || null,
      numero: numeroTrim || null,
      complemento: complementoTrim || null,
      bairro: bairroTrim || null,
      cidade: cidadeTrim || null,
      estado: estadoTrim || null,
      tipo,
      plan: 'starter',
      notify_email_estab: tipo === 'estabelecimento',
      notify_whatsapp_estab: tipo === 'estabelecimento',
      plan_status: 'trialing',
      plan_trial_ends_at: trialEndsAt ? trialEndsAt.toISOString() : null,
      plan_active_until: null,
      plan_subscription_id: null,
    };
    const token = jwt.sign({ id: user.id, nome: nomeTrim, email: emailTrim, tipo }, secret, { expiresIn: '10h' });
    res.json({ token, user });
  } catch (e) {
    console.error('[auth/register] erro:', e);
    res.status(500).json({ error: 'server_error' });
  }
});



router.post('/login', async (req, res) => {
  try {
    const emailRaw = req.body?.email;
    const senha = req.body?.senha;
    if (!emailRaw || !senha) {
      return res.status(400).json({ error: 'missing_fields', message: 'Informe email e senha.' });
    }
    const email = String(emailRaw).trim().toLowerCase();

    const [rows] = await pool.query(
      'SELECT id, nome, email, telefone, cep, endereco, numero, complemento, bairro, cidade, estado, avatar_url, senha_hash, tipo, notify_email_estab, notify_whatsapp_estab, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE LOWER(email)=? LIMIT 1',
      [email]
    );
    if (!rows.length) return res.status(401).json({ error: 'invalid_credentials' });

    const u = rows[0];
    if (!u.senha_hash) {
      return res.status(500).json({ error: 'user_password_not_configured' });
    }

    const ok = await bcrypt.compare(String(senha), String(u.senha_hash));
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'server_config', message: 'JWT_SECRET ausente.' });

    const payload = { id: u.id, nome: u.nome, email: u.email, tipo: u.tipo || 'cliente' };
    const token = jwt.sign(payload, secret, { expiresIn: '10h' });

    const user = {
      id: u.id,
      nome: u.nome,
      email: u.email,
      telefone: u.telefone,
      cep: u.cep || null,
      endereco: u.endereco || null,
      numero: u.numero || null,
      complemento: u.complemento || null,
      bairro: u.bairro || null,
      cidade: u.cidade || null,
      estado: u.estado || null,
      avatar_url: u.avatar_url || null,
      tipo: u.tipo || 'cliente',
      notify_email_estab: toBool(u.notify_email_estab),
      notify_whatsapp_estab: toBool(u.notify_whatsapp_estab),
      plan: u.plan || 'starter',
      plan_status: u.plan_status || 'trialing',
      plan_trial_ends_at: u.plan_trial_ends_at ? new Date(u.plan_trial_ends_at).toISOString() : null,
      plan_active_until: u.plan_active_until ? new Date(u.plan_active_until).toISOString() : null,
      plan_subscription_id: u.plan_subscription_id || null,
    };
    return res.json({ ok: true, token, user });
  } catch (e) {
    console.error('[auth/login] erro:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});




router.get('/me', auth, async (req, res) => {
  try {
    const [[pending]] = await pool.query('SELECT new_email, expires_at FROM email_change_tokens WHERE user_id=? LIMIT 1', [req.user.id]);
    const emailConfirmation = pending
      ? { pending: true, newEmail: pending.new_email, expiresAt: pending.expires_at }
      : null;
    res.json({ user: req.user, emailConfirmation });
  } catch (e) {
    console.error('[auth/me][GET]', e);
    res.json({ user: req.user, emailConfirmation: null });
  }
});



router.put('/me', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    let {
      nome,
      email,
      telefone,
      senhaAtual,
      senhaNova,
      cep,
      endereco,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      notifyEmailEstab,
      notifyWhatsappEstab,
    } = req.body || {};

    nome = String(nome || '').trim();
    email = String(email || '').trim();
    telefone = telefone === undefined || telefone === null ? null : String(telefone).trim();
    const cepDigitsRaw = (cep ? String(cep) : '').replace(/[^0-9]/g, '').slice(0, 8);
    const cepNormalized = cepDigitsRaw.length === 8 ? cepDigitsRaw : '';
    const enderecoTrim = endereco ? String(endereco).trim() : '';
    const numeroTrim = numero ? String(numero).trim() : '';
    const complementoTrim = complemento ? String(complemento).trim() : '';
    const bairroTrim = bairro ? String(bairro).trim() : '';
    const cidadeTrim = cidade ? String(cidade).trim() : '';
    const estadoTrim = estado ? String(estado).trim().toUpperCase() : '';
    const addressRequired = req.user?.tipo === 'estabelecimento';

    if (!nome) {
      return res.status(400).json({ error: 'nome_invalido', message: 'Informe seu nome.' });
    }
    if (!email) {
      return res.status(400).json({ error: 'email_invalido', message: 'Informe um email.' });
    }

    const emailNorm = email.toLowerCase();
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(emailNorm)) {
      return res.status(400).json({ error: 'email_invalido', message: 'Email invalido.' });
    }

    if (addressRequired) {
      if (cepDigitsRaw.length !== 8) {
        return res.status(400).json({ error: 'cep_invalido', message: 'Informe um CEP valido com 8 digitos.' });
      }
      if (!enderecoTrim) {
        return res.status(400).json({ error: 'endereco_obrigatorio', message: 'Informe o endereco do estabelecimento.' });
      }
      if (!numeroTrim) {
        return res.status(400).json({ error: 'numero_obrigatorio', message: 'Informe o numero do endereco.' });
      }
      if (!bairroTrim) {
        return res.status(400).json({ error: 'bairro_obrigatorio', message: 'Informe o bairro do endereco.' });
      }
      if (!cidadeTrim) {
        return res.status(400).json({ error: 'cidade_obrigatoria', message: 'Informe a cidade.' });
      }
      if (!/^[A-Z]{2}$/.test(estadoTrim)) {
        return res.status(400).json({ error: 'estado_invalido', message: 'Informe a UF com 2 letras.' });
      }
    } else {
      if (cepDigitsRaw.length && cepDigitsRaw.length !== 8) {
        return res.status(400).json({ error: 'cep_invalido', message: 'Informe um CEP valido com 8 digitos.' });
      }
      if (estadoTrim && !/^[A-Z]{2}$/.test(estadoTrim)) {
        return res.status(400).json({ error: 'estado_invalido', message: 'Informe a UF com 2 letras.' });
      }
    }

    const phoneClean = telefone ? telefone.replace(/[^\d+]/g, '') : null;
    if (phoneClean && phoneClean.length > 25) {
      return res.status(400).json({ error: 'telefone_invalido', message: 'Telefone invalido.' });
    }

    const isEstabUser = req.user?.tipo === 'estabelecimento';
    const parseToggle = (value) => {
      if (value === undefined || value === null) return null;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value === 1;
      if (typeof value === 'string') {
        const norm = value.trim().toLowerCase();
        if (['1', 'true', 'on', 'yes', 'sim'].includes(norm)) return true;
        if (['0', 'false', 'off', 'no', 'nao'].includes(norm)) return false;
      }
      return null;
    };
    const notifyEmailRaw = notifyEmailEstab ?? req.body?.notify_email_estab;
    const notifyWhatsappRaw = notifyWhatsappEstab ?? req.body?.notify_whatsapp_estab;
    const currentNotifyEmail = Boolean(req.user?.notify_email_estab);
    const currentNotifyWhatsapp = Boolean(req.user?.notify_whatsapp_estab);
    const nextNotifyEmail = isEstabUser
      ? (parseToggle(notifyEmailRaw) ?? currentNotifyEmail)
      : currentNotifyEmail;
    const nextNotifyWhatsapp = isEstabUser
      ? (parseToggle(notifyWhatsappRaw) ?? currentNotifyWhatsapp)
      : currentNotifyWhatsapp;

    const [emailRows] = await pool.query('SELECT id FROM usuarios WHERE LOWER(email)=? AND id<>? LIMIT 1', [emailNorm, userId]);
    if (emailRows.length) {
      return res.status(400).json({ error: 'email_exists', message: 'Este email ja esta em uso.' });
    }

    const atual = String(senhaAtual || '').trim();
    if (!atual) {
      return res.status(400).json({ error: 'senha_atual_obrigatoria', message: 'Informe a senha atual.' });
    }

    const [[row]] = await pool.query('SELECT senha_hash FROM usuarios WHERE id=? LIMIT 1', [userId]);
    if (!row || !row.senha_hash) {
      return res.status(400).json({ error: 'senha_indefinida', message: 'Nao foi possivel validar a senha atual.' });
    }

    const okAtual = await bcrypt.compare(atual, row.senha_hash);
    if (!okAtual) {
      return res.status(400).json({ error: 'senha_incorreta', message: 'Senha atual incorreta.' });
    }

    const previousAvatar = req.user?.avatar_url || null;
    const avatarRaw = typeof req.body?.avatar === 'string' ? req.body.avatar.trim() : '';
    const wantsRemoveAvatar = req.body?.avatarRemove === true || req.body?.avatarRemove === 'true';
    let nextAvatar = previousAvatar;

    if (wantsRemoveAvatar && previousAvatar) {
      try {
        await removeAvatarFile(previousAvatar);
      } catch (err) {
        if (err?.code !== 'ENOENT') console.warn('[auth/me][avatar] remove failed', err?.message || err);
      }
      nextAvatar = null;
    }

    if (avatarRaw) {
      if (!avatarRaw.startsWith('data:image/')) {
        return res.status(400).json({ error: 'avatar_invalido', message: 'Envie uma imagem PNG, JPG ou WEBP.' });
      }
      try {
        const previousForSave = wantsRemoveAvatar ? null : previousAvatar;
        nextAvatar = await saveAvatarFromDataUrl(avatarRaw, userId, previousForSave);
      } catch (err) {
        if (err?.code === 'AVATAR_TOO_LARGE') {
          return res.status(400).json({ error: 'avatar_grande', message: 'A imagem deve ter no maximo 2MB.' });
        }
        if (err?.code === 'AVATAR_INVALID') {
          return res.status(400).json({ error: 'avatar_invalido', message: 'Envie uma imagem PNG, JPG ou WEBP.' });
        }
        console.error('[auth/me][avatar] erro:', err);
        return res.status(500).json({ error: 'avatar_falhou', message: 'Nao foi possivel salvar a foto de perfil.' });
      }
    }

    if (senhaNova) {
      const nova = String(senhaNova || '');
      if (nova.length < 6) {
        return res.status(400).json({ error: 'senha_fraca', message: 'A nova senha deve ter pelo menos 6 caracteres.' });
      }
      const newHash = await bcrypt.hash(nova, 10);
      await pool.query('UPDATE usuarios SET senha_hash=? WHERE id=?', [newHash, userId]);
    }

    const cepValue = cepNormalized || null;
    const enderecoValue = enderecoTrim || null;
    const numeroValue = numeroTrim || null;
    const complementoValue = complementoTrim || null;
    const bairroValue = bairroTrim || null;
    const cidadeValue = cidadeTrim || null;
    const estadoValue = estadoTrim || null;

    const currentEmail = String(req.user?.email || '').trim().toLowerCase();
    const emailChanged = emailNorm !== currentEmail;

    if (emailChanged) {
      await pool.query(
        'UPDATE usuarios SET nome=?, telefone=?, cep=?, endereco=?, numero=?, complemento=?, bairro=?, cidade=?, estado=?, notify_email_estab=?, notify_whatsapp_estab=?, avatar_url=? WHERE id=?',
        [nome, phoneClean || null, cepValue, enderecoValue, numeroValue, complementoValue, bairroValue, cidadeValue, estadoValue, nextNotifyEmail ? 1 : 0, nextNotifyWhatsapp ? 1 : 0, nextAvatar, userId]
      );
      await pool.query('DELETE FROM email_change_tokens WHERE user_id=?', [userId]);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const codeHash = await bcrypt.hash(code, 10);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await pool.query('INSERT INTO email_change_tokens (user_id, new_email, code_hash, expires_at) VALUES (?,?,?,?)', [userId, emailNorm, codeHash, expiresAt]);
      const subject = 'Confirme seu novo email';
      const html = `<p>Ola!</p><p>Use o codigo <strong>${code}</strong> para confirmar seu novo email.</p><p>O codigo expira em 30 minutos.</p>`;
      try { await notifyEmail(emailNorm, subject, html); } catch (err) { console.error('[auth/me][email]', err); }

      const [[userRow]] = await pool.query("SELECT id, nome, email, telefone, cep, endereco, numero, complemento, bairro, cidade, estado, avatar_url, tipo, notify_email_estab, notify_whatsapp_estab, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE id=? LIMIT 1", [userId]);
      if (!userRow) {
        return res.status(404).json({ error: 'not_found', message: 'Usuario nao encontrado.' });
      }

      const mergedUser = {
        ...userRow,
        nome: userRow.nome || nome,
        telefone: userRow.telefone || phoneClean,
        cep: userRow.cep || cepValue,
        endereco: userRow.endereco || enderecoValue,
        numero: userRow.numero || numeroValue,
        complemento: userRow.complemento || complementoValue,
        bairro: userRow.bairro || bairroValue,
        cidade: userRow.cidade || cidadeValue,
        estado: userRow.estado || estadoValue,
        avatar_url: userRow.avatar_url || nextAvatar || null,
        notify_email_estab: toBool(userRow.notify_email_estab ?? nextNotifyEmail),
        notify_whatsapp_estab: toBool(userRow.notify_whatsapp_estab ?? nextNotifyWhatsapp),
      };
      req.user = { ...req.user, ...mergedUser };

      return res.json({
        ok: true,
        user: mergedUser,
        emailConfirmation: { pending: true, newEmail: emailNorm, expiresAt: expiresAt.toISOString() },
      });
    }

    await pool.query(
      'UPDATE usuarios SET nome=?, email=?, telefone=?, cep=?, endereco=?, numero=?, complemento=?, bairro=?, cidade=?, estado=?, notify_email_estab=?, notify_whatsapp_estab=?, avatar_url=? WHERE id=?',
      [nome, email, phoneClean || null, cepValue, enderecoValue, numeroValue, complementoValue, bairroValue, cidadeValue, estadoValue, nextNotifyEmail ? 1 : 0, nextNotifyWhatsapp ? 1 : 0, nextAvatar, userId]
    );

    const [[userRow]] = await pool.query("SELECT id, nome, email, telefone, cep, endereco, numero, complemento, bairro, cidade, estado, avatar_url, tipo, notify_email_estab, notify_whatsapp_estab, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE id=? LIMIT 1", [userId]);
    if (!userRow) {
      return res.status(404).json({ error: 'not_found', message: 'Usuario nao encontrado.' });
    }

    const normalizedUser = {
      ...userRow,
      notify_email_estab: toBool(userRow.notify_email_estab ?? nextNotifyEmail),
      notify_whatsapp_estab: toBool(userRow.notify_whatsapp_estab ?? nextNotifyWhatsapp),
    };

    req.user = { ...req.user, ...normalizedUser };

    return res.json({ ok: true, user: normalizedUser });
  } catch (e) {
    console.error('[auth/me][PUT] erro:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});



// Recuperação de senha (envio de link com token)

router.post('/me/email-confirm', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const code = String(req.body?.code || '').trim();
    if (!/^[0-9]{6}$/.test(code)) {
      return res.status(400).json({ error: 'codigo_invalido', message: 'Informe o codigo de 6 digitos.' });
    }

    const [rows] = await pool.query('SELECT id, new_email, code_hash, expires_at FROM email_change_tokens WHERE user_id=? LIMIT 1', [userId]);
    const token = rows?.[0];
    if (!token) {
      return res.status(404).json({ error: 'codigo_expirado', message: 'Nenhum pedido de troca de email encontrado.' });
    }
    if (new Date(token.expires_at).getTime() < Date.now()) {
      await pool.query('DELETE FROM email_change_tokens WHERE id=?', [token.id]);
      return res.status(400).json({ error: 'codigo_expirado', message: 'Codigo expirado. Solicite novamente.' });
    }

    const ok = await bcrypt.compare(code, token.code_hash);
    if (!ok) {
      return res.status(400).json({ error: 'codigo_invalido', message: 'Codigo invalido.' });
    }

    const newEmail = String(token.new_email || '').trim();
    if (!newEmail) {
      await pool.query('DELETE FROM email_change_tokens WHERE id=?', [token.id]);
      return res.status(400).json({ error: 'codigo_invalido', message: 'Codigo invalido.' });
    }

    await pool.query('UPDATE usuarios SET email=? WHERE id=?', [newEmail, userId]);
    await pool.query('DELETE FROM email_change_tokens WHERE id=?', [token.id]);

    const [[userRow]] = await pool.query("SELECT id, nome, email, telefone, cep, endereco, numero, complemento, bairro, cidade, estado, avatar_url, tipo, notify_email_estab, notify_whatsapp_estab, plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id FROM usuarios WHERE id=? LIMIT 1", [userId]);
    if (!userRow) {
      return res.status(404).json({ error: 'not_found', message: 'Usuario nao encontrado.' });
    }

    const normalized = {
      ...userRow,
      notify_email_estab: toBool(userRow.notify_email_estab),
      notify_whatsapp_estab: toBool(userRow.notify_whatsapp_estab),
    };

    req.user = { ...req.user, ...normalized };

    return res.json({ ok: true, user: normalized });
  } catch (e) {
    console.error('[auth/email-confirm]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});


router.post('/forgot', async (req, res) => {
  try{
    const emailRaw = req.body?.email;
    if (!emailRaw) return res.status(400).json({ error: 'missing_email' });
    const email = String(emailRaw).trim().toLowerCase();

    // Busca usuário — mas SEM revelar se existe ou não
    let user = null;
    try{
      const [rows] = await pool.query('SELECT id, nome, email FROM usuarios WHERE LOWER(email)=? LIMIT 1', [email]);
      user = rows?.[0] || null;
    }catch{}

    // Monta link com token JWT de uso único por período curto
    const appUrl = process.env.APP_URL || 'http://localhost:3001';
    const secret = process.env.JWT_SECRET;
    let link = `${appUrl.replace(/\/$/,'')}/recuperar-senha`;
    if (user && secret) {
      const jti = crypto.randomBytes(16).toString('hex');
      const expires = new Date(Date.now() + 30 * 60 * 1000);
      // registra token para invalidação pós-uso
      try{
        await pool.query(
          'INSERT INTO password_resets (user_id, jti, expires_at) VALUES (?,?,?)',
          [user.id, jti, expires]
        );
      }catch(e){
        console.error('[auth/forgot] falha ao registrar token:', e?.message || e);
      }

      const token = jwt.sign(
        { sub: user.id, email: user.email, scope: 'pwd_reset' },
        secret,
        { expiresIn: '30m', jwtid: jti }
      );
      link = `${appUrl.replace(/\/$/,'')}/definir-senha?token=${encodeURIComponent(token)}`;
    }

    // Envia email apenas se usuário existir e SMTP estiver configurado; caso contrário, apenas loga
    if (user) {
      const subject = 'Recuperação de senha';
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.5;color:#111">
          <h2>Recuperar senha</h2>
          <p>Olá, ${user.nome?.split(' ')[0] || 'usuário'}.</p>
          <p>Para redefinir sua senha, acesse o link abaixo:</p>
          <p><a href="${link}" style="color:#5c5ccc">Redefinir senha</a></p>
          <p style="color:#555;font-size:12px">Se você não solicitou, ignore este email.</p>
        </div>`;
      try{
        await notifyEmail(email, subject, html);
      }catch(e){
        // continua silencioso
        console.error('[auth/forgot] notifyEmail falhou:', e?.message || e);
      }
    } else {
      console.log('[auth/forgot] pedido para email inexistente (não informado ao cliente)');
    }

    // Resposta neutra
    return res.json({ ok: true });
  }catch(e){
    console.error('[auth/forgot] erro:', e);
    return res.status(200).json({ ok: true }); // mantém resposta neutra
  }
});

// Redefinição de senha com token
router.post('/reset', async (req, res) => {
  try{
    const token = req.body?.token;
    const senha = req.body?.senha;
    if (!token || !senha) return res.status(400).json({ error: 'missing_fields' });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'server_config', message: 'JWT_SECRET ausente.' });

    let payload;
    try {
      payload = jwt.verify(String(token), secret);
    } catch (e) {
      return res.status(400).json({ error: 'invalid_token' });
    }

    if (payload?.scope !== 'pwd_reset' || !payload?.sub || !payload?.jti) {
      return res.status(400).json({ error: 'invalid_scope' });
    }

    const userId = Number(payload.sub);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'invalid_token' });

    // Verifica token no banco (não usado/expirado)
    try{
      const [rows] = await pool.query(
        'SELECT id, user_id, used_at, expires_at FROM password_resets WHERE jti=? LIMIT 1',
        [String(payload.jti)]
      );
      const rec = rows?.[0];
      if (!rec || rec.user_id !== userId) {
        return res.status(400).json({ error: 'invalid_token' });
      }
      if (rec.used_at) {
        return res.status(400).json({ error: 'token_used' });
      }
      if (new Date(rec.expires_at).getTime() < Date.now()) {
        return res.status(400).json({ error: 'token_expired' });
      }
    }catch(e){
      console.error('[auth/reset] falha ao validar token:', e?.message || e);
      return res.status(500).json({ error: 'server_error' });
    }

    const hash = await bcrypt.hash(String(senha), 10);
    await pool.query('UPDATE usuarios SET senha_hash=? WHERE id=?', [hash, userId]);
    // marca este token como usado e invalida quaisquer outros abertos do usuário
    try{
      await pool.query('UPDATE password_resets SET used_at=NOW() WHERE jti=?', [String(payload.jti)]);
      await pool.query('UPDATE password_resets SET used_at=NOW() WHERE user_id=? AND used_at IS NULL AND expires_at > NOW()', [userId]);
    }catch(e){
      console.error('[auth/reset] falha ao invalidar tokens:', e?.message || e);
    }

    return res.json({ ok: true });
  }catch(e){
    console.error('[auth/reset] erro:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;

// Vincular telefone via token (one-time link)
router.post('/link-phone', auth, async (req, res) => {
  try {
    const token = req.body?.token;
    if (!token) return res.status(400).json({ error: 'missing_token' });
    const rec = await consumeLinkToken(String(token));
    if (!rec) return res.status(400).json({ error: 'invalid_token' });
    const phone = String(rec.phone);
    if (!/\d{8,}/.test(phone)) return res.status(400).json({ error: 'invalid_phone' });
    await pool.query('UPDATE usuarios SET telefone=? WHERE id=?', [phone, req.user.id]);
    return res.json({ ok: true, phone });
  } catch (e) {
    console.error('[auth/link-phone] erro', e);
    return res.status(500).json({ error: 'server_error' });
  }
});
