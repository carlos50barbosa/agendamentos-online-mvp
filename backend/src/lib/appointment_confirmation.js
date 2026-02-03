// backend/src/lib/appointment_confirmation.js
import { pool } from './db.js';
import { notifyEmail } from './notifications.js';
import { sendAppointmentWhatsApp } from './whatsapp_outbox.js';
import { buildConfirmacaoAgendamentoV2Components, isConfirmacaoAgendamentoV2 } from './whatsapp_templates.js';
import { estabNotificationsDisabled } from './estab_notifications.js';
import { clientWhatsappDisabled, whatsappImmediateDisabled, whatsappConfirmationDisabled } from './client_notifications.js';
const TZ = 'America/Sao_Paulo';
const FRONTEND_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '');
const toDigits = (s) => String(s || '').replace(/\D/g, '');
const normalizePhoneBR = (value) => {
let digits = toDigits(value);
if (!digits) return '';
digits = digits.replace(/^0+/, '');
if (digits.startsWith('55')) return digits;
if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
return digits;
};
const boolPref = (value, fallback = true) => {
if (value === undefined || value === null) return fallback;
if (value === true || value === false) return Boolean(value);
const num = Number(value);
if (!Number.isNaN(num)) return num !== 0;
const norm = String(value).trim().toLowerCase();
if (['0', 'false', 'off', 'no', 'nao'].includes(norm)) return false;
if (['1', 'true', 'on', 'yes', 'sim'].includes(norm)) return true;
return fallback;
};
const firstName = (full) => {
const parts = String(full || '').trim().split(/\s+/);
return parts[0] || '';
};
function brDateTime(iso) {
return new Date(iso).toLocaleString('pt-BR', {
hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ, });
}

async function fetchAppointmentSummary(appointmentId) {
const [rows] = await pool.query(
    `SELECT a.id, a.inicio, a.estabelecimento_id, a.cliente_id, a.profissional_id,
            c.nome AS cliente_nome, c.email AS cliente_email, c.telefone AS cliente_telefone,
            e.nome AS estabelecimento_nome, e.email AS estabelecimento_email, e.telefone AS estabelecimento_telefone,
            e.notify_email_estab, e.notify_whatsapp_estab,
            COALESCE(NULLIF(GROUP_CONCAT(s.nome ORDER BY ai.ordem SEPARATOR ' + '), ''), s0.nome) AS servico_nome,
            p.nome AS profissional_nome
       FROM agendamentos a
       JOIN usuarios c ON c.id = a.cliente_id
       JOIN usuarios e ON e.id = a.estabelecimento_id
       LEFT JOIN agendamento_itens ai ON ai.agendamento_id = a.id
       LEFT JOIN servicos s ON s.id = ai.servico_id
       LEFT JOIN servicos s0 ON s0.id = a.servico_id
       LEFT JOIN profissionais p ON p.id = a.profissional_id
      WHERE a.id = ?
      GROUP BY a.id, a.inicio, a.estabelecimento_id, a.cliente_id, a.profissional_id,
               c.nome, c.email, c.telefone,
               e.nome, e.email, e.telefone, e.notify_email_estab, e.notify_whatsapp_estab,
               p.nome, s0.nome
      LIMIT 1`, [appointmentId] );
return rows?.[0] || null;
}

async function fetchEstablishmentTemplate(estabelecimentoId) {
const [rows] = await pool.query(
    'SELECT email_subject, email_html, wa_template FROM estab_messages WHERE estabelecimento_id=?', [estabelecimentoId] );
return rows?.[0] || {};
}

