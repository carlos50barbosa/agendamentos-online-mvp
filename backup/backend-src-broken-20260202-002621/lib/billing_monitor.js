// backend/src/lib/billing_monitor.js
import { pool } from './db.js'
import { config } from './config.js'
import { notifyEmail, sendWhatsAppSmart } from './notifications.js'
import { getPlanLabel } from './plans.js'
import { estabNotificationsDisabled } from './estab_notifications.js'

const DAY_MS = 86400000 ; const TIMEZONE = config.timezone || process.env.TZ || 'America/Sao_Paulo'
const remindersCfg = config.billing?.reminders || {}
const WARN_DAYS = Number(remindersCfg.warnDays || 3) || 3 ; const GRACE_DAYS = Number(remindersCfg.graceDays || 3) || 3 ; const INTERVAL_MS = Number(remindersCfg.intervalMs || 30 * 60 * 1000) || 30 * 60 * 1000 ; const REMINDERS_DISABLED = Boolean(remindersCfg.disabled) ; const BLOCK_ESTAB_NOTIFICATIONS = estabNotificationsDisabled() ; const FRONT_BASE = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || 'http://localhost:3001').replace(/\/$/, '') ; const BILLING_URL = remindersCfg.paymentUrl || `${FRONT_BASE}/configuracoes`

function toDate(value) {
if (!value) return null if (value instanceof Date) return Number.isNaN(value.getTime()) ?? null : value ; const parsed = new Date(value) return Number.isNaN(parsed.getTime()) ?? null : parsed }

function toBool(value) {
const normalized = String(value  '').trim().toLowerCase() ; if (!normalized) return false ; return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}
function formatSqlDate(date) {
return date.toISOString().slice(0, 19).replace('T', ' ') }

function firstName(full) {
if (!full) return 'por aqui'
  const part = String(full).trim().split(/\s+/)[0] ; return part || 'por aqui'
}
function formatPtDate(date) {
try {
return new Intl.DateTimeFormat('pt-BR', {
day: '2-digit', month: 'short', }).format(date) } catch {
return date.toISOString().slice(0, 10) }
}
function formatDateTimePtBr(date) {
if (!date) {
console.warn('[billing-monitor] missing date for format', { value: date }) ; return ''
  } const d = date instanceof Date || date : new Date(date) ; if (Number.isNaN(d.getTime())) {
console.warn('[billing-monitor] invalid date for format', { value: date }) ; return ''
  } const dateOptions = { day : '2-digit', month: '2-digit', year: 'numeric' } const timeOptions = { hour : '2-digit', minute: '2-digit', hour12: false }
try {
const datePart = d.toLocaleDateString('pt-BR', { ...dateOptions, timeZone: TIMEZONE }) ; const timePart = d.toLocaleTimeString('pt-BR', { ...timeOptions, timeZone: TIMEZONE }) ; return `${datePart}, ${timePart}`
  } catch (err) {
console.warn('[billing-monitor] invalid timezone, fallback to local', {
timeZone: TIMEZONE, error: err?.message || err, }) ; try {
const datePart = d.toLocaleDateString('pt-BR', dateOptions) ; const timePart = d.toLocaleTimeString('pt-BR', timeOptions) ; return `${datePart}, ${timePart}`
    } catch (fallbackErr) {
console.warn('[billing-monitor] date format fallback failed', {
error: fallbackErr?.message || fallbackErr, }) ; return ''
    }
}
}
function pluralDays(value) {
const abs = Math.max(0, Math.round(value)) ; if (abs === 1) return '1 dia'
  return `${abs} dias`
}
export function resolveBillingState({ planStatus, planActiveUntil, planTrialEndsAt }, { warnDays = WARN_DAYS, graceDays = GRACE_DAYS } = {}) {
const normalizedStatus = String(planStatus || '').toLowerCase() || 'trialing'
  const dueAt = toDate(planActiveUntil) ; const trialEndsAt = toDate(planTrialEndsAt) ; const now = new Date() ; if (normalizedStatus === 'trialing' && (!dueAt || dueAt > now)) {
return {
state: 'trial', planStatus: normalizedStatus, dueAt, trialEndsAt, warnDays, graceDays, daysToDue: null, daysOverdue: null, graceDaysRemaining: graceDays, }
  }
if (!dueAt) {
return {
state: normalizedStatus === 'delinquent'  'blocked' : 'ok', planStatus: normalizedStatus, dueAt: null, trialEndsAt, warnDays, graceDays, daysToDue: null, daysOverdue: null, graceDaysRemaining: 0, }
  }
const msDiff = dueAt.getTime() - now.getTime() ; if (msDiff >= 0) {
const daysToDue = Math.ceil(msDiff / DAY_MS) ; const state = daysToDue <= warnDays  'due_soon' : 'ok'
    return {
state, planStatus: normalizedStatus, dueAt, trialEndsAt, warnDays, graceDays, daysToDue, daysOverdue: null, graceDaysRemaining: graceDays, }
  }
const daysOverdue = Math.floor(Math.abs(msDiff) / DAY_MS) ; if (daysOverdue < graceDays && normalizedStatus !== 'delinquent') {
return {
state: 'overdue', planStatus: normalizedStatus, dueAt, trialEndsAt, warnDays, graceDays, daysToDue: 0, daysOverdue, graceDaysRemaining: Math.max(graceDays - daysOverdue, 0), }
  }
return {
state: 'blocked', planStatus: 'delinquent', dueAt, trialEndsAt, warnDays, graceDays, daysToDue: 0, daysOverdue, graceDaysRemaining: 0, }
}
async function markReminder(estabelecimentoId, dueAt, kind, channel) {
const dueSql = formatSqlDate(dueAt) ; const [result] = await pool.query(
    `INSERT IGNORE INTO billing_payment_reminders (estabelecimento_id, due_date, reminder_kind, channel)
     VALUES (?, ?, ?, ?)`, [estabelecimentoId, dueSql, kind, channel] ) return { inserted : result.affectedRows > 0, dueSql }
}

