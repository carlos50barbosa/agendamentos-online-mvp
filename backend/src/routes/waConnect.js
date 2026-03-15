import { Router } from 'express';
import { auth, isEstabelecimento } from '../middleware/auth.js';
import { getWhatsAppConnectFeatureState, isWhatsAppConnectEnabled } from '../lib/featureFlags.js';
import {
  connectManualWhatsAppAccount,
  disconnectTenantWhatsAppAccount,
  getTenantWhatsAppAccount,
  validateManualWhatsAppAccount,
} from '../services/whatsappManualConnectService.js';

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
    return res.json({
      ...buildAccountResponse(result),
      ...getWhatsAppConnectFeatureState(),
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
      'Nao foi possivel validar os dados do WhatsApp na Meta.'
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
      'Nao foi possivel salvar a conexao manual do WhatsApp.'
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
  return res.json({
    ok: true,
    deprecated: true,
    url: buildPanelUrl(),
    message: 'O fluxo Embedded Signup foi aposentado. Use a conexao manual assistida no painel.',
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

router.get('/embedded-signup/config', auth, isEstabelecimento, (_req, res) => {
  if (!isWhatsAppConnectEnabled()) {
    return sendFeatureDisabled(res);
  }
  return res.status(410).json({
    ok: false,
    deprecated: true,
    error: 'wa_embedded_signup_deprecated',
    message: 'O Embedded Signup nao faz mais parte da experiencia principal. Use a conexao manual assistida.',
  });
});

router.post('/embedded-signup/exchange', auth, isEstabelecimento, (_req, res) => {
  if (!isWhatsAppConnectEnabled()) {
    return sendFeatureDisabled(res);
  }
  return res.status(410).json({
    ok: false,
    deprecated: true,
    error: 'wa_embedded_signup_deprecated',
    message: 'O Embedded Signup nao faz mais parte da experiencia principal. Use a conexao manual assistida.',
  });
});

export default router;