export async function notifyAppointmentConfirmed(appointmentId) {
try {
const ag = await fetchAppointmentSummary(appointmentId);
if (!ag) return;
const tmpl = await fetchEstablishmentTemplate(ag.estabelecimento_id);
const serviceLabel = ag.servico_nome || 'servico';
const profNome = ag.profissional_nome || '';
const profLabel = profNome ? ` com <b>${profNome}</b>` : '';
const inicioISO = new Date(ag.inicio).toISOString();
const inicioBR = brDateTime(inicioISO);
const telCli = normalizePhoneBR(ag.cliente_telefone);
const telEst = normalizePhoneBR(ag.estabelecimento_telefone);
const canEmailEst = boolPref(ag.notify_email_estab, true);
const canWhatsappEst = boolPref(ag.notify_whatsapp_estab, true);
const blockEstabNotifications = estabNotificationsDisabled();
const blockClientWhatsapp = clientWhatsappDisabled();
const blockWhatsappImmediate = whatsappImmediateDisabled();
const blockWhatsappConfirmation = whatsappConfirmationDisabled();
const appointmentLink = `${FRONTEND_BASE}/cliente?agendamento=${ag.id}`;
const appointmentLinkHtml = `<p><a href="${appointmentLink}">Ver agendamento</a></p>`;
try {
const emailNorm = ag.cliente_email ? String(ag.cliente_email).trim().toLowerCase() : '';
if (emailNorm) {
const subject = tmpl.email_subject || 'Agendamento confirmado';
const rawTemplate = tmpl.email_html ||
          `<p>Olá, <b>{{cliente_nome}}</b>! Seu agendamento de <b>{{servico_nome}}</b>{{profissional_nome}} foi confirmado para <b>{{data_hora}}</b>.</p>`;
const hasLinkPlaceholder = /{{\s*link_agendamento\s*}}/i.test(rawTemplate);
let html = rawTemplate .replace(/{{\s*cliente_nome\s*}}/g, firstName(ag.cliente_nome) || 'cliente') .replace(/{{\s*servico_nome\s*}}/g, serviceLabel) .replace(/{{\s*data_hora\s*}}/g, inicioBR) .replace(/{{\s*estabelecimento_nome\s*}}/g, ag.estabelecimento_nome || '') .replace(/{{\s*profissional_nome\s*}}/g, profNome ? ` com <b>${profNome}</b>` : '') .replace(/{{\s*link_agendamento\s*}}/gi, appointmentLinkHtml);
if (!hasLinkPlaceholder) {
html += appointmentLinkHtml;
}
        await notifyEmail(emailNorm, subject, html);
}
    } catch {}
try {
if (!blockEstabNotifications && ag.estabelecimento_email && canEmailEst) {
await notifyEmail( ag.estabelecimento_email,
          'Novo agendamento recebido',
          `<p>Você recebeu um novo agendamento de <b>${serviceLabel}</b>${profLabel} em <b>${inicioBR}</b> para o cliente <b>${ag.cliente_nome || ''}</b>.</p>`
        );
}
    } catch {}
try {
if (!blockWhatsappImmediate && !blockWhatsappConfirmation) {
const paramMode = String(process.env.WA_TEMPLATE_PARAM_MODE || 'single').toLowerCase();
const tplName = process.env.WA_TEMPLATE_NAME_CONFIRM || process.env.WA_TEMPLATE_NAME || 'confirmacao_agendamento_v2';
const tplLang = process.env.WA_TEMPLATE_LANG || 'pt_BR';
const estNomeLabel = ag.estabelecimento_nome || '';
const isConfirmV2 = isConfirmacaoAgendamentoV2(tplName);
const tplParams = isConfirmV2
  ? buildConfirmacaoAgendamentoV2Components({
      serviceLabel,
      dataHoraLabel: inicioBR,
      estabelecimentoNome: estNomeLabel,
    })
  : [serviceLabel, inicioBR, estNomeLabel];
const waMsg = (tmpl.wa_template || `Novo agendamento registrado: {{servico_nome}} em {{data_hora}} - {{estabelecimento_nome}}.`) .replace(/{{\s*cliente_nome\s*}}/g, firstName(ag.cliente_nome) || 'cliente') .replace(/{{\s*servico_nome\s*}}/g, serviceLabel) .replace(/{{\s*data_hora\s*}}/g, inicioBR) .replace(/{{\s*estabelecimento_nome\s*}}/g, estNomeLabel) .replace(/{{\s*profissional_nome\s*}}/g, profNome ? ` com ${profNome}` : '');
const fallbackBodyParams = isConfirmV2 ? tplParams : [waMsg];
if (!blockClientWhatsapp && telCli) {
if (/^triple|3$/.test(paramMode)) {
await sendAppointmentWhatsApp({
estabelecimentoId: ag.estabelecimento_id, agendamentoId: ag.id, to: telCli, kind: 'confirm_cli', template: { name: tplName, lang: tplLang, bodyParams: tplParams }, });
} else {
await sendAppointmentWhatsApp({
estabelecimentoId: ag.estabelecimento_id, agendamentoId: ag.id, to: telCli, kind: 'confirm_cli', message: waMsg, template: { name: tplName, lang: tplLang, bodyParams: fallbackBodyParams }, });
}
        }
if (!blockEstabNotifications && canWhatsappEst && telEst && telEst !== telCli) {
if (/^triple|3$/.test(paramMode)) {
await sendAppointmentWhatsApp({
estabelecimentoId: ag.estabelecimento_id, agendamentoId: ag.id, to: telEst, kind: 'confirm_est', template: { name: tplName, lang: tplLang, bodyParams: tplParams }, });
} else {
await sendAppointmentWhatsApp({
estabelecimentoId: ag.estabelecimento_id, agendamentoId: ag.id, to: telEst, kind: 'confirm_est', message: waMsg, template: { name: tplName, lang: tplLang, bodyParams: fallbackBodyParams }, });
}
        }
}
    } catch {}
} catch (err) {
console.warn('[deposit][notify] falha ao disparar notificacoes', err?.message || err);
}
}



