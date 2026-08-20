// backend/src/routes/otp_public.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../lib/db.js';
import { notifyEmail, sendWhatsAppSmart } from '../lib/notifications.js';
import { extractWamid } from '../services/waGraph.js';
import { getClientIp } from '../lib/client_ip.js';
import { config } from '../lib/config.js';
import { isValidMobileBR } from '../lib/phone_br.js';
import {
  buildRateLimitBody,
  buildRateLimitClientKey,
  consumeRateLimit,
  setRateLimitHeaders,
} from '../lib/request_rate_limit.js';
import { createHash } from 'crypto';

const router = Router();

// ─── O código do OTP precisa de TEMPLATE DE AUTENTICAÇÃO, não de texto ────────────────────────
//
// Quem pede um código está, por definição, fora da janela de 24h: é justamente quem nunca escreveu
// para o número. E fora da janela a Meta só aceita template. O envio antigo mandava texto puro via
// notifyWhatsapp, o smart-send caía no template genérico do ambiente (WA_TEMPLATE_NAME, hoje
// 'confirmacao_agendamento_v2', que exige 3 params) e abortava com 0 params. Medido em produção:
// NENHUM código por WhatsApp jamais saiu por este caminho.
//
// O template tem de ser da categoria AUTHENTICATION. Reaproveitar um utility/marketing aprovado
// para outra finalidade é o tipo de desvio que derruba WABA — e esta já caiu duas vezes.
const OTP_TEMPLATE_NAME = String(process.env.WA_OTP_TEMPLATE_NAME || '').trim();
const OTP_TEMPLATE_LANG = String(process.env.WA_OTP_TEMPLATE_LANG || 'pt_BR').trim();
// Templates de autenticação da Meta vêm com botão (copiar código ou preenchimento automático), e o
// botão recebe o MESMO código do corpo. Desligável para o caso raro de um template sem botão.
const OTP_TEMPLATE_COPY_BUTTON = !/^(0|false|no)$/i.test(String(process.env.WA_OTP_TEMPLATE_COPY_BUTTON ?? '1'));

function buildOtpTemplateComponents(code) {
  const components = [{ type: 'body', parameters: [{ type: 'text', text: code }] }];
  if (OTP_TEMPLATE_COPY_BUTTON) {
    components.push({
      type: 'button',
      sub_type: 'copy_code',
      index: '0',
      parameters: [{ type: 'coupon_code', coupon_code: code }],
    });
  }
  return components;
}

async function sendOtpWhatsapp(to, code) {
  if (!OTP_TEMPLATE_NAME) {
    // Sem template configurado NÃO se tenta o envio: cairia no template genérico de novo, gastaria
    // a chamada e falharia igual. Falhar aqui deixa a causa no log, em vez de um 'params missing'
    // que parece problema de outra feature.
    console.error('[otp/request] WA_OTP_TEMPLATE_NAME ausente — envio por WhatsApp desabilitado', {
      code: 'otp_template_not_configured',
    });
    return { ok: false, error: 'otp_template_not_configured' };
  }
  // allowText:false + forceTemplate:true de propósito. Dentro da janela o texto até sairia, mas aí
  // o mesmo código chegaria em dois formatos conforme a hora do dia — e a versão de texto vem sem
  // o botão de copiar.
  const result = await sendWhatsAppSmart({
    to,
    allowText: false,
    forceTemplate: true,
    template: {
      name: OTP_TEMPLATE_NAME,
      lang: OTP_TEMPLATE_LANG,
      components: buildOtpTemplateComponents(code),
    },
  });
  // O wamid é a única prova de que a mensagem saiu: os caminhos de recusa devolvem {ok:false},
  // {blocked:true} ou {invalid:true}, todos sem id.
  if (extractWamid(result)) return { ok: true };
  return { ok: false, error: result?.error || result?.reason || 'wa_send_failed' };
}

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 dígitos
}

// O destino entra no bucket como HASH, não em claro. A chave do rate limit vira linha na tabela
// `rate_limit_counters` e aparece em log de segurança; gravar ali o telefone e o e-mail de quem
// está agendando criaria um terceiro lugar com dado pessoal, sem finalidade nenhuma. O sha256 do
// canal + valor tem exatamente a mesma serventia para contar.
function destinationBucket(channel, value) {
  return `otp-request:dest:${createHash('sha256').update(`${channel}:${value}`).digest('hex').slice(0, 32)}`;
}

