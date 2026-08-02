import { Router } from 'express';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import { getWhatsAppConnectFeatureState, isWhatsAppConnectEnabled } from '../lib/featureFlags.js';
import {
  connectManualWhatsAppAccount,
  disconnectTenantWhatsAppAccount,
  getTenantWhatsAppAccount,
  validateManualWhatsAppAccount,
} from '../services/whatsappManualConnectService.js';
import {
  completeEmbeddedSignup,
  getEmbeddedSignupPublicConfig,
} from '../services/whatsappEmbeddedSignupService.js';
import { listTenantTemplateRows } from '../services/waTenantTemplates.js';
import { summarizeTemplateRows } from '../lib/wa_template_status.js';

const router = Router();
const FRONTEND_BASE = (process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');

function buildPanelUrl(params = {}) {
  const url = new URL(`${FRONTEND_BASE}/whatsappbusiness`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function buildAccountResponse(payload) {
  const account = payload?.account || null;
  return {
    ok: true,
    connected: Boolean(payload?.connected),
    status: payload?.status || 'not_connected',
    account,
    provider: account?.provider || null,
    display_phone_number: account?.display_phone_number || null,
    verified_name: account?.verified_name || null,
    phone_number_id: account?.phone_number_id || null,
    waba_id: account?.waba_id || null,
    business_account_id: account?.business_account_id || null,
    business_name: account?.business_name || null,
    descriptive_name: account?.descriptive_name || null,
    connected_at: account?.connected_at || null,
    disconnected_at: account?.disconnected_at || null,
    last_sync_at: account?.last_sync_at || null,
    token_last_validated_at: account?.token_last_validated_at || null,
    last_error: account?.last_error || null,
  };
}

function sendRouteError(res, err, fallbackCode, fallbackMessage) {
  const status = Number(err?.status || 500) || 500;
  const code = err?.code || fallbackCode || 'wa_manual_connect_error';
  const message = err?.message || fallbackMessage || 'Falha no fluxo manual do WhatsApp Business.';
  const body = { ok: false, error: code, message };
  if (err?.details !== undefined) {
    body.details = err.details;
  }
  return res.status(status).json(body);
}

function buildFeatureDisabledResponse() {
  return {
    ok: true,
    connected: false,
    status: 'coming_soon',
    account: null,
    ...getWhatsAppConnectFeatureState(),
  };
}

function sendFeatureDisabled(res) {
  return res.status(403).json({
    ok: false,
    error: 'wa_connect_disabled',
    ...getWhatsAppConnectFeatureState(),
  });
}

router.get('/account', auth, isEstabelecimento, async (req, res) => {
  if (!isWhatsAppConnectEnabled()) {
    return res.json(buildFeatureDisabledResponse());
  }
  try {
    const result = await getTenantWhatsAppAccount(req.user.id);
    // Status dos modelos na WABA do tenant. A aprovação é assíncrona: entre conectar e ser
    // liberado, os avisos daquele tipo saem por e-mail. Sem isto na resposta, o dono vê
    // "Conectado" e não entende por que o cliente recebeu e-mail em vez de WhatsApp.
    let templates = null;
    try {
      const rows = await listTenantTemplateRows(req.user.id);
      if (rows.length) templates = summarizeTemplateRows(rows);
    } catch (err) {
      // Tabela ausente (migração não aplicada) não pode derrubar a tela de status.
      console.warn('[wa][account][templates]', err?.message || err);
    }
    return res.json({
      ...buildAccountResponse(result),
      ...getWhatsAppConnectFeatureState(),
      templates,
    });
  } catch (err) {
    console.error('[wa][account]', err?.message || err);
    return sendRouteError(
      res,
      err,
      'wa_account_status_failed',
      'Falha ao carregar o status do WhatsApp Business.'
    );
  }
});

router.post('/manual/validate', auth, isEstabelecimento, async (req, res) => {
  if (!isWhatsAppConnectEnabled()) {
    return sendFeatureDisabled(res);
  }
  try {
    const result = await validateManualWhatsAppAccount({
      estabelecimentoId: req.user.id,
      payload: req.body && typeof req.body === 'object' ? req.body : {},
    });
    return res.json({
      ok: true,
      valid: Boolean(result?.valid),
      preview: result?.preview || null,
    });
  } catch (err) {
    console.error('[wa][manual][validate]', err?.code || err?.message || err);
    return sendRouteError(
      res,
      err,
      'wa_manual_validate_failed',
      'Não foi possível validar os dados do WhatsApp na Meta.'
    );
  }
});

router.post('/manual/connect', auth, isEstabelecimento, async (req, res) => {
  if (!isWhatsAppConnectEnabled()) {
    return sendFeatureDisabled(res);
  }
  try {
    const result = await connectManualWhatsAppAccount({
      estabelecimentoId: req.user.id,
      payload: req.body && typeof req.body === 'object' ? req.body : {},
    });
    return res.json(buildAccountResponse(result));
  } catch (err) {
    console.error('[wa][manual][connect]', err?.code || err?.message || err);
    return sendRouteError(
      res,
      err,
      'wa_manual_connect_failed',
      'Não foi possível salvar a conexão manual do WhatsApp.'
    );
  }
});

async function handleDisconnect(req, res) {
  if (!isWhatsAppConnectEnabled()) {
    return sendFeatureDisabled(res);
  }
  try {
    const result = await disconnectTenantWhatsAppAccount(req.user.id);
    return res.json(buildAccountResponse(result));
  } catch (err) {
    console.error('[wa][account][disconnect]', err?.message || err);
    return sendRouteError(
      res,
      err,
      'wa_account_disconnect_failed',
      'Falha ao desconectar o WhatsApp Business.'
    );
  }
}

router.post('/account/disconnect', auth, isEstabelecimento, handleDisconnect);
router.delete('/account/disconnect', auth, isEstabelecimento, handleDisconnect);

// Compatibilidade temporaria para consumidores antigos.
router.get('/connect/status', auth, isEstabelecimento, async (req, res) => {
  if (!isWhatsAppConnectEnabled()) {
    return res.json(buildFeatureDisabledResponse());
  }
  try {
    const result = await getTenantWhatsAppAccount(req.user.id);
    return res.json({
      ...buildAccountResponse(result),
      ...getWhatsAppConnectFeatureState(),
    });
  } catch (err) {
    console.error('[wa][connect/status]', err?.message || err);
    return res.json({ ok: true, connected: false, status: 'error', degraded: true });
  }
});

router.post('/connect/disconnect', auth, isEstabelecimento, handleDisconnect);

router.get('/connect/start', auth, isEstabelecimento, async (req, res) => {
  if (!isWhatsAppConnectEnabled()) {
    return res.json({
      ok: true,
      deprecated: true,
      url: buildPanelUrl(),
      ...getWhatsAppConnectFeatureState(),
    });
  }
  console.info('[wa][connect/start][legacy_redirect]', {
    estabelecimento_id: req.user.id,
  });
  // Rota antiga, de quando a conexão começava por redirect. Hoje o Embedded Signup roda no
  // navegador, pelo SDK (ver /embedded-signup/config), então aqui só resta levar ao painel.
  return res.json({
    ok: true,
    deprecated: true,
    url: buildPanelUrl(),
    message: 'A conexão é feita no painel do WhatsApp Business.',
  });
});

router.get('/connect/callback', async (_req, res) => {
  if (!isWhatsAppConnectEnabled()) {
    return res.redirect(302, buildPanelUrl());
  }
  return res.redirect(
    302,
    buildPanelUrl({
      wa: 'error',
      reason: 'manual_connection_required',
    })
  );
});

// ── Embedded Signup ─────────────────────────────────────────────────────────────────────────────
// Reativado em 26/07/2026. Foi aposentado em 15/03/2026 no mesmo commit que o criou, sem motivo
// registrado — a causa provável era não ter empresa verificada na Meta, o que é pré-requisito. A
// verificação saiu em 25/07/2026.
//
// A conexão manual CONTINUA existindo e não muda: é a saída para quem já tem WABA própria. O
// Embedded Signup é o caminho de um clique, para o dono de salão que não vai criar app na Meta.

/**
 * Dados públicos para o SDK do Facebook montar o FB.login no navegador.
 *
 * Sem `config_id` configurado, `getEmbeddedSignupPublicConfig` lança — e aqui isso vira 503 com
 * `available: false`, não 500. É o estado esperado enquanto a configuração de Facebook Login for
 * Business não existe: o frontend usa essa resposta para simplesmente não mostrar o botão, em vez
 * de exibir um caminho que quebra ao ser clicado.
 */
router.get('/embedded-signup/config', auth, isEstabelecimento, (_req, res) => {
  if (!isWhatsAppConnectEnabled()) {
    return sendFeatureDisabled(res);
  }
  try {
    return res.json({ ok: true, available: true, config: getEmbeddedSignupPublicConfig() });
  } catch (err) {
    console.warn('[wa][embedded-signup][config]', err?.code || err?.message || err);
    return res.status(503).json({
      ok: false,
      available: false,
      error: err?.code || 'wa_embedded_signup_not_configured',
      message: 'Conexão em um clique ainda não disponível. Use a conexão manual.',
    });
  }
});

/**
 * Troca o `code` do Embedded Signup pelo token do tenant, assina o webhook da WABA dele e guarda a
 * conta. O `session_info` vem do evento `WA_EMBEDDED_SIGNUP` que o SDK publica na janela.
 */
router.post('/embedded-signup/exchange', auth, isEstabelecimento, async (req, res) => {
  if (!isWhatsAppConnectEnabled()) {
    return sendFeatureDisabled(res);
  }
  try {
    const account = await completeEmbeddedSignup({
      estabelecimentoId: req.user.id,
      code: req.body?.code,
      sessionInfo: req.body?.session_info || req.body?.sessionInfo || null,
      // A versão vem do cliente porque é a que ele viu na tela; o IP vem de nós, porque IP
      // informado pelo próprio aceitante não prova nada.
      termsVersion: req.body?.terms_version || req.body?.termsVersion,
      termsIp: req.ip || null,
    });
    return res.json({
      ...buildAccountResponse({ account, connected: true, status: 'connected' }),
      ...getWhatsAppConnectFeatureState(),
    });
  } catch (err) {
    console.error('[wa][embedded-signup][exchange]', err?.code || err?.message || err);
    return sendRouteError(
      res,
      err,
      'wa_embedded_signup_failed',
      'Não foi possível concluir a conexão com o WhatsApp Business.'
    );
  }
});

export default router;