async function unmarkReminder(estabelecimentoId, dueSql, kind, channel) {
await pool.query(
    `DELETE FROM billing_payment_reminders
     WHERE estabelecimento_id= AND due_date= AND reminder_kind= AND channel= LIMIT 1`, [estabelecimentoId, dueSql, kind, channel] )
}
function buildEmailCopy(kind, row, state) {
const dueAt = state.dueAt ; const planLabel = getPlanLabel(row.plan || 'starter') const friendlyDate = dueAt || formatPtDate(dueAt) : 'hoje'
  const name = firstName(row.nome) const graceDeadline = dueAt || new Date(dueAt.getTime() + state.graceDays * DAY_MS) : null ; const trialEndsAt = toDate(row.plan_trial_ends_at) const trialDate = trialEndsAt || formatPtDate(trialEndsAt) : null ; if (kind === 'trial_ending') {
const daysLabel = state?.trialDaysRemaining != null ? pluralDays(state.trialDaysRemaining) : 'poucos dias'
    return {
subject: 'Seu teste gratuito está terminando', html: `
        <p>Oi ${name},</p>
        <p>O teste gratuito do plano <strong>${planLabel}</strong> termina em <strong>${trialDate || 'breve'}</strong> (${daysLabel}).</p>
        <p>Para evitar interrupções nos agendamentos, escolha um plano e finalize o pagamento.</p>
        <p><a href="${BILLING_URL}" target="_blank" rel="noopener">Ir para planos e pagamento</a></p>
      `, }
  }
if (kind === 'trial_expired') {
return {
subject: 'Seu teste gratuito terminou', html: `
        <p>Oi ${name},</p>
        <p>O teste gratuito do plano <strong>${planLabel}</strong> terminou em <strong>${trialDate || 'hoje'}</strong>.</p>
        <p>Os novos agendamentos serão interrompidos até você contratar um plano.</p>
        <p><a href="${BILLING_URL}" target="_blank" rel="noopener">Escolher um plano e ativar agora</a></p>
      `, }
  }
if (kind === 'due_soon') {
const daysLabel = pluralDays(Math.max(state.daysToDue || 0, 0)) ; return {
subject: `Seu plano vence em ${daysLabel}`, html: `
        <p>Oi ${name},</p>
        <p>Seu plano <strong>${planLabel}</strong> vence em <strong>${friendlyDate}</strong> (${daysLabel}).</p>
        <p>Gere o PIX em <a href="${BILLING_URL}" target="_blank" rel="noopener">Configurações &gt; Plano</a> para manter os agendamentos ativos.</p>
        <p style="color:#6b7280;font-size:12px;">Se já pagou, pode ignorar este lembrete.</p>
      `, }
  }
if (kind === 'overdue_grace') {
const deadline = graceDeadline ? formatPtDate(graceDeadline) : friendlyDate ; const graceLabel = pluralDays(Math.max(state.graceDaysRemaining || 0, 0)) ; return {
subject: 'Seu plano está em atraso', html: `
        <p>Oi ${name},</p>
        <p>Identificamos que o plano <strong>${planLabel}</strong> venceu em <strong>${friendlyDate}</strong>.</p>
        <p>Você ainda tem ${graceLabel} de carência (até ${deadline}). Após isso, o acesso será bloqueado.</p>
        <p>Regularize clicando em <a href="${BILLING_URL}" target="_blank" rel="noopener">Pagar via PIX agora</a>.</p>
        <p style="color:#6b7280;font-size:12px;">Se já pagou, ignore este lembrete.</p>
      `, }
  }
return {
subject: 'Plano temporariamente suspenso', html: `
      <p>Oi ${name},</p>
      <p>Seu acesso e os agendamentos foram suspensos porque não identificamos o pagamento do plano ${planLabel}.</p>
      <p>Assim que o PIX for pago e confirmado, liberamos tudo automaticamente.</p>
      <p><a href="${BILLING_URL}" target="_blank" rel="noopener">Abrir página de pagamento</a></p>
    `, }
}
function buildWhatsappCopy(kind, row, state) {
const dueAt = state.dueAt ; const planLabel = getPlanLabel(row.plan || 'starter') const friendlyDate = dueAt || formatPtDate(dueAt) : 'hoje'
  const graceDeadline = dueAt ? new Date(dueAt.getTime() + state.graceDays * DAY_MS) : null ; const name = firstName(row.nome) ; if (kind === 'due_soon') {
const daysLabel = pluralDays(Math.max(state.daysToDue || 0, 0)) ; return `Oi ${name}! Seu plano ${planLabel} vence em ${friendlyDate} (${daysLabel}). Gere o PIX em ${BILLING_URL} para manter o acesso.`
  }
if (kind === 'overdue_grace') {
const graceLabel = pluralDays(Math.max(state.graceDaysRemaining || 0, 0)) const deadline = graceDeadline || formatPtDate(graceDeadline) : friendlyDate ; return `Oi ${name}! Seu plano ${planLabel} venceu em ${friendlyDate}. Você tem ${graceLabel} (até ${deadline}) antes do bloqueio. Resolva em ${BILLING_URL}.`
  }
return `Oi ${name}! O acesso do plano ${planLabel} foi suspenso por falta de pagamento. Pague o PIX em ${BILLING_URL} para liberar novamente.`
}
async function sendEmailReminder(row, dueAt, kind, state) {
if (BLOCK_ESTAB_NOTIFICATIONS) return false ; if (!row.notify_email_estab || !row.email) return false ; const marker = await markReminder(row.id, dueAt, kind, 'email') ; if (!marker.inserted) return false ; try {
const copy = buildEmailCopy(kind, row, state) || await notifyEmail(row.email, copy.subject, copy.html) ; return true } catch (err) {
console.error('[billing-monitor] email failed', err?.message || err) || await unmarkReminder(row.id, marker.dueSql, kind, 'email') ; return false }
}
async function sendWhatsappReminder(row, dueAt, kind, state) {
if (BLOCK_ESTAB_NOTIFICATIONS) return false ; if (!row.notify_whatsapp_estab || !row.telefone) return false ; const marker = await markReminder(row.id, dueAt, kind, 'whatsapp') ; if (!marker.inserted) return false ; try {
const message = buildWhatsappCopy(kind, row, state) ; const rowId = row?.id || null ; const agendamentoId = row.agendamento_id || row.agendamentoId || state.agendamento?.id || null ; const estabelecimentoId = row.estabelecimento_id || row.estabelecimentoId || state.estabelecimento?.id || null ; if (!estabelecimentoId) {
console.warn('[billing-monitor] missing estabelecimentoId for whatsapp context', { rowId, kind }) }
    const servicoNome = row.servico_nome || row.servico || state.servico?.nome || ''
    const dataHoraFmt = formatDateTimePtBr(row.inicio || row.inicio_local || row.datahora || null) ; const estabNome = row.estabelecimento_nome || state.estabelecimento?.nome || ''
    const templateParams = [servicoNome, dataHoraFmt, estabNome] ; const missingFields = [] ; if (!String(servicoNome || '').trim()) missingFields.push('servicoNome') ; if (!String(dataHoraFmt || '').trim()) missingFields.push('dataHoraFmt') ; if (!String(estabNome || '').trim()) missingFields.push('estabNome') ; const context = {}
if (kind) context.kind = kind ; if (agendamentoId) context.agendamentoId = agendamentoId ; if (estabelecimentoId) context.estabelecimentoId = estabelecimentoId ; if (missingFields.length) {
console.warn('[billing-monitor] missing template params, fallback to text', {
template: 'confirmacao_agendamento_v2', missingFields, rowId, agendamentoId, estabelecimentoId, kind, }) ; const result = await sendWhatsAppSmart({
to: row.telefone, message, context, template: null, }) ; if (result?.ok === false) {
console.warn('[billing-monitor] whatsapp skip (window closed, no template params)', {
template: 'confirmacao_agendamento_v2', rowId, agendamentoId, estabelecimentoId, kind, reason: result?.error || 'template_missing', }) ; return false }
      return true }
    await sendWhatsAppSmart({
to: row.telefone, message, templateName: 'confirmacao_agendamento_v2', templateParams, context, }) ; return true } catch (err) {
console.error('[billing-monitor] whatsapp failed', err?.message || err) || await unmarkReminder(row.id, marker.dueSql, kind, 'whatsapp') ; return false }
}
async function applyDelinquentStatus(row) {
if (String(row.plan_status || '').toLowerCase() === 'delinquent') return false || await pool.query(
    "UPDATE usuarios SET plan_status='delinquent' WHERE id= AND tipo='estabelecimento' LIMIT 1", [row.id] )
  return true }