router.post('/request', async (req, res) => {
  try {
    const channel = String(req.body?.channel || '').toLowerCase();
    const valueRaw = String(req.body?.value || '');
    if (!['email','phone'].includes(channel)) return res.status(400).json({ error: 'invalid_channel' });
    // `value` fica no formato de HOJE (e-mail minúsculo, telefone só dígitos) de propósito: é ele
    // que vai para `otp_codes.value`, entra no `otp_token` como `v` e é comparado com `telDigits`
    // em agendamentos_public.js. Normalizar aqui para E.164 romperia essa comparação e todo
    // agendamento com OTP passaria a morrer em `otp_mismatch`.
    const value = channel === 'email' ? valueRaw.trim().toLowerCase() : valueRaw.replace(/\D/g, '');
    if (!value) return res.status(400).json({ error: 'invalid_value' });

    // Celular de verdade, ou não sai daqui. Esta rota é pública e manda pela WABA da plataforma;
    // `isValidMobileBR` é justamente a régua de "posso ENVIAR para este número?" (ver o comentário
    // em lib/phone_br.js, que distingue essa pergunta de "posso cadastrar este telefone?").
    // Sem isto, `value.replace(/\D/g,'')` aceita qualquer sequência de dígitos do mundo.
    if (channel === 'phone' && !isValidMobileBR(value)) {
      return res.status(400).json({
        error: 'invalid_value',
        message: 'Informe um celular válido com DDD.',
      });
    }

    // Dois tetos, montados antes de gastar bcrypt ou de escrever em otp_codes.
    const limits = config.security?.rateLimit?.otpPublic || {};
    const byClient = await consumeRateLimit({
      bucketKey: `otp-request:${buildRateLimitClientKey(req)}`,
      windowMs: limits.windowMs,
      max: limits.max,
    });
    setRateLimitHeaders(res, byClient);
    if (byClient.limited) {
      return res.status(429).json(buildRateLimitBody(byClient, { request_id: req.requestId || null }));
    }

    const byDestination = await consumeRateLimit({
      bucketKey: destinationBucket(channel, value),
      windowMs: limits.destinationWindowMs,
      max: limits.destinationMax,
    });
    if (byDestination.limited) {
      // Sem setRateLimitHeaders aqui: os headers já descrevem a cota do cliente, e sobrescrevê-los
      // com a do destino contaria para ele quantas vezes AQUELE número foi alvo — de qualquer IP.
      return res.status(429).json(buildRateLimitBody(byDestination, { request_id: req.requestId || null }));
    }

    const code = genCode();
    const hash = await bcrypt.hash(code, 8);
    const requestId = crypto.randomBytes(16).toString('hex');
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    const ip = getClientIp(req).slice(0,64);

    await pool.query(
      'INSERT INTO otp_codes (request_id, channel, value, code_hash, expires_at, ip_addr) VALUES (?,?,?,?,?,?)',
      [requestId, channel, value, hash, expires, ip]
    );

    // envia
    //
    // O resultado do envio agora IMPORTA. Antes qualquer falha virava um console.warn e a rota
    // respondia ok:true — a tela avançava para "digite o código" e a pessoa ficava esperando uma
    // mensagem que nunca saiu. Prometer entrega que não aconteceu é o mesmo defeito do "enviamos a
    // confirmação para o seu e-mail" que já custou caro no fluxo público.
    let delivered = false;
    let sendError = null;
    try {
      if (channel === 'email') {
        await notifyEmail(value, 'Seu código de verificação', `<p>Seu código é <b>${code}</b>. Ele expira em 10 minutos.</p>`);
        delivered = true;
      } else {
        const result = await sendOtpWhatsapp(value, code);
        delivered = result.ok === true;
        if (!delivered) sendError = result.error;
      }
    } catch (e) {
      sendError = e?.code || e?.message || 'send_failed';
      console.warn('[otp/request] envio falhou:', e?.message || e);
    }

    if (!delivered) {
      // O código já está gravado, mas ninguém o recebeu: não adianta devolver request_id. 502
      // porque a falha é de serviço externo (Graph/SMTP), não do pedido de quem chamou.
      console.error('[otp/request] codigo nao entregue', { code: 'otp_send_failed', channel, reason: sendError });
      return res.status(502).json({
        error: 'otp_send_failed',
        message: 'Não conseguimos enviar seu código agora. Tente de novo em alguns minutos.',
      });
    }

    return res.json({ ok: true, request_id: requestId });
  } catch (e) {
    console.error('[otp/request]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const requestId = String(req.body?.request_id || '');
    const code = String(req.body?.code || '');
    if (!requestId || !code) return res.status(400).json({ error: 'invalid_payload' });

    const [rows] = await pool.query('SELECT * FROM otp_codes WHERE request_id=? LIMIT 1', [requestId]);
    const rec = rows?.[0];
    if (!rec) return res.status(400).json({ error: 'invalid_request' });
    if (rec.used_at) return res.status(400).json({ error: 'already_used' });
    if (new Date(rec.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'expired' });

    const ok = await bcrypt.compare(code, rec.code_hash);
    if (!ok) {
      try { await pool.query('UPDATE otp_codes SET attempts=attempts+1 WHERE id=?', [rec.id]); } catch {}
      return res.status(400).json({ error: 'invalid_code' });
    }

    // marca usado
    try { await pool.query('UPDATE otp_codes SET used_at=NOW() WHERE id=?', [rec.id]); } catch {}

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'server_config' });
    const token = jwt.sign({ scope: 'otp', ch: rec.channel, v: rec.value, rid: rec.request_id }, secret, { expiresIn: '30m' });

    return res.json({ ok: true, otp_token: token });
  } catch (e) {
    console.error('[otp/verify]', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;

