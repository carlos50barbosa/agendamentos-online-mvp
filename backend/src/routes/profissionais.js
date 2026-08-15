import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import {
} from '../lib/plans.js';
import { saveAvatarFromDataUrl, removeAvatarFile } from '../lib/avatar.js';
import { ensureSubscriptionOperationalAccess, ensureWithinProfessionalLimit } from '../middleware/billing.js';
import { montarUpdateComHorarios, parseHorariosProfissional } from '../lib/horarios_profissional.js';

const router = Router();

// Distingue os TRÊS estados de `horarios` no corpo, e a distinção precisa ser por
// hasOwnProperty: o idioma usado no resto do arquivo (`x != null ? x : atual`) colapsa "campo
// ausente" e "campo null" no mesmo ramo, e aí não existe jeito de pedir "limpe o horário
// próprio e volte a herdar do salão".
const lerHorariosDoCorpo = (body) =>
  Object.prototype.hasOwnProperty.call(body || {}, 'horarios')
    ? parseHorariosProfissional(body.horarios)
    : { mode: 'skip', json: null };

// Erro de validação de horário sai como 400 com código, na convenção de routes/onboarding.js.
const respostaDeErro = (res, err, contexto, fallback) => {
  if (err?.status === 400) {
    return res.status(400).json({ error: err.code, message: err.message });
  }
  console.error(contexto, err);
  return res.status(500).json({ error: fallback });
};

function toBoolean(value) {
  if (value === true || value === false) return value;
  const lower = String(value || '').trim().toLowerCase();
  if (!lower) return false;
  return ['1', 'true', 'yes', 'on'].includes(lower);
}

router.get('/', async (req, res, next) => {
  const estabId =
    req.query.establishmentId ||
    req.query.estabelecimento_id ||
    req.query.establishment_id ||
    null;

  if (!estabId) return next();

  try {
    const [rows] = await pool.query(
      `SELECT id, estabelecimento_id, nome, descricao, avatar_url, ativo
       FROM profissionais
       WHERE estabelecimento_id=? AND (ativo IS NULL OR ativo=1)
       ORDER BY nome`,
      [estabId]
    );
    res.json(rows || []);
  } catch (err) {
    console.error('[profissionais][public] list', err);
    res.status(500).json({ error: 'list_profissionais_failed' });
  }
});

router.get('/', auth, isEstabelecimento, async (req, res) => {
  try {
    const estId = req.user.id;
    // `horarios_json` só aparece AQUI, na listagem autenticada. O GET público acima serve a
    // página de agendamento e não pode publicar a escala individual da equipe — a grade que o
    // cliente vê já vem do /slots, calculada.
    const [rows] = await pool.query(
      `SELECT id, estabelecimento_id, nome, descricao, avatar_url, ativo, horarios_json, created_at
       FROM profissionais
       WHERE estabelecimento_id=?
       ORDER BY nome`,
      [estId]
    );
    res.json(rows || []);
  } catch (err) {
    console.error('[profissionais][mine] list', err);
    res.status(500).json({ error: 'list_profissionais_failed' });
  }
});

router.post(
  '/',
  auth,
  isEstabelecimento,
  ensureSubscriptionOperationalAccess({
    message: 'Regularize a assinatura para cadastrar profissionais.',
  }),
  ensureWithinProfessionalLimit({
    isActivating: (req) => toBoolean(req.body?.ativo ?? true) === true,
  }),
  async (req, res) => {
  try {
    const estId = req.user.id;
    let { nome, descricao, avatar, ativo = true } = req.body || {};
    nome = String(nome || '').trim();
    descricao = descricao == null ? null : String(descricao).trim();
    const isActive = toBoolean(ativo);

    if (!nome) {
      return res.status(400).json({ error: 'nome_obrigatorio', message: 'Informe o nome do profissional.' });
    }

    // Na criação não existe "não mexer": `skip` e `clear` gravam NULL do mesmo jeito, e NULL
    // aqui é o estado correto — profissional nova herda o horário do salão até alguém dizer
    // o contrário. Valida ANTES de salvar avatar e de inserir, para um horário recusado não
    // deixar arquivo órfão no disco.
    const horarios = lerHorariosDoCorpo(req.body);

    let avatarUrl = null;
    if (avatar) {
      try {
        avatarUrl = await saveAvatarFromDataUrl(avatar, estId, null);
      } catch (err) {
        if (err?.code === 'AVATAR_TOO_LARGE') {
          return res.status(400).json({ error: 'avatar_grande', message: 'A imagem deve ter no máximo 2MB.' });
        }
        if (err?.code === 'AVATAR_INVALID') {
          return res.status(400).json({ error: 'avatar_invalido', message: 'Envie uma imagem PNG, JPG ou WEBP.' });
        }
        console.error('[profissionais][create] avatar', err);
        return res.status(500).json({ error: 'avatar_falhou', message: 'Não foi possível salvar a foto.' });
      }
    }

    const [insert] = await pool.query(
      'INSERT INTO profissionais (estabelecimento_id, nome, descricao, avatar_url, ativo, horarios_json) VALUES (?,?,?,?,?,?)',
      [estId, nome, descricao || null, avatarUrl, isActive ? 1 : 0, horarios.json]
    );

    const [[row]] = await pool.query(
      'SELECT id, estabelecimento_id, nome, descricao, avatar_url, ativo, horarios_json, created_at FROM profissionais WHERE id=?',
      [insert.insertId]
    );
    return res.json(row);
  } catch (err) {
    return respostaDeErro(res, err, '[profissionais][create]', 'create_profissional_failed');
  }
  }
);

