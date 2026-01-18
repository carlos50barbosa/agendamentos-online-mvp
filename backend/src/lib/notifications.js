// backend/src/lib/notifications.js
import nodemailer from 'nodemailer';
import { getWhatsAppLastInboundAt, isWhatsAppWindowOpen } from './whatsapp_contacts.js';
import { decryptAccessToken } from '../services/waCrypto.js';
import { extractWamid, sendWhatsAppMessage } from '../services/waGraph.js';
import { buildConfirmacaoAgendamentoV2Components, isConfirmacaoAgendamentoV2 } from './whatsapp_templates.js';
import { getWaAccountByEstabelecimentoId, recordWaMessage } from '../services/waTenant.js';

/**
 * Configuração (via ENV)
 *
 * WA_PHONE_NUMBER_ID=...             // fallback/dev
 * WA_TOKEN=...                       // fallback/dev (legado)
 * WA_DEFAULT_TOKEN=...               // fallback/dev (opcional)
 * WA_API_VERSION=v23.0
 * WA_FORCE_TEMPLATE=true|false
 * WA_TEMPLATE_NAME=hello_world
 * WA_TEMPLATE_LANG=en_US
 * WA_TEMPLATE_HAS_BODY_PARAM=0|1          // 1 se seu template tiver {{1}} no corpo
 * WHATSAPP_ALLOWED_LIST=551199...,551198...  // dígitos; aceitamos com + também
 * WA_DEBUG_LOG=true|false
 *
 * SMTP_HOST=...
 * SMTP_PORT=587
 * SMTP_SECURE=false
 * SMTP_USER=...
 * SMTP_PASS=...
 * EMAIL_FROM="Agendamentos Online" <no-reply@seu-dominio>
 */

const parseBool = (value) => /^(1|true|yes|on)$/i.test(String(value || '').trim());