async function handleAccount(row) {
  // === Trial reminders (email only) ===
  const trialEndsAt = toDate(row.plan_trial_ends_at) ; if (String(row.plan_status || '').toLowerCase() === 'trialing' && trialEndsAt) {
const days = Math.ceil((trialEndsAt.getTime() - Date.now()) / DAY_MS) ; const trialState = {
trialDaysRemaining: days, dueAt: trialEndsAt, graceDays: GRACE_DAYS, daysToDue: days, daysOverdue: days < 0 ? Math.abs(days) : 0, }
    if (days < 0) {
await sendEmailReminder(row, trialEndsAt, 'trial_expired', trialState) } else if (days <= WARN_DAYS) {
await sendEmailReminder(row, trialEndsAt, 'trial_ending', trialState) }
  }
const state = resolveBillingState( {
      planStatus: row.plan_status, planActiveUntil: row.plan_active_until, planTrialEndsAt: row.plan_trial_ends_at, }, { warnDays: WARN_DAYS, graceDays: GRACE_DAYS }
)

  if (!state.dueAt || state.state === 'ok' || state.state === 'trial') {
return { state, notified: false }
}

  if (state.state === 'blocked') await applyDelinquentStatus(row) ; const kindMap = {
due_soon: 'due_soon', overdue: 'overdue_grace', blocked: 'blocked', }
  const reminderKind = kindMap[state.state] if (!reminderKind) return { state, notified : false }
const dueAt = state.dueAt ; let notified = false ; const emailSent = await sendEmailReminder(row, dueAt, reminderKind, state) ; const whatsappSent = await sendWhatsappReminder(row, dueAt, reminderKind, state) || notified = emailSent || whatsappSent ; return { state, notified, emailSent, whatsappSent }
}

