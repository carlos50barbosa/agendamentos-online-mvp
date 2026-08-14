// backend/src/routes/feedback.js
//
// Coleta de feedback sobre a plataforma: motivo de cancelamento/downgrade, NPS do dono e a
// micro-pesquisa de saída da landing. Escrita apenas — a leitura é admin (routes/admin.js).
//
// O POST aceita visitante anônimo de propósito. A pergunta mais cara de responder ("por que você
// NÃO assinou?") só existe para quem ainda não tem conta; exigir login aqui seria perguntar
// exatamente a quem já respondeu com o cartão. Em troca, nada nesta rota confia no corpo da
// requisição: usuário, plano e data saem do token e do banco, nunca do JSON.
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { auth, isEstabelecimento, tryAuthenticateRequest } from '../middleware/auth.js';
import { buildRateLimitBody, buildRateLimitClientKey, consumeRateLimit, setRateLimitHeaders } from '../lib/request_rate_limit.js';
import { COMENTARIO_MAX, isNpsEligible, normalizeFeedbackSubmission, NPS_COOLDOWN_DIAS } from '../lib/product_feedback.js';
import { log } from '../lib/logger.js';

const router = Router();

// Uma pessoa responde a uma pesquisa dessas uma vez por semana, no máximo. 6 em 10 minutos deixa
// passar quem errou e reenviou, e corta o script que descobriu um endpoint público de escrita.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 6;

router.post('/', async (req, res, next) => {
  try {
    const { user } = await tryAuthenticateRequest(req);

    // Chaveado por usuário quando logado: senão um escritório inteiro atrás do mesmo IP gastaria
    // a cota de um único respondente.
    const clientKey = user?.id ? `user:${user.id}` : buildRateLimitClientKey(req);
    const limit = await consumeRateLimit({
      bucketKey: `product-feedback:${clientKey}`,
      windowMs: RATE_WINDOW_MS,
      max: RATE_MAX,
    });
    setRateLimitHeaders(res, limit);
    if (limit.limited) {
      return res.status(429).json(buildRateLimitBody(limit, { request_id: req.requestId || null }));
    }

    const parsed = normalizeFeedbackSubmission(req.body || {});
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }

    const { tipo, motivo, nota, comentario, contexto } = parsed.value;

    const [result] = await pool.query(
      'INSERT INTO product_feedback (tipo, motivo, nota, comentario, usuario_id, plano, contexto) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [tipo, motivo, nota, comentario, user?.id || null, user?.plan || null, contexto]
    );

    // Registrado no log também porque este dado é raro e caro: se a tabela for perdida num
    // restore malfeito, o motivo de cancelamento ainda estará no log daquele dia.
    log.info('[feedback] resposta registrada', { tipo, motivo, nota, usuario_id: user?.id || null });

    // O id volta para quem responde em dois tempos (o NPS: nota agora, comentário depois) poder
    // completar a MESMA linha em vez de criar outra.
    return res.status(201).json({ ok: true, id: result?.insertId || null });
  } catch (err) {
    return next(err);
  }
});

// Anexa o comentário a uma resposta já gravada.
//
// Existe por causa do NPS de dois tempos: a nota é enviada no clique (para não se perder se a
// pessoa fechar a caixa) e o comentário vem depois. Gravar o comentário como uma SEGUNDA linha
// contaria o mesmo respondente duas vezes no cálculo do NPS — e a métrica passaria a premiar quem
// escreve, não quem está satisfeito.
//
// Só completa o que está vazio (`comentario IS NULL`) e só na própria linha (`usuario_id`): assim
// esta rota nunca vira um jeito de reescrever a resposta de ontem, nem a de outra pessoa.
router.patch('/:id/comentario', auth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id_invalido' });

    const comentario = String(req.body?.comentario ?? '').trim().slice(0, COMENTARIO_MAX);
    if (!comentario) return res.status(400).json({ error: 'comentario_obrigatorio' });

    const [result] = await pool.query(
      'UPDATE product_feedback SET comentario=? WHERE id=? AND usuario_id=? AND comentario IS NULL',
      [comentario, id, req.user.id]
    );

    if (!result?.affectedRows) return res.status(404).json({ error: 'feedback_nao_encontrado' });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// O frontend não decide sozinho quando perguntar: a elegibilidade depende de dados que só o
// servidor tem (idade da conta, volume de agendamentos, se já respondeu). Deixar isso no
// navegador significaria perguntar de novo a cada troca de máquina — ou a cada limpeza de cache.
router.get('/nps/elegivel', auth, isEstabelecimento, async (req, res, next) => {
  try {
    const estabelecimentoId = req.user.id;

    const [[conta]] = await pool.query('SELECT criado_em FROM usuarios WHERE id=? LIMIT 1', [estabelecimentoId]);
    const [[volume]] = await pool.query(
      "SELECT COUNT(*) AS total FROM agendamentos WHERE estabelecimento_id=? AND status IN ('confirmado','concluido')",
      [estabelecimentoId]
    );
    const [[ultima]] = await pool.query(
      "SELECT created_at FROM product_feedback WHERE usuario_id=? AND tipo='nps' ORDER BY created_at DESC LIMIT 1",
      [estabelecimentoId]
    );

    const result = isNpsEligible({
      contaCriadaEm: conta?.criado_em || null,
      agendamentos: Number(volume?.total || 0),
      ultimaRespostaEm: ultima?.created_at || null,
    });

    // Cooldown vai junto para o frontend poder silenciar a caixa localmente e nem refazer esta
    // chamada durante o período — a resposta é a mesma por 90 dias.
    return res.json({ elegivel: result.eligible, motivo: result.reason, cooldown_dias: NPS_COOLDOWN_DIAS });
  } catch (err) {
    return next(err);
  }
});

export default router;