async function loadProfessional(req, res, next) {
  try {
    const estId = req.user.id;
    const { id } = req.params;

    const [[row]] = await pool.query(
      'SELECT id, nome, descricao, avatar_url, ativo, horarios_json FROM profissionais WHERE id=? AND estabelecimento_id=?',
      [id, estId]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });

    req.professional = row;
    return next();
  } catch (err) {
    console.error('[profissionais][load]', err);
    return res.status(500).json({ error: 'load_profissional_failed' });
  }
}

router.put(
  '/:id',
  auth,
  isEstabelecimento,
  loadProfessional,
  ensureSubscriptionOperationalAccess({
    message: 'Regularize a assinatura para editar profissionais.',
  }),
  ensureWithinProfessionalLimit({
    isActivating: (req) => {
      const currentActive = toBoolean(req.professional?.ativo);
      const nextActive = req.body?.ativo == null ? currentActive : toBoolean(req.body.ativo);
      return currentActive === false && nextActive === true;
    },
  }),
  async (req, res) => {
  try {
    const estId = req.user.id;
    const { id } = req.params;
    let { nome, descricao, avatar, avatarRemove, ativo } = req.body || {};

    // Validado ANTES de mexer em avatar: horário recusado não pode deixar arquivo órfão no
    // disco nem apagar a foto de quem só errou o formato do horário.
    const horarios = lerHorariosDoCorpo(req.body);

    const row = req.professional;
    const nextNome = nome != null ? String(nome).trim() : row.nome;
    const nextDescricao = descricao != null ? String(descricao).trim() : row.descricao;
    const wantsRemove = avatarRemove === true || avatarRemove === 'true';
    const hasAvatarData = typeof avatar === 'string' && avatar.startsWith('data:');

    let nextAvatar = row.avatar_url;
    if (wantsRemove && nextAvatar) {
      try { await removeAvatarFile(nextAvatar); } catch (err) { if (err?.code !== 'ENOENT') console.warn('[profissionais][avatar remove]', err?.message || err); }
      nextAvatar = null;
    }
    if (hasAvatarData) {
      try {
        nextAvatar = await saveAvatarFromDataUrl(avatar, estId, wantsRemove ? null : row.avatar_url);
      } catch (err) {
        if (err?.code === 'AVATAR_TOO_LARGE') {
          return res.status(400).json({ error: 'avatar_grande', message: 'A imagem deve ter no máximo 2MB.' });
        }
        if (err?.code === 'AVATAR_INVALID') {
          return res.status(400).json({ error: 'avatar_invalido', message: 'Envie uma imagem PNG, JPG ou WEBP.' });
        }
        console.error('[profissionais][update] avatar', err);
        return res.status(500).json({ error: 'avatar_falhou', message: 'Não foi possível salvar a foto.' });
      }
    }

    const nextAtivo = ativo == null ? row.ativo : (toBoolean(ativo) ? 1 : 0);

    // A coluna só entra no SET quando o corpo pediu — ver o docblock de montarUpdateComHorarios
    // para o motivo, que é `undefined` virando NULL em silêncio no bind.
    const { campos, valores } = montarUpdateComHorarios(
      ['nome=?', 'descricao=?', 'avatar_url=?', 'ativo=?'],
      [nextNome, nextDescricao || null, nextAvatar, nextAtivo],
      horarios
    );

    await pool.query(
      `UPDATE profissionais SET ${campos.join(', ')} WHERE id=? AND estabelecimento_id=?`,
      [...valores, id, estId]
    );

    const [[updated]] = await pool.query(
      'SELECT id, estabelecimento_id, nome, descricao, avatar_url, ativo, horarios_json, created_at FROM profissionais WHERE id=?',
      [id]
    );
    res.json(updated);
  } catch (err) {
    respostaDeErro(res, err, '[profissionais][update]', 'update_profissional_failed');
  }
  }
);

router.delete('/:id', auth, isEstabelecimento, ensureSubscriptionOperationalAccess({
  message: 'Regularize a assinatura para excluir profissionais.',
}), async (req, res) => {
  try {
    const estId = req.user.id;
    const { id } = req.params;
    const [[row]] = await pool.query(
      'SELECT id, avatar_url FROM profissionais WHERE id=? AND estabelecimento_id=?',
      [id, estId]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });

    await pool.query('DELETE FROM servico_profissionais WHERE profissional_id=?', [id]);
    await pool.query('DELETE FROM profissionais WHERE id=? AND estabelecimento_id=?', [id, estId]);
    if (row.avatar_url) {
      await removeAvatarFile(row.avatar_url).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[profissionais][delete]', err);
    res.status(500).json({ error: 'delete_profissional_failed' });
  }
});

export default router;