const cfg = {
  defaultPhoneId: process.env.WA_PHONE_NUMBER_ID,
  defaultToken: process.env.WA_DEFAULT_TOKEN || process.env.WA_TOKEN,
  apiVersion: process.env.WA_API_VERSION || 'v23.0',

  forceTemplate: parseBool(process.env.WA_FORCE_TEMPLATE),
  templateName: process.env.WA_TEMPLATE_NAME || 'hello_world',
  templateLang: process.env.WA_TEMPLATE_LANG || 'en_US',
  templateHasBodyParam: parseBool(process.env.WA_TEMPLATE_HAS_BODY_PARAM),

  allowedList: String(process.env.WHATSAPP_ALLOWED_LIST || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(normalizePhoneDigits)
    .filter(Boolean),

  debug: parseBool(process.env.WA_DEBUG_LOG),
};

const toDigits = s => String(s || '').replace(/\D/g, '');

function normalizePhoneDigits(value) {
  let digits = toDigits(value);
  if (!digits) return '';
  digits = digits.replace(/^0+/, '');
  if (digits.startsWith('55')) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

function isAllowed(to) {
  const n = normalizePhoneDigits(to);
  if (!n) return false;
  if (!cfg.allowedList.length) return true;
  return cfg.allowedList.includes(n);
}

function maskPhone(phone) {
  const digits = toDigits(phone);
  if (!digits) return '';
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const type = payload.type || 'unknown';
  if (type === 'template') {
    const template = payload.template || {};
    const components = Array.isArray(template.components) ? template.components : [];
    const templateSummary = {
      name: template.name,
      lang: template.language?.code,
    };
    if (components.length) {
      templateSummary.components = components.map((comp) => ({
        type: comp?.type,
        params: Array.isArray(comp?.parameters) ? comp.parameters.length : 0,
      }));
    }
    return {
      type,
      template: templateSummary,
    };
  }
  if (type === 'text') {
    const body = payload.text?.body || '';
    return {
      type,
      text: {
        length: String(body).length,
        preview: Boolean(payload.text?.preview_url),
      },
    };
  }
  if (type === 'interactive') {
    return { type, interactive: { hasBody: Boolean(payload.interactive?.body) } };
  }
  return { type };
}

function logSend({ phone, payload, context }) {
  const summary = summarizePayload(payload);
  const base = {
    type: summary?.type || payload?.type || 'unknown',
    to: maskPhone(phone),
    payload: summary,
  };
  if (context) base.context = context;
  console.log('[wa/send]', JSON.stringify(base));
}

function logSendResult({ phone, payloadType, wamid, context }) {
  const base = { type: payloadType || 'unknown', to: maskPhone(phone), wamid: wamid || null };
  if (context) base.context = context;
  console.log('[wa/send/ok]', JSON.stringify(base));
}

function is24hWindowError(err) {
  const msg = (err?.body && typeof err.body === 'object')
    ? (err.body.error?.message || '')
    : String(err?.body || err?.message || '');
  const code = err?.body?.error?.code;
  const sub = err?.body?.error?.error_subcode;
  return code === 470 || sub === 2018028 || sub === 131047 || /24\s*h/i.test(msg) || err?.status === 400;
}

function buildTemplateParamError({ name, expected, provided }) {
  const err = new Error(`WA template ${name} requires ${expected} params, provided ${provided}`);
  err.code = 'wa_template_params_missing';
  err.status = 400;
  err.body = {
    error: {
      message: 'template_params_missing',
      code: 'wa_template_params_missing',
      error_data: { template: name, expected, provided },
    },
  };
  return err;
}

function normalizeTemplateBodyParams({ name, bodyParams, phone, context }) {
  const rawParams = Array.isArray(bodyParams) ? bodyParams : [];
  if (isConfirmacaoAgendamentoV2(name)) {
    if (rawParams.length !== 3) {
      const base = {
        template: name,
        expected: 3,
        provided: rawParams.length,
        to: maskPhone(phone),
      };
      if (context) base.context = context;
      console.warn('[wa/template] missing params, skip send', base);
      throw buildTemplateParamError({ name, expected: 3, provided: rawParams.length });
    }
    return buildConfirmacaoAgendamentoV2Components({
      serviceLabel: rawParams[0],
      dataHoraLabel: rawParams[1],
      estabelecimentoNome: rawParams[2],
    });
  }
  if (cfg.templateHasBodyParam && rawParams.length === 0) {
    const base = {
      template: name,
      expected: 1,
      provided: 0,
      to: maskPhone(phone),
    };
    if (context) base.context = context;
    console.warn('[wa/template] missing params, skip send', base);
    throw buildTemplateParamError({ name, expected: 1, provided: 0 });
  }
  return rawParams;
}

function buildTemplateComponents(params) {
  if (!Array.isArray(params) || params.length === 0) return null;
  return [{
    type: 'body',
    parameters: params.map((value) => ({ type: 'text', text: String(value) })),
  }];
}

function countBodyParams(components) {
  if (!Array.isArray(components)) return 0;
  return components
    .filter((comp) => comp?.type === 'body')
    .reduce((sum, comp) => sum + (Array.isArray(comp?.parameters) ? comp.parameters.length : 0), 0);
}

async function resolveTenantConfig(context = {}) {
  const estabelecimentoId = Number(context?.estabelecimentoId || 0) || null;
  if (estabelecimentoId) {
    try {
      const account = await getWaAccountByEstabelecimentoId(estabelecimentoId);
      if (
        account &&
        account.status === 'connected' &&
        account.phone_number_id &&
        account.access_token_enc
      ) {
        const token = decryptAccessToken(account.access_token_enc);
        if (token) {
          return {
            token,
            phoneId: account.phone_number_id,
            estabelecimentoId: account.estabelecimento_id,
            fallback: false,
          };
        }
      }
    } catch (err) {
      console.warn('[wa][tenant] resolve failed', err?.message || err);
    }
  }

  if (cfg.defaultToken && cfg.defaultPhoneId) {
    return {
      token: cfg.defaultToken,
      phoneId: cfg.defaultPhoneId,
      estabelecimentoId,
      fallback: true,
    };
  }

  return { token: null, phoneId: null, estabelecimentoId, fallback: false };
}

async function recordOutboundMessage({ tenant, phone, payload, resp }) {
  if (!tenant?.estabelecimentoId) return;
  try {
    await recordWaMessage({
      estabelecimentoId: tenant.estabelecimentoId,
      direction: 'out',
      waId: phone,
      wamid: extractWamid(resp),
      phoneNumberId: tenant.phoneId,
      payload,
      status: 'sent',
    });
  } catch (err) {
    console.warn('[wa][outbound] record failed', err?.message || err);
  }
}

async function sendText({ to, message, context, tenant }) {
  const phone = normalizePhoneDigits(to);
  if (!phone) {
    if (cfg.debug) console.warn('[whatsapp] invalid phone -> %s', to);
    return { invalid: true };
  }
  if (!isAllowed(phone)) {
    if (cfg.debug) console.warn('[whatsapp] bloqueado por ALLOWED_LIST -> %s', phone);
    return { blocked: true };
  }
  const resolved = tenant || await resolveTenantConfig(context);
  if (!resolved.token || !resolved.phoneId) {
    const err = new Error('WA config missing (token/phoneId)');
    err.code = 'wa_not_connected';
    throw err;
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'text',
    text: { preview_url: false, body: String(message || '') },
  };
  logSend({ phone, payload, context });
  const resp = await sendWhatsAppMessage({
    accessToken: resolved.token,
    phoneNumberId: resolved.phoneId,
    payload,
  });
  logSendResult({ phone, payloadType: payload.type, wamid: extractWamid(resp), context });
  await recordOutboundMessage({ tenant: resolved, phone, payload, resp });
  return resp;
}

// ============== WhatsApp: Template ==============
export async function sendTemplate({
  to,
  name,
  lang,
  components,
  bodyParams = [],
  headerImageUrl,
  headerDocumentUrl,
  headerVideoUrl,
  headerText,
  context,
  estabelecimentoId,
  tenant,
}) {
  const phone = normalizePhoneDigits(to);
  if (!phone) {
    if (cfg.debug) console.warn('[whatsapp] invalid phone -> %s', to);
    return { invalid: true };
  }
  if (!isAllowed(phone)) {
    if (cfg.debug) console.warn('[whatsapp] bloqueado por ALLOWED_LIST -> %s', phone);
    return { blocked: true };
  }
  const resolved = tenant || await resolveTenantConfig(context || { estabelecimentoId });
  if (!resolved.token || !resolved.phoneId) {
    const err = new Error('WA config missing (token/phoneId)');
    err.code = 'wa_not_connected';
    throw err;
  }

  const template = {
    name: name || cfg.templateName,
    language: { code: lang || cfg.templateLang },
  };
  const componentsOverride = Array.isArray(components) && components.length > 0 ? components : null;
  let bodyParamsNormalized = [];
  const componentsList = [];
  if (!componentsOverride) {
    bodyParamsNormalized = normalizeTemplateBodyParams({
      name: template.name,
      bodyParams,
      phone,
      context,
    });
  }

  const nameLower = String(name || cfg.templateName || '').toLowerCase();

  // Herdar header de imagem do .env quando nao for enviado via argumento
  let headerImage = headerImageUrl || null;
  if (!headerImage && /lembrete_agendamento_v2/.test(nameLower) && process.env.WA_TEMPLATE_REMINDER_HEADER_URL) {
    headerImage = process.env.WA_TEMPLATE_REMINDER_HEADER_URL;
  }
  if (!headerImage && process.env.WA_TEMPLATE_HEADER_IMAGE_URL) {
    headerImage = process.env.WA_TEMPLATE_HEADER_IMAGE_URL;
  }
  if (!headerImage && process.env.WA_TEMPLATE_HEADER_URL) {
    headerImage = process.env.WA_TEMPLATE_HEADER_URL;
  }

  if (componentsOverride) {
    componentsList.push(...componentsOverride);
  } else {
    // Header opcional (necessario se o template tiver header de imagem/documento/video/texto)
    if (headerImage) {
      componentsList.push({
        type: 'header',
        parameters: [{ type: 'image', image: { link: headerImage } }],
      });
    } else if (headerDocumentUrl) {
      componentsList.push({
        type: 'header',
        parameters: [{ type: 'document', document: { link: headerDocumentUrl } }],
      });
    } else if (headerVideoUrl) {
      componentsList.push({
        type: 'header',
        parameters: [{ type: 'video', video: { link: headerVideoUrl } }],
      });
    } else if (headerText) {
      componentsList.push({
        type: 'header',
        parameters: [{ type: 'text', text: String(headerText) }],
      });
    }

    // IMPORTANTE: so inclua components se houver params (evita erro 132000)
    if (Array.isArray(bodyParamsNormalized) && bodyParamsNormalized.length > 0) {
      componentsList.push({
        type: 'body',
        parameters: bodyParamsNormalized.map(t => ({ type: 'text', text: String(t) })),
      });
    }
  }

  if (componentsList.length) template.components = componentsList;

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template,
  };

  const paramsCount = componentsOverride
    ? countBodyParams(componentsList)
    : bodyParamsNormalized.length;
  if (cfg.debug) {
    console.log('[wa/cloud/template] to=%s name=%s lang=%s params=%d',
      phone, template.name, template.language?.code, paramsCount);
  }
  logSend({ phone, payload, context });
  const resp = await sendWhatsAppMessage({
    accessToken: resolved.token,
    phoneNumberId: resolved.phoneId,
    payload,
  });
  logSendResult({ phone, payloadType: payload.type, wamid: extractWamid(resp), context });
  await recordOutboundMessage({ tenant: resolved, phone, payload, resp });
  return resp;
}
// ============== WhatsApp: Texto (ou Template se forceTemplate=true) ==============
export async function notifyWhatsapp(message, to, options = {}) {
  const context = options?.context || (options?.estabelecimentoId ? { estabelecimentoId: options.estabelecimentoId } : undefined);
  return sendWhatsAppSmart({ to, message, context });
}

export async function sendWhatsAppSmart({
  to,
  message,
  text,
  template,
  templateName,
  templateParams,
  templateNameFallback,
  templateLangFallback,
  allowText = true,
  forceTemplate,
  context,
  estabelecimentoId,
  returnMeta = false,
} = {}) {
  const messageText = message != null ? String(message) : (text != null ? String(text) : '');
  const templateDisabled = template === null || template === false;
  const shouldForceTemplate = forceTemplate === true || cfg.forceTemplate;
  const phone = normalizePhoneDigits(to);
  if (!phone) {
    if (cfg.debug) console.warn('[whatsapp] invalid phone -> %s', to);
    if (!returnMeta) return { invalid: true };
    return {
      result: { invalid: true },
      meta: {
        decision: null,
        window_open: false,
        force_template: shouldForceTemplate,
        wamid: null,
      },
    };
  }
  const ctx = estabelecimentoId ? { ...(context || {}), estabelecimentoId } : (context || {});
  const tenant = await resolveTenantConfig(ctx);
  const lastInbound = await getWhatsAppLastInboundAt(phone);
  const windowOpen = isWhatsAppWindowOpen(lastInbound, new Date());

  const fallbackName = templateNameFallback || cfg.templateName;
  const fallbackLang = templateLangFallback || cfg.templateLang;
  const templatePayload = template && template.name
    ? template
    : (templateDisabled ? null : {
        name: fallbackName,
        lang: fallbackLang,
        bodyParams: cfg.templateHasBodyParam && messageText ? [messageText] : [],
      });
  const overrideName = templateName || 'confirmacao_agendamento_v2';
  const overrideParams = Array.isArray(templateParams) ? templateParams : null;
  const hasOverride = Boolean(templateName || overrideParams);
  const overrideMissing = hasOverride
    && isConfirmacaoAgendamentoV2(overrideName)
    && !(Array.isArray(overrideParams)
      && overrideParams.length === 3
      && overrideParams.every((value) => String(value || '').trim()));
  const canUseOverride = hasOverride && !overrideMissing;

  let decision = null;
  const finalize = (result) => {
    if (!returnMeta) return result;
    return {
      result,
      meta: {
        decision,
        window_open: windowOpen,
        force_template: shouldForceTemplate,
        wamid: extractWamid(result),
      },
    };
  };
  const overrideComponents = canUseOverride ? buildTemplateComponents(overrideParams) : null;
  const sendTemplateSafely = async (payload) => {
    try {
      return await sendTemplate(payload);
    } catch (err) {
      const code = err?.code || err?.body?.error?.code;
      if (code === 'wa_template_params_missing') {
        return { ok: false, error: 'template_params_missing' };
      }
      throw err;
    }
  };
  const sendTemplateWithOverrides = async () => {
    if (overrideMissing) {
      const base = {
        template: overrideName,
        expected: 3,
        provided: Array.isArray(overrideParams) ? overrideParams.length : 0,
        to: maskPhone(phone),
      };
      if (ctx) base.context = ctx;
      console.warn('[wa/template] missing params, skip send', base);
      return { ok: false, error: 'template_params_missing' };
    }
    if (canUseOverride) {
      return sendTemplateSafely({
        to: phone,
        name: overrideName,
        lang: 'pt_BR',
        components: overrideComponents,
        context: ctx,
        tenant,
      });
    }
    if (!templatePayload) {
      const base = { to: maskPhone(phone) };
      if (ctx) base.context = ctx;
      console.warn('[wa/template] template disabled, skip send', base);
      return { ok: false, error: 'template_missing' };
    }
    return sendTemplateSafely({
      to: phone,
      name: templatePayload.name,
      lang: templatePayload.lang,
      bodyParams: templatePayload.bodyParams || [],
      headerImageUrl: templatePayload.headerImageUrl,
      headerDocumentUrl: templatePayload.headerDocumentUrl,
      headerVideoUrl: templatePayload.headerVideoUrl,
      headerText: templatePayload.headerText,
      context: ctx,
      tenant,
    });
  };

  if (shouldForceTemplate || !windowOpen) {
    if (cfg.debug) {
      console.log('[wa/cloud] smart-send template only (window closed or forced)');
    }
    decision = 'template';
    const result = await sendTemplateWithOverrides();
    return finalize(result);
  }

  if (allowText && messageText) {
    try {
      decision = 'text';
      const result = await sendText({ to: phone, message: messageText, context: ctx, tenant });
      return finalize(result);
    } catch (err) {
      if (is24hWindowError(err)) {
        if (cfg.debug) console.log('[wa/cloud] text failed, fallback to template');
        decision = 'template';
        const result = await sendTemplateWithOverrides();
        return finalize(result);
      }
      throw err;
    }
  }

  if (template && template.name) {
    decision = 'template';
    const result = await sendTemplateWithOverrides();
    return finalize(result);
  }

  if (message != null || text != null) {
    decision = 'text';
    const result = await sendText({ to: phone, message: messageText, context: ctx, tenant });
    return finalize(result);
  }

  decision = 'text';
  return finalize({ ok: false, error: 'missing_message' });
}

// ============== WhatsApp: Agendamento simples em memória ==============
const timers = new Set();

export async function scheduleWhatsApp({
  to,
  scheduledAt,
  message,
  metadata,
  useTemplate,
  bodyParams,
  templateName,
  templateLang,
  estabelecimentoId,
} = {}) {
  const when = new Date(scheduledAt);
  if (Number.isNaN(+when)) throw new Error('scheduledAt inválido');

  const ms = +when - Date.now();
  const phone = normalizePhoneDigits(to);

  if (!phone) {
    if (cfg.debug) console.warn('[whatsapp] invalid phone (schedule) -> %s', to);
    return { invalid: true };
  }
  if (!isAllowed(phone)) {
    if (cfg.debug) console.warn('[whatsapp] bloqueado por ALLOWED_LIST -> %s (schedule)', phone);
    return { blocked: true };
  }

  const sendFn = async () => {
    try {
      if (cfg.forceTemplate || useTemplate) {
        const params = Array.isArray(bodyParams) && bodyParams.length > 0
          ? bodyParams
          : (cfg.templateHasBodyParam ? [message] : []);
        await sendTemplate({
          to: phone,
          name: templateName || cfg.templateName,
          lang: templateLang || cfg.templateLang,
          bodyParams: params,
          estabelecimentoId,
        });
      } else {
        const params = Array.isArray(bodyParams) && bodyParams.length > 0
          ? bodyParams
          : (cfg.templateHasBodyParam ? [message] : []);
        await sendWhatsAppSmart({
          to: phone,
          message,
          template: {
            name: templateName || cfg.templateName,
            lang: templateLang || cfg.templateLang,
            bodyParams: params,
          },
          estabelecimentoId,
        });
      }
    } catch (err) {
      console.error('[scheduleWhatsApp/send]', err.status, err.body || err.message);
    }
  };

  if (ms <= 0) {
    await sendFn();
    return { sent: true, immediate: true };
  }

  const t = setTimeout(async () => {
    timers.delete(t);
    await sendFn();
  }, ms);
  timers.add(t);

  if (cfg.debug) {
    console.log('[scheduleWhatsApp] to=%s at=%s (%d ms) meta=%s',
      phone, when.toISOString(), ms, metadata ? JSON.stringify(metadata) : '-');
  }
  return { scheduled: true, at: when.toISOString() };
}

// ============== Email (Nodemailer) ==============
const smtp = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: /^true$/i.test(process.env.SMTP_SECURE || ''),
  auth: (process.env.SMTP_USER && process.env.SMTP_PASS)
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
};

let transporter;
if (smtp.host && smtp.auth?.user) {
  transporter = nodemailer.createTransport(smtp);
} else {
  // Fallback: não envia de verdade, apenas “log”
  transporter = nodemailer.createTransport({
    streamTransport: true,
    newline: 'unix',
    buffer: true,
  });
  if (cfg.debug) console.warn('[email] SMTP não configurado — usando streamTransport (apenas log).');
}


export async function notifyEmail(to, subject, html) {
  if (!to) return { ok: false, error: 'missing_to' };
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `"Agendamentos Online" <${process.env.SMTP_USER || 'no-reply@localhost'}>`,
      to,
      subject,
      html,
    });
    if (cfg.debug) console.log('✅ Email enviado para %s (%s)', to, subject);
    return { ok: true };
  } catch (err) {
    console.error('[email] erro', err);
    return { ok: false, error: err?.message || 'email_error' };
  }
}
