// backend/src/routes/meta_callbacks.js
// Callbacks de app da Meta. São dois, e ambos são EXIGÊNCIA para app com permissões avançadas —
// a ausência deles é motivo comum de reprovação em App Review, antes mesmo de olharem o caso de uso.
//
//   POST /meta/deauthorize    — a pessoa removeu o app dela. Desligamos a conexão do WhatsApp.
//   POST /meta/data-deletion  — a pessoa pediu exclusão dos dados. Respondemos com URL + código.
//   GET  /meta/data-deletion/status/:codigo — a página que a URL acima aponta.
//
// Endpoints PÚBLICOS: não têm sessão nem token. Quem autentica é o `signed_request`, assinado com o
// app secret (ver lib/meta_signed_request.js). Sem assinatura válida, 401 — nunca um 200 educado.
import { Router } from 'express';
import crypto from 'node:crypto';
import { pool } from '../lib/db.js';
import { parseMetaSignedRequest, getSignedRequestUserId } from '../lib/meta_signed_request.js';
import { disconnectWaAccount } from '../services/waTenant.js';

const router = Router();

const APP_SECRET = () => String(process.env.WA_APP_SECRET || process.env.META_APP_SECRET || '').trim();
const PUBLIC_BASE = () => String(
  process.env.PUBLIC_API_URL || process.env.API_URL || 'https://agenda0.com.br/api'
).replace(/\/$/, '');

/** O corpo pode vir como form (application/x-www-form-urlencoded) ou JSON. A Meta usa o primeiro. */
function extractSignedRequest(req) {
  return req.body?.signed_request || req.query?.signed_request || null;
}

function verificar(req, res) {
  const parsed = parseMetaSignedRequest(extractSignedRequest(req), APP_SECRET());
  if (!parsed.ok) {
    console.warn('[meta/callback] signed_request recusado', { motivo: parsed.error });
    res.status(401).json({ ok: false, error: parsed.error });
    return null;
  }
  return parsed.data;
}

/** Acha a conta conectada por aquele usuário Meta. */
async function findAccountByMetaUser(metaUserId) {
  if (!metaUserId) return null;
  const [rows] = await pool.query(
    `SELECT id, estabelecimento_id FROM wa_accounts WHERE meta_user_id = ? LIMIT 1`,
    [metaUserId]
  );
  return rows?.[0] || null;
}

// ── Desautorização ──────────────────────────────────────────────────────────────────────────────
// A pessoa tirou o app do Facebook dela. O token que guardamos vira lixo: não avisar o nosso lado
// deixaria a conta "conectada" na tela, falhando em silêncio a cada envio.
router.post('/deauthorize', async (req, res) => {
  const data = verificar(req, res);
  if (!data) return undefined;

  const metaUserId = getSignedRequestUserId(data);
  try {
    const conta = await findAccountByMetaUser(metaUserId);
    if (!conta) {
      // Não é erro: pode ser alguém que nunca concluiu a conexão. Mas fica registrado — silêncio
      // aqui viraria "por que a conta dele continua ligada?" sem nenhum rastro.
      console.warn('[meta/deauthorize] sem conta para o usuario', { metaUserId });
      return res.json({ ok: true, matched: false });
    }
    await disconnectWaAccount(conta.estabelecimento_id, {
      clearPhoneNumber: true,
      lastError: 'deauthorized_by_user',
    });
    console.warn('[meta/deauthorize] conexao desligada', {
      metaUserId,
      estabelecimentoId: conta.estabelecimento_id,
    });
    return res.json({ ok: true, matched: true });
  } catch (err) {
    console.error('[meta/deauthorize] falha', err?.message || err);
    return res.status(500).json({ ok: false, error: 'deauthorize_failed' });
  }
});

// ── Exclusão de dados ───────────────────────────────────────────────────────────────────────────
// A Meta exige que a resposta seja exatamente { url, confirmation_code }.
router.post('/data-deletion', async (req, res) => {
  const data = verificar(req, res);
  if (!data) return undefined;

  const metaUserId = getSignedRequestUserId(data);
  const codigo = crypto.randomBytes(12).toString('hex');

  try {
    const conta = await findAccountByMetaUser(metaUserId);

    // O que apagamos aqui é o vínculo com a Meta: token, ids e a conexão. NÃO apagamos agendamento
    // nem o cadastro do estabelecimento — são dados do negócio dele conosco, com base legal própria,
    // e a exclusão da conta inteira tem outro caminho.
    if (conta) {
      await disconnectWaAccount(conta.estabelecimento_id, {
        clearPhoneNumber: true,
        lastError: 'data_deletion_requested',
      });
    }

    await pool.query(
      `INSERT INTO meta_data_deletion_requests
         (confirmation_code, meta_user_id, estabelecimento_id, status, detalhes, concluido_em)
       VALUES (?,?,?,?,?, NOW(3))`,
      [
        codigo,
        metaUserId,
        conta?.estabelecimento_id || null,
        conta ? 'completed' : 'not_found',
        conta ? 'Conexao do WhatsApp e token removidos.' : 'Nenhuma conexao encontrada para este usuario.',
      ]
    );

    return res.json({
      url: `${PUBLIC_BASE()}/meta/data-deletion/status/${codigo}`,
      confirmation_code: codigo,
    });
  } catch (err) {
    console.error('[meta/data-deletion] falha', err?.message || err);
    return res.status(500).json({ ok: false, error: 'data_deletion_failed' });
  }
});

// Página de acompanhamento. Pública e sem dado pessoal: só o estado do pedido — qualquer um que
// tenha o código veria isto, e o código não deve virar uma janela para os dados de alguém.
router.get('/data-deletion/status/:codigo', async (req, res) => {
  const codigo = String(req.params.codigo || '').trim();
  try {
    const [rows] = await pool.query(
      `SELECT confirmation_code, status, detalhes, criado_em, concluido_em
         FROM meta_data_deletion_requests WHERE confirmation_code = ? LIMIT 1`,
      [codigo]
    );
    const pedido = rows?.[0];
    if (!pedido) {
      return res.status(404).type('html').send(
        '<h1>Pedido nao encontrado</h1><p>Confira o codigo de confirmacao.</p>'
      );
    }
    const concluido = pedido.status === 'completed';
    return res.type('html').send(
      `<!doctype html><meta charset="utf-8"><title>Exclusao de dados</title>
       <h1>Pedido de exclusao de dados</h1>
       <p>Codigo: <code>${codigo}</code></p>
       <p>Status: <strong>${concluido ? 'Concluido' : pedido.status}</strong></p>
       <p>${pedido.detalhes || ''}</p>
       <p>Duvidas: <a href="mailto:contato@agenda0.com.br">contato@agenda0.com.br</a></p>`
    );
  } catch (err) {
    console.error('[meta/data-deletion/status] falha', err?.message || err);
    return res.status(500).type('html').send('<h1>Erro ao consultar o pedido</h1>');
  }
});

export default router;