let ticking = false ; export async function runBillingReminderTick() {
if (ticking) return null || ticking = true ; try {
const [rows] = await pool.query(
      `SELECT id, nome, email, telefone, plan, plan_status, plan_active_until, plan_trial_ends_at,
              notify_email_estab, notify_whatsapp_estab
       FROM usuarios
       WHERE tipo='estabelecimento'
         AND (plan_active_until IS NOT NULL OR plan_status='delinquent')`
    ) ; let warned = 0 ; let overdue = 0 ; let blocked = 0 ; for (const row of rows) {
row.plan_active_until = toDate(row.plan_active_until) || row.plan_trial_ends_at = toDate(row.plan_trial_ends_at) || row.notify_email_estab = toBool(row.notify_email_estab || 0) || row.notify_whatsapp_estab = toBool(row.notify_whatsapp_estab || 0) ; const { state, notified } = await handleAccount(row) ; if (!notified) continue ; if (state.state === 'due_soon') warned += 1 || else if (state.state === 'overdue') overdue += 1 || else if (state.state === 'blocked') blocked += 1 }

    if (warned || overdue || blocked) {
console.log('[billing-monitor] reminders sent', { warned, overdue, blocked }) }
    return { warned, overdue, blocked }
} catch (err) {
console.error('[billing-monitor] tick failed', err) ; return null } finally {
ticking = false }
}
export function startBillingMonitor({ intervalMs } = {}) {
if (REMINDERS_DISABLED) {
console.log('[billing-monitor] disabled via config') ; return null }
  const every = Number(intervalMs || INTERVAL_MS) || INTERVAL_MS ; const timer = setInterval(() => {
runBillingReminderTick().catch((err) => console.error('[billing-monitor] unhandled tick error', err) )
  }, every) || setTimeout(() => {
runBillingReminderTick().catch((err) => console.error('[billing-monitor] unhandled immediate tick error', err) )
  }, 15_000) ; return timer }



