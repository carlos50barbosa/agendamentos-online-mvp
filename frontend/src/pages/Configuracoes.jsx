// src/pages/Configuracoes.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getUser, saveUser, saveToken } from '../utils/auth';
import { Api, resolveAssetUrl } from '../utils/api';
import { IconChevronRight } from '../components/Icons.jsx';
import Modal from '../components/Modal.jsx';

const formatPhoneLabel = (value = '') => {
  let digits = value.replace(/\D/g, '');

  if (!digits) return '';

  if (digits.length > 11 && digits.startsWith('55')) {
    digits = digits.slice(2);
  }

  if (digits.length > 11) {
    digits = digits.slice(-11);
  }

  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

const normalizePhone = (value = '') => {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
};

const formatCep = (value = '') => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

const toSlug = (value = '') => {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'estabelecimento';
};

const DEFAULT_WORKING_START = '09:00';
const DEFAULT_WORKING_END = '18:00';
const TIME_VALUE_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeDayText(value) {
  if (!value) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const WORKING_DAY_TOKENS = Object.freeze({
  monday: ['segunda', 'segunda-feira', 'seg', 'mon', 'monday'],
  tuesday: ['terca', 'terca-feira', 'ter', 'tue', 'tuesday'],
  wednesday: ['quarta', 'quarta-feira', 'qua', 'wed', 'wednesday'],
  thursday: ['quinta', 'quinta-feira', 'qui', 'thu', 'thursday'],
  friday: ['sexta', 'sexta-feira', 'sex', 'fri', 'friday'],
  saturday: ['sabado', 'sabado-feira', 'sab', 'sat', 'saturday'],
  sunday: ['domingo', 'domingo-feira', 'dom', 'sun', 'sunday'],
});

const WORKING_DAYS = [
  { key: 'monday', label: 'Segunda-feira', shortLabel: 'Segunda' },
  { key: 'tuesday', label: 'Terca-feira', shortLabel: 'Terca' },
  { key: 'wednesday', label: 'Quarta-feira', shortLabel: 'Quarta' },
  { key: 'thursday', label: 'Quinta-feira', shortLabel: 'Quinta' },
  { key: 'friday', label: 'Sexta-feira', shortLabel: 'Sexta' },
  { key: 'saturday', label: 'Sábado', shortLabel: 'Sabado' },
  { key: 'sunday', label: 'Domingo', shortLabel: 'Domingo' },
];

const DAY_ALIAS_MAP = (() => {
  const map = {};
  Object.entries(WORKING_DAY_TOKENS).forEach(([slug, tokens]) => {
    tokens.forEach((token) => {
      const normalized = normalizeDayText(token);
      if (normalized) map[normalized] = slug;
    });
  });
  return map;
})();

const WORKING_DAY_INDEX = WORKING_DAYS.reduce((acc, day, index) => {
  acc[day.key] = index;
  return acc;
}, {});

function createEmptyWorkingHours() {
  return WORKING_DAYS.map((day) => ({
    key: day.key,
    label: day.label,
    shortLabel: day.shortLabel,
    enabled: false,
    start: DEFAULT_WORKING_START,
    end: DEFAULT_WORKING_END,
    blockEnabled: false,
    blockStart: '',
    blockEnd: '',
  }));
}

function formatScheduleLine(entry) {
  if (!entry) return '';
  const label = entry.label ? String(entry.label).trim() : '';
  const value = entry.value ? String(entry.value).trim() : '';
  if (label && value) return `${label}: ${value}`;
  return value || label;
}

function sanitizeTimeInput(value) {
  if (!value && value !== 0) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (TIME_VALUE_REGEX.test(text)) return text;
  const digits = text.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 2) {
    const hours = Number(digits);
    if (!Number.isInteger(hours) || hours < 0 || hours > 23) return '';
    return `${String(hours).padStart(2, '0')}:00`;
  }
  const hoursDigits = digits.slice(0, -2);
  const minutesDigits = digits.slice(-2);
  const hoursNum = Number(hoursDigits);
  const minutesNum = Number(minutesDigits);
  if (
    !Number.isInteger(hoursNum) ||
    hoursNum < 0 ||
    hoursNum > 23 ||
    !Number.isInteger(minutesNum) ||
    minutesNum < 0 ||
    minutesNum > 59
  ) {
    return '';
  }
  return `${String(hoursNum).padStart(2, '0')}:${String(minutesNum).padStart(2, '0')}`;
}

function parseTimeRangeFromText(value) {
  if (!value) return { start: '', end: '', closed: false };
  const text = String(value).toLowerCase();
  if (/fechado|sem atendimento|nao atende/.test(text)) {
    return { start: '', end: '', closed: true };
  }
  const matches = Array.from(String(value).matchAll(/(\d{1,2})(?:[:h](\d{2}))?/gi));
  if (!matches.length) return { start: '', end: '', closed: false };
  const times = matches
    .map((match) => {
      const hour = match[1] ?? '';
      const minute = match[2] ?? '';
      return sanitizeTimeInput(hour + (minute ? ':' + minute : ''));
    })
    .filter(Boolean);
  if (!times.length) return { start: '', end: '', closed: false };
  const [start, end] = times;
  return { start: start || '', end: end || '', closed: false };
}

function resolveDayKey(entry) {
  if (!entry) return '';
  const dayRaw = entry.day ?? entry.weekday ?? entry.key ?? '';
  if (dayRaw && Object.prototype.hasOwnProperty.call(WORKING_DAY_INDEX, dayRaw)) {
    return dayRaw;
  }
  const label = entry.label ? normalizeDayText(entry.label) : '';
  if (label && DAY_ALIAS_MAP[label]) return DAY_ALIAS_MAP[label];
  const value = entry.value ? String(entry.value) : '';
  if (value) {
    const beforeColon = value.split(/[:\-]/)[0];
    const normalized = normalizeDayText(beforeColon);
    if (normalized && DAY_ALIAS_MAP[normalized]) return DAY_ALIAS_MAP[normalized];
    const firstWord = value.split(/\s+/)[0];
    const normalizedWord = normalizeDayText(firstWord);
    if (normalizedWord && DAY_ALIAS_MAP[normalizedWord]) return DAY_ALIAS_MAP[normalizedWord];
  }
  return '';
}

function extractWorkingHoursFromProfile(profile) {
  const schedule = createEmptyWorkingHours();
  const notes = [];
  const list = Array.isArray(profile?.horarios) ? profile.horarios : [];
  const used = new Set();

  for (const item of list) {
    if (!item) continue;
    const dayKey = resolveDayKey(item);
    const line = formatScheduleLine(item);
    if (!dayKey) {
      if (line) notes.push(line);
      continue;
    }
    if (used.has(dayKey)) {
      if (line) notes.push(line);
      continue;
    }
    const index = WORKING_DAY_INDEX[dayKey];
    if (index == null) {
      if (line) notes.push(line);
      continue;
    }
    const valueText = item.value ? String(item.value).trim() : '';
    const loweredValue = valueText.toLowerCase();
    if (/fechado|sem atendimento|nao atende/.test(loweredValue)) {
      schedule[index] = { ...schedule[index], enabled: false };
      used.add(dayKey);
      continue;
    }
    let start = sanitizeTimeInput(item.start ?? item.begin ?? item.from ?? '');
    let end = sanitizeTimeInput(item.end ?? item.finish ?? item.to ?? '');
    if ((!start || !end) && valueText) {
      const parsed = parseTimeRangeFromText(valueText);
      if (parsed.closed) {
        schedule[index] = { ...schedule[index], enabled: false };
        used.add(dayKey);
        continue;
      }
      if (!start && parsed.start) start = parsed.start;
      if (!end && parsed.end) end = parsed.end;
    }
    if (!start || !end) {
      if (line) notes.push(line);
      continue;
    }
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    const rawBlocks = Array.isArray(item.blocks)
      ? item.blocks
      : Array.isArray(item.breaks)
      ? item.breaks
      : [];

    let blockEnabled = false;
    let blockStart = '';
    let blockEnd = '';

    for (const block of rawBlocks) {
      if (!block) continue;
      const bStart = sanitizeTimeInput(block.start ?? block.begin ?? block.from ?? '');
      const bEnd = sanitizeTimeInput(block.end ?? block.finish ?? block.to ?? '');
      if (!bStart || !bEnd) continue;
      if (bStart >= bEnd) continue;
      if (bStart < start || bEnd > end) continue;
      blockEnabled = true;
      blockStart = bStart;
      blockEnd = bEnd;
      break;
    }

    schedule[index] = {
      ...schedule[index],
      enabled: true,
      start,
      end,
      blockEnabled,
      blockStart,
      blockEnd,
    };
    used.add(dayKey);
  }

  if (!notes.length) {
    const raw = typeof profile?.horarios_raw === 'string' ? profile.horarios_raw.trim() : '';
    if (raw) notes.push(raw);
  }

  return { schedule, notes: notes.join('\n') };
}

function validateWorkingHours(schedule) {
  for (const day of schedule) {
    if (!day.enabled) continue;
    if (!TIME_VALUE_REGEX.test(day.start || '')) {
      return `Informe um horario inicial valido para ${day.shortLabel}.`;
    }
    if (!TIME_VALUE_REGEX.test(day.end || '')) {
      return `Informe um horario final valido para ${day.shortLabel}.`;
    }
    if (day.start >= day.end) {
      return `O horario inicial deve ser anterior ao final em ${day.shortLabel}.`;
    }
    if (day.blockEnabled) {
      if (!TIME_VALUE_REGEX.test(day.blockStart || '')) {
        return `Informe um inicio valido para a trava em ${day.shortLabel}.`;
      }
      if (!TIME_VALUE_REGEX.test(day.blockEnd || '')) {
        return `Informe um fim valido para a trava em ${day.shortLabel}.`;
      }
      if (day.blockStart >= day.blockEnd) {
        return `A trava precisa ter inicio anterior ao fim em ${day.shortLabel}.`;
      }
      if (day.blockStart < day.start || day.blockEnd > day.end) {
        return `A trava em ${day.shortLabel} deve estar dentro do horario de atendimento.`;
      }
    }
  }
  return '';
}

function formatTimeDisplay(value) {
  const time = sanitizeTimeInput(value);
  if (!time) return '';
  const [hour, minute = '00'] = time.split(':');
  const prefix = hour.padStart(2, '0');
  return minute === '00' ? `${prefix}h` : `${prefix}h${minute}`;
}

function buildWorkingHoursPayload(schedule, notesText) {
  const payload = [];
  for (const day of schedule) {
    if (!day.enabled) {
      payload.push({
        label: day.shortLabel,
        value: 'Fechado',
        day: day.key,
      });
      continue;
    }
    const start = sanitizeTimeInput(day.start) || DEFAULT_WORKING_START;
    const end = sanitizeTimeInput(day.end) || DEFAULT_WORKING_END;
    const label = `${formatTimeDisplay(start)} - ${formatTimeDisplay(end)}`;

    const blocks = [];
    if (day.blockEnabled) {
      const blockStart = sanitizeTimeInput(day.blockStart);
      const blockEnd = sanitizeTimeInput(day.blockEnd);
      if (
        blockStart &&
        blockEnd &&
        blockStart < blockEnd &&
        blockStart >= start &&
        blockEnd <= end
      ) {
        blocks.push({ start: blockStart, end: blockEnd });
      }
    }

    payload.push({
      label: day.shortLabel,
      value: label,
      day: day.key,
      start,
      end,
      ...(blocks.length ? { blocks, breaks: blocks } : {}),
    });
  }
  const notes = String(notesText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  for (const line of notes) {
    payload.push({ label: '', value: line });
  }
  return payload;
}

export default function Configuracoes() {
  const user = getUser();
  const isEstab = user?.tipo === 'estabelecimento';
  const location = useLocation();
  const sectionRefs = useRef({});
  const focusTimeoutRef = useRef(null);

  const [planInfo, setPlanInfo] = useState({
    plan: 'starter',
    status: 'trialing',
    trialEnd: null,
    trialDaysLeft: null,
    trialWarn: false,
    allowAdvanced: false,
    activeUntil: null,
  });
  const [slug, setSlug] = useState('');
  const [msg, setMsg] = useState({ email_subject: '', email_html: '', wa_template: '' });
  const [savingMessages, setSavingMessages] = useState(false);
  const [openSections, setOpenSections] = useState({});
  const [focusedSection, setFocusedSection] = useState('');
  const [showQrCode, setShowQrCode] = useState(false);
  const [publicProfileForm, setPublicProfileForm] = useState({
    sobre: '',
    contato_email: '',
    contato_telefone: '',
    site_url: '',
    instagram_url: '',
    facebook_url: '',
    linkedin_url: '',
    youtube_url: '',
    tiktok_url: '',
    horarios_text: '',
  });
  const [publicProfileStatus, setPublicProfileStatus] = useState({ type: '', message: '' });
  const [publicProfileLoading, setPublicProfileLoading] = useState(false);
  const [publicProfileSaving, setPublicProfileSaving] = useState(false);
  const [workingHours, setWorkingHours] = useState(() => createEmptyWorkingHours());

  useEffect(() => () => {
    if (focusTimeoutRef.current) {
      clearTimeout(focusTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const target = location?.state?.focusSection;
    if (!target) return;
    setOpenSections((prev) => ({ ...prev, [target]: true }));
    setFocusedSection(target);
    const node = sectionRefs.current[target];
    if (node) {
      try {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {}
    }
    if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
    focusTimeoutRef.current = window.setTimeout(() => {
      setFocusedSection('');
      focusTimeoutRef.current = null;
    }, 2400);
  }, [location?.state?.focusSection]);

  const toggleSection = useCallback((id) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const applyPublicProfile = useCallback((profile) => {
    const { schedule, notes } = extractWorkingHoursFromProfile(profile);
    setWorkingHours(schedule);
    setPublicProfileForm({
      sobre: profile?.sobre || '',
      contato_email: profile?.contato_email || '',
      contato_telefone: profile?.contato_telefone || '',
      site_url: profile?.site_url || '',
      instagram_url: profile?.instagram_url || '',
      facebook_url: profile?.facebook_url || '',
      linkedin_url: profile?.linkedin_url || '',
      youtube_url: profile?.youtube_url || '',
      tiktok_url: profile?.tiktok_url || '',
      horarios_text: notes || '',
    });
  }, [setWorkingHours]);

  const [profileForm, setProfileForm] = useState({
    nome: '',
    email: '',
    telefone: '',
    cep: '',
    endereco: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
    avatar_url: '',
    notifyEmailEstab: Boolean(user?.notify_email_estab ?? true),
    notifyWhatsappEstab: Boolean(user?.notify_whatsapp_estab ?? true),
  });
  const [passwordForm, setPasswordForm] = useState({ atual: '', nova: '', confirmar: '' });
  const [profileStatus, setProfileStatus] = useState({ type: '', message: '' });
  const [profileSaving, setProfileSaving] = useState(false);

  const [avatarPreview, setAvatarPreview] = useState(() => resolveAssetUrl(user?.avatar_url || ''));
  const [avatarData, setAvatarData] = useState('');
  const [avatarRemove, setAvatarRemove] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const avatarInputRef = useRef(null);

  const cepLookupRef = useRef('');

  // Billing state
  const [billing, setBilling] = useState({ subscription: null, history: [] });
  const [billingLoading, setBillingLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [recurringLoading, setRecurringLoading] = useState(false);
  const [recurringError, setRecurringError] = useState('');
  const [recurringNotice, setRecurringNotice] = useState('');
  const checkoutIntentRef = useRef(false);
  // Mensagens pós-checkout (retorno do Mercado Pago)
  const [checkoutNotice, setCheckoutNotice] = useState({ kind: '', message: '', syncing: false });
  // Contagem simples para pré-validação de downgrade (serviços)
  const [serviceCount, setServiceCount] = useState(null);
  const [professionalCount, setProfessionalCount] = useState(null);
  const [changePlanTarget, setChangePlanTarget] = useState(null);
  const [changePlanPassword, setChangePlanPassword] = useState('');
  const [changePlanError, setChangePlanError] = useState('');
  const [changePlanSubmitting, setChangePlanSubmitting] = useState(false);
  // PIX fallback cycle selector
  const [pixCycle, setPixCycle] = useState('mensal');

  // Util: mapeia códigos do MP para mensagens amigáveis
  const mapStatusDetailMessage = useCallback((code) => {
    const c = String(code || '').toLowerCase();
    const generic = 'O pagamento não foi concluído. Tente novamente em seu dispositivo habitual, faça login no Mercado Pago, use outro cartão ou ative por PIX.';
    if (!c) return generic;
    if (c.includes('high_risk')) return 'Pagamento recusado por segurança. Use o dispositivo/rede que você costuma comprar, faça login no Mercado Pago ou tente outro cartão. Alternativa: ative por PIX.';
    if (c.includes('issuer') || c.includes('call_for_authorize') || c.includes('other_reason')) return 'O banco emissor recusou a transação. Tente outro cartão ou contate seu banco. Alternativa: ative por PIX.';
    if (c.includes('insufficient')) return 'Sem limite/saldo disponível no cartão. Tente outro cartão. Alternativa: ative por PIX.';
    if (c.includes('bad_filled')) return 'Dados do cartão inválidos. Revise número, validade e código (CVV).';
    if (c.includes('blacklist')) return 'Pagamento bloqueado pelo Mercado Pago. Utilize outro cartão/conta ou ative por PIX.';
    return generic;
  }, []);

  const inferMpStatusDetailFromError = useCallback((err) => {
    // tenta extrair um status_detail da mensagem/cause do backend
    try {
      const raw = (err?.data?.message || err?.message || '') + ' ' + JSON.stringify(err?.data || {});
      const m = raw.match(/cc_rejected_[a-z_]+|bad_filled_[a-z_]+|issuer|insufficient_amount|call_for_authorize|blacklist/gi);
      return m && m[0] ? String(m[0]).toLowerCase() : '';
    } catch { return ''; }
  }, []);

  // Elegibilidade a teste grátis: somente Starter, sem trial em andamento e sem histórico de plano pago
  const hasPaidHistory = useMemo(() => {
    try {
      if (!Array.isArray(billing?.history)) return false;
      return billing.history.some((h) => {
        const planPaid = h?.plan === 'pro' || h?.plan === 'premium';
        const status = String(h?.status || '').toLowerCase();
        const consideredAsContracted = ['active', 'authorized', 'paused', 'past_due', 'canceled', 'expired'].includes(status);
        return planPaid && consideredAsContracted;
      });
    } catch { return false; }
  }, [billing?.history]);
  const trialEligible = useMemo(() => {
    const isStarter = planInfo.plan === 'starter';
    const noTrialRunning = !planInfo.trialEnd;
    return isStarter && noTrialRunning && !hasPaidHistory;
  }, [planInfo.plan, planInfo.trialEnd, hasPaidHistory]);
  const hasActiveSubscription = useMemo(() => {
    const statusPlan = String(planInfo.status || '').toLowerCase();
    const statusSub = String(billing?.subscription?.status || '').toLowerCase();
    return statusPlan === 'active' || statusSub === 'active';
  }, [planInfo.status, billing?.subscription?.status]);
  const hasPreapprovalInHistory = useMemo(() => {
    try {
      const items = Array.isArray(billing?.history) ? billing.history : [];
      return items.some((h) => {
        const st = String(h?.status || '').toLowerCase();
        return h?.gateway_subscription_id && (st === 'active' || st === 'authorized' || st === 'paused' || st === 'past_due');
      });
    } catch { return false; }
  }, [billing?.history]);
  const hasGatewaySub = !!(billing?.subscription?.gateway_subscription_id);
  const hasGatewayRecurring = useMemo(() => hasGatewaySub || hasPreapprovalInHistory, [hasGatewaySub, hasPreapprovalInHistory]);
  const needsRecurringSetup = useMemo(() => {
    return hasActiveSubscription && !hasGatewayRecurring; // ativo (por plano ou MP) e sem preapproval
  }, [hasActiveSubscription, hasGatewayRecurring]);
  const subStatus = useMemo(() => String(billing?.subscription?.status || '').toLowerCase(), [billing?.subscription?.status]);

  // Assinatura ativa (evita acionar checkout padrão e resultar em 409 "already_active")

  // Metadados dos planos (espelha backend)
  const PLAN_META = {
    starter: { label: 'Starter', maxServices: 10, maxProfessionals: 2 },
    pro: { label: 'Pro', maxServices: 100, maxProfessionals: 10 },
    premium: { label: 'Premium', maxServices: null, maxProfessionals: null },
  };
  const PLAN_TIERS = Object.keys(PLAN_META);
  const planLabel = (p) => PLAN_META[p]?.label || p?.toUpperCase() || '';
  const exceedsServices = (target) => {
    const limit = PLAN_META[target]?.maxServices;
    if (limit == null) return false;
    if (serviceCount == null) return false;
    return serviceCount > limit;
  };
  const exceedsProfessionals = (target) => {
    const limit = PLAN_META[target]?.maxProfessionals;
    if (limit == null) return false;
    if (professionalCount == null) return false;
    return professionalCount > limit;
  };

  useEffect(() => {
    try {
      const plan = localStorage.getItem('plan_current') || 'starter';
      const status = localStorage.getItem('plan_status') || 'trialing';
      const trialEnd = localStorage.getItem('trial_end');
      const daysLeft = trialEnd ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - Date.now()) / 86400000)) : null;
      setPlanInfo((prev) => ({
        ...prev,
        plan,
        status,
        trialEnd,
        trialDaysLeft: daysLeft,
        trialWarn: daysLeft != null ? daysLeft <= 3 : prev.trialWarn,
      }));
    } catch {}
  }, []);

  useEffect(() => {
    if (!user) return;
    setProfileForm({
      nome: user.nome || '',
      email: user.email || '',
      telefone: formatPhoneLabel(user.telefone || ''),
      cep: formatCep(user.cep || ''),
      endereco: user.endereco || '',
      numero: user.numero || '',
      complemento: user.complemento || '',
      bairro: user.bairro || '',
      cidade: user.cidade || '',
      estado: (user.estado || '').toUpperCase(),
      avatar_url: user.avatar_url || '',
      notifyEmailEstab: Boolean(user.notify_email_estab ?? true),
      notifyWhatsappEstab: Boolean(user.notify_whatsapp_estab ?? true),
    });
    setAvatarPreview(resolveAssetUrl(user.avatar_url || ''));
    setAvatarData('');
    setAvatarRemove(false);
    setAvatarError('');
  }, [user?.id]);

  useEffect(() => {
    if (!isEstab) {
      cepLookupRef.current = '';
      return;
    }
    const digits = profileForm.cep.replace(/\D/g, '');
    if (digits.length !== 8) {
      cepLookupRef.current = '';
      return;
    }
    if (cepLookupRef.current === digits) return;
    cepLookupRef.current = digits;
    let active = true;
    fetch(`https://viacep.com.br/ws/${digits}/json/`)
      .then((res) => res.json())
      .then((data) => {
        if (!active || !data || data.erro) return;
        setProfileForm((prev) => ({
          ...prev,
          cep: formatCep(digits),
          endereco: data.logradouro || prev.endereco,
          bairro: data.bairro || prev.bairro,
          cidade: data.localidade || prev.cidade,
          estado: (data.uf || prev.estado || '').toUpperCase(),
        }));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [isEstab, profileForm.cep]);


  const fetchBilling = useCallback(async () => {
    if (!isEstab || !user?.id) return null;
    try {
      setBillingLoading(true);
      const data = await Api.billingSubscription();
      if (data?.plan) {
        setPlanInfo((prev) => {
          const nextStatus = data.plan.status || prev.status;
          const nextPlan = nextStatus === 'active' ? (data.plan.plan || prev.plan) : prev.plan;
          const next = {
            ...prev,
            plan: nextPlan,
            status: nextStatus,
            trialEnd: data.plan.trial?.ends_at || prev.trialEnd,
            trialDaysLeft: typeof data.plan.trial?.days_left === 'number' ? data.plan.trial.days_left : prev.trialDaysLeft,
            trialWarn: !!data.plan.trial?.warn,
            allowAdvanced: !!data.plan.limits?.allowAdvancedReports,
            activeUntil: data.plan.active_until || prev.activeUntil,
          };
          try {
            localStorage.setItem('plan_current', next.plan);
            localStorage.setItem('plan_status', next.status);
            if (next.trialEnd) localStorage.setItem('trial_end', next.trialEnd);
            else localStorage.removeItem('trial_end');
          } catch {}
          return next;
        });
      }
      setBilling({
        subscription: data?.subscription || null,
        history: Array.isArray(data?.history) ? data.history : [],
      });
      return data;
    } catch (err) {
      console.error('billingSubscription failed', err);
      throw err;
    } finally {
      setBillingLoading(false);
    }
  }, [isEstab, user?.id]);

  useEffect(() => {
    (async () => {
      if (!isEstab || !user?.id) return;
      // Se voltamos do checkout com preapproval_id, sincroniza estado antes de carregar
      try {
        const url = new URL(window.location.href);
        const preId = url.searchParams.get('preapproval_id');
        if (preId) {
          await Api.billingSync(preId);
        }
        // Banner pós-retorno: checkout=sucesso|erro|pendente
        const chk = (url.searchParams.get('checkout') || '').toLowerCase();
        if (chk === 'sucesso') {
          setCheckoutNotice({ kind: 'info', message: 'Pagamento aprovado. Sincronizando sua assinatura...', syncing: true });
          // Poll curto para refletir ativação
          const tryPoll = async () => {
            let activated = false;
            for (let i = 0; i < 6; i++) {
              try {
                const data = await Api.billingSubscription();
                const planStatus = String(data?.plan?.status || '').toLowerCase();
                const subStatus = String(data?.subscription?.status || '').toLowerCase();
                if (planStatus === 'active' || subStatus === 'active' || subStatus === 'authorized') {
                  activated = true;
                  break;
                }
              } catch {}
              await new Promise((r) => setTimeout(r, 1500));
            }
            if (activated) setCheckoutNotice({ kind: 'success', message: 'Assinatura atualizada com sucesso!', syncing: false });
            else setCheckoutNotice({ kind: 'warn', message: 'Estamos processando sua assinatura. Ela deve atualizar em instantes.', syncing: false });
          };
          try { await tryPoll(); } catch {}
          // Limpa o parâmetro da URL após tratar
          try { url.searchParams.delete('checkout'); window.history.replaceState({}, '', url.toString()); } catch {}
        } else if (chk === 'erro') {
          setCheckoutNotice({
            kind: 'error',
            message: 'O pagamento não foi concluído. Tente novamente no seu dispositivo habitual, faça login no Mercado Pago, use outro cartão ou ative por PIX.',
            syncing: false,
          });
          try { url.searchParams.delete('checkout'); window.history.replaceState({}, '', url.toString()); } catch {}
        } else if (chk === 'pendente') {
          setCheckoutNotice({ kind: 'warn', message: 'Pagamento pendente de confirmação.', syncing: false });
          try { url.searchParams.delete('checkout'); window.history.replaceState({}, '', url.toString()); } catch {}
        }
      } catch {}
      // Carrega billing (assinatura + histórico) para habilitar botões de recorrência
      try { await fetchBilling(); } catch {}
      try {
        setPublicProfileLoading(true);
        setPublicProfileStatus({ type: '', message: '' });
        const est = await Api.getEstablishment(user.id);
        setSlug(est?.slug || '');
        const ctx = est?.plan_context;
        applyPublicProfile(est?.profile || null);
        if (ctx) {
          setPlanInfo((prev) => ({
            ...prev,
            plan: ctx.plan || 'starter',
            status: ctx.status || 'trialing',
            trialEnd: ctx.trial?.ends_at || null,
            trialDaysLeft: typeof ctx.trial?.days_left === 'number' ? ctx.trial.days_left : prev.trialDaysLeft,
            trialWarn: !!ctx.trial?.warn,
            allowAdvanced: !!ctx.limits?.allowAdvancedReports,
            allowWhatsapp: !!(ctx.features?.allow_whatsapp ?? ctx.limits?.allowWhatsApp),
            activeUntil: ctx.active_until || null,
          }));
          try {
            localStorage.setItem('plan_current', ctx.plan || 'starter');
            localStorage.setItem('plan_status', ctx.status || 'trialing');
            if (ctx.trial?.ends_at) localStorage.setItem('trial_end', ctx.trial.ends_at);
            else localStorage.removeItem('trial_end');
          } catch {}
        }
      } catch (err) {
        setPublicProfileStatus((prev) =>
          prev?.message ? prev : { type: 'error', message: 'Não foi possível carregar o perfil público.' }
        );
      } finally {
        setPublicProfileLoading(false);
      }
      // Carrega contagem de serviços/profissionais para pré-validar downgrades
      try {
        const stats = await Api.getEstablishmentStats(user.id);
        setServiceCount(typeof stats?.services === 'number' ? stats.services : 0);
        setProfessionalCount(typeof stats?.professionals === 'number' ? stats.professionals : 0);
      } catch {}
      try {
        const tmpl = await Api.getEstablishmentMessages(user.id);
        setMsg({
          email_subject: tmpl?.email_subject || '',
          email_html: tmpl?.email_html || '',
          wa_template: tmpl?.wa_template || '',
        });
      } catch {}
      try {
        await fetchBilling();
      } catch {}
    })();
  }, [isEstab, user?.id, fetchBilling, applyPublicProfile]);

  const handleCheckout = useCallback(async (targetPlan, targetCycle = 'mensal') => {
    if (!isEstab) return;
    setCheckoutError('');
    setCheckoutLoading(true);
    checkoutIntentRef.current = true;
    try {
      const payload = { plan: targetPlan, billing_cycle: targetCycle };
      const data = await Api.billingCreateCheckout(payload);
      if (data?.subscription) {
        setBilling((prev) => ({ ...prev, subscription: data.subscription }));
      }
      try {
        await fetchBilling();
      } catch {}
      if (typeof window !== 'undefined' && data?.init_point) {
        window.location.href = data.init_point;
      }
    } catch (err) {
      console.error('billing checkout failed', err);
      // Mensagem amigável quando já existe assinatura ativa
      if (err?.status === 409 && err?.data?.error === 'already_active') {
        try {
          const iso = err?.data?.plan?.active_until || err?.data?.plan?.trial?.ends_at || null;
          const msg = iso
            ? `Sua assinatura já está ativa até ${new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}.`
            : 'Sua assinatura já está ativa no momento.';
          setCheckoutError(msg);
          await fetchBilling();
        } catch {
          setCheckoutError(err?.data?.message || 'Sua assinatura já está ativa.');
        }
      } else {
        const code = inferMpStatusDetailFromError(err);
        const friendly = mapStatusDetailMessage(code);
        setCheckoutError(friendly);
      }
    } finally {
      setCheckoutLoading(false);
      checkoutIntentRef.current = false;
      try {
        localStorage.removeItem('intent_plano');
        localStorage.removeItem('intent_plano_ciclo');
      } catch {}
    }
  }, [fetchBilling, isEstab]);

  const executePlanChange = useCallback(async (targetPlan) => {
    setCheckoutError('');
    setCheckoutLoading(true);
    let success = false;
    try {
      const data = await Api.billingChangeCheckout(targetPlan);
      if (data?.init_point) {
        window.location.href = data.init_point;
        success = true;
        return success;
      }
      await fetchBilling();
      success = true;
    } catch (err) {
      if (err?.status === 409 && (err?.data?.error === 'plan_downgrade_blocked' || err?.data?.error === 'same_plan')) {
        setCheckoutError(err?.data?.message || 'Não foi possível alterar o plano.');
      } else {
        const code = inferMpStatusDetailFromError(err);
        const friendly = mapStatusDetailMessage(code);
        setCheckoutError(friendly);
      }
    } finally {
      setCheckoutLoading(false);
    }
    return success;
  }, [fetchBilling]);

  const handleChangePlan = useCallback((targetPlan) => {
    setChangePlanTarget(targetPlan);
    setChangePlanPassword('');
    setChangePlanError('');
  }, []);

  const handleCheckoutPix = useCallback(async (plan = 'pro', cycle = 'mensal') => {
    if (!isEstab || !user?.id) return false;
    setCheckoutError('');
    setCheckoutLoading(true);
    let success = false;
    try {
      const data = await Api.billingPixCheckout({ plan, billing_cycle: cycle });
      if (data?.init_point) {
        window.location.href = data.init_point;
        success = true;
        return success;
      }
      await fetchBilling();
      success = true;
    } catch (err) {
      setCheckoutError(err?.data?.message || err?.message || 'Falha ao gerar cobrança PIX.');
    } finally {
      setCheckoutLoading(false);
    }
    return success;
  }, [fetchBilling, isEstab, user?.id]);

  const closeChangePlanModal = useCallback(() => {
    if (changePlanSubmitting) return;
    setChangePlanTarget(null);
    setChangePlanPassword('');
    setChangePlanError('');
  }, [changePlanSubmitting]);

  const confirmChangePlan = useCallback(async () => {
    if (!changePlanTarget) return;
    if (!user?.email) {
      setChangePlanError('Sessão expirada. Faça login novamente.');
      return;
    }
    if (!changePlanPassword) {
      setChangePlanError('Informe sua senha para confirmar.');
      return;
    }
    setChangePlanError('');
    setChangePlanSubmitting(true);
    try {
      const loginRes = await Api.login(user.email, changePlanPassword);
      if (!loginRes?.token) {
        setChangePlanError('Não foi possível validar sua senha.');
        return;
      }
      saveToken(loginRes.token);
      if (loginRes.user) saveUser(loginRes.user);

      const ok = await executePlanChange(changePlanTarget);
      if (ok) {
        setChangePlanTarget(null);
        setChangePlanPassword('');
      }
    } catch (err) {
      if (err?.status === 401 || err?.data?.error === 'invalid_credentials') {
        setChangePlanError('Senha incorreta. Tente novamente.');
      } else {
        setChangePlanError(err?.data?.message || err?.message || 'Falha ao validar senha.');
      }
    } finally {
      setChangePlanSubmitting(false);
    }
  }, [changePlanTarget, changePlanPassword, executePlanChange, user?.email]);

  useEffect(() => {
    if (!isEstab) return;
    let storedPlan = null;
    let storedCycle = 'mensal';
    try { storedPlan = localStorage.getItem('intent_plano'); } catch {}
    try {
      const rawCycle = localStorage.getItem('intent_plano_ciclo');
      if (rawCycle) storedCycle = rawCycle;
    } catch {}
    if (storedPlan && !checkoutIntentRef.current) {
      checkoutIntentRef.current = true;
      (async () => {
        try {
          // Se há assinatura ativa e o plano desejado difere do atual, usar rota de change
          if (planInfo.status === 'active' && storedPlan !== planInfo.plan) {
            const data = await Api.billingChangeCheckout(storedPlan, storedCycle);
            if (data?.init_point) window.location.href = data.init_point;
          } else {
            await handleCheckout(storedPlan, storedCycle);
          }
        } finally {
          try {
            localStorage.removeItem('intent_plano');
            localStorage.removeItem('intent_plano_ciclo');
          } catch {}
          checkoutIntentRef.current = false;
        }
      })();
    }
  }, [handleCheckout, isEstab, planInfo.status, planInfo.plan]);
  const daysLeft = useMemo(() => {
    if (planInfo.trialDaysLeft != null) return planInfo.trialDaysLeft;
    if (!planInfo.trialEnd) return 0;
    const diff = new Date(planInfo.trialEnd).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
  }, [planInfo.trialDaysLeft, planInfo.trialEnd]);

  const fmtDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';

  const publicLink = useMemo(() => {
    if (!user) return '';
    const id = user.id ? String(user.id) : '';
    if (!id) return '';
    let origin = 'https://agendamentosonline.com';
    if (typeof window !== 'undefined') {
      const currentOrigin = window.location?.origin || '';
      if (currentOrigin.includes('agendamentosonline.com')) origin = currentOrigin;
    }
    const slugSource = slug || user?.nome || '';
    const targetSlug = toSlug(slugSource || `estabelecimento-${id}`);
    try {
      const url = new URL(`/novo/${targetSlug}`, origin);
      url.searchParams.set('estabelecimento', id);
      return url.toString();
    } catch (err) {
      console.error('publicLink generation failed', err);
      return '';
    }
  }, [slug, user?.id, user?.nome]);

  const qrCodeUrl = useMemo(() => {
    if (!publicLink) return '';
    const params = new URLSearchParams({ size: '320x320', data: publicLink });
    return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`;
  }, [publicLink]);

  const handleCopyPublicLink = useCallback(async () => {
    if (!publicLink) return;
    try {
      await navigator.clipboard.writeText(publicLink);
      showToast('success', 'Link copiado para a área de transferência.');
    } catch (err) {
      console.error('copy public link failed', err);
      showToast('error', 'Não foi possível copiar o link agora.');
    }
  }, [publicLink]);

  useEffect(() => {
    setShowQrCode(false);
  }, [publicLink]);

  const startTrial = useCallback(async () => {
    if (!isEstab || !user?.id) return;
    try {
      const response = await Api.updateEstablishmentPlan(user.id, { plan: 'pro', status: 'trialing', trialDays: 7 });
      const ctx = response?.plan;
      if (ctx) {
        setPlanInfo((prev) => ({
          ...prev,
          plan: ctx.plan || 'starter',
          status: ctx.status || 'trialing',
          trialEnd: ctx.trial?.ends_at || null,
          trialDaysLeft: typeof ctx.trial?.days_left === 'number' ? ctx.trial.days_left : prev.trialDaysLeft,
          trialWarn: !!ctx.trial?.warn,
          allowAdvanced: !!ctx.limits?.allowAdvancedReports,
          activeUntil: ctx.active_until || null,
        }));
        try {
          localStorage.setItem('plan_current', ctx.plan || 'starter');
          localStorage.setItem('plan_status', ctx.status || 'trialing');
          if (ctx.trial?.ends_at) localStorage.setItem('trial_end', ctx.trial.ends_at);
          else localStorage.removeItem('trial_end');
        } catch {}
      }
      await fetchBilling();
      alert('Teste gratuito do plano Pro ativado por 7 dias!');
    } catch (err) {
      console.error('startTrial failed', err);
      alert('Nao foi possivel iniciar o teste gratuito agora.');
    }
  }, [isEstab, user?.id, fetchBilling]);

  const handleProfileChange = (key, value) => {
    setProfileForm((prev) => ({ ...prev, [key]: value }));
  };

  const handlePublicProfileChange = useCallback((key, value) => {
    setPublicProfileForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleWorkingHoursToggle = useCallback((dayKey, enabled) => {
    setWorkingHours((prev) =>
      prev.map((day) =>
        day.key === dayKey
          ? { ...day, enabled, blockEnabled: enabled ? day.blockEnabled : false }
          : day
      )
    );
  }, []);

  const handleWorkingHoursTimeChange = useCallback((dayKey, field, value) => {
    const sanitized = sanitizeTimeInput(value);
    setWorkingHours((prev) =>
      prev.map((day) =>
        day.key === dayKey
          ? { ...day, [field]: sanitized }
          : day
      )
    );
  }, []);

  const handleWorkingHoursBlockToggle = useCallback((dayKey, enabled) => {
    setWorkingHours((prev) =>
      prev.map((day) =>
        day.key === dayKey
          ? { ...day, blockEnabled: enabled }
          : day
      )
    );
  }, []);

  const handleWorkingHoursBlockChange = useCallback((dayKey, field, value) => {
    const sanitized = sanitizeTimeInput(value);
    setWorkingHours((prev) =>
      prev.map((day) =>
        day.key === dayKey
          ? { ...day, [field]: sanitized }
          : day
      )
    );
  }, []);

  const handleAvatarFile = useCallback((event) => {
    const input = event?.target || null;
    const file = input?.files?.[0];
    if (!file) return;
    setAvatarError('');
    const type = (file.type || '').toLowerCase();
    if (!/^image\/(png|jpe?g|webp)$/.test(type)) {
      setAvatarError('Selecione uma imagem PNG, JPG ou WEBP.');
      if (input) input.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError('A imagem deve ter no máximo 2MB.');
      if (input) input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        setAvatarPreview(result);
        setAvatarData(result);
        setAvatarRemove(false);
        setProfileForm((prev) => ({ ...prev, avatar_url: '' }));
      } else {
        setAvatarError('Falha ao processar a imagem.');
      }
    };
    reader.onerror = () => {
      setAvatarError('Falha ao processar a imagem.');
    };
    reader.onloadend = () => {
      if (input) input.value = '';
    };
    reader.readAsDataURL(file);
  }, []);

  const handleAvatarPick = useCallback(() => {
    setAvatarError('');
    const input = avatarInputRef.current;
    if (input) input.click();
  }, []);

  const handleAvatarRemove = useCallback(() => {
    setAvatarPreview('');
    setAvatarData('');
    setAvatarRemove(true);
    setAvatarError('');
    setProfileForm((prev) => ({ ...prev, avatar_url: '' }));
    const input = avatarInputRef.current;
    if (input) input.value = '';
  }, []);

  const handlePasswordChange = (key, value) => {
    setPasswordForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveProfile = async (event) => {
    event.preventDefault();
    setProfileStatus({ type: '', message: '' });

    if (!passwordForm.atual) {
      setProfileStatus({ type: 'error', message: 'Informe a senha atual para salvar as alteracoes.' });
      return;
    }
    if (passwordForm.nova && passwordForm.nova !== passwordForm.confirmar) {
      setProfileStatus({ type: 'error', message: 'A nova senha e a confirmacao nao coincidem.' });
      return;
    }

    const telefoneNorm = normalizePhone(profileForm.telefone);
    const cepDigits = profileForm.cep.replace(/\D/g, '');

    try {
      setProfileSaving(true);
      const payload = {
        nome: profileForm.nome.trim(),
        email: profileForm.email.trim(),
        telefone: telefoneNorm,
        senhaAtual: passwordForm.atual,
        senhaNova: passwordForm.nova || undefined,
        cep: cepDigits || undefined,
        endereco: profileForm.endereco.trim() || undefined,
        numero: profileForm.numero.trim() || undefined,
        complemento: profileForm.complemento.trim() || undefined,
      bairro: profileForm.bairro.trim() || undefined,
      cidade: profileForm.cidade.trim() || undefined,
      estado: profileForm.estado.trim().toUpperCase() || undefined,
    };
    if (isEstab) {
      payload.notifyEmailEstab = !!profileForm.notifyEmailEstab;
      payload.notifyWhatsappEstab = !!profileForm.notifyWhatsappEstab;
    }
      if (avatarData) {
        payload.avatar = avatarData;
      } else if (avatarRemove && !avatarData) {
        payload.avatarRemove = true;
      }
      const response = await Api.updateProfile(payload);
      if (response?.user) {
        const updatedUser = response.user;
        saveUser(updatedUser);
        setProfileForm((prev) => ({
          ...prev,
          avatar_url: updatedUser.avatar_url || '',
          notifyEmailEstab: Boolean(updatedUser.notify_email_estab ?? prev.notifyEmailEstab),
          notifyWhatsappEstab: Boolean(updatedUser.notify_whatsapp_estab ?? prev.notifyWhatsappEstab),
        }));
        setAvatarPreview(resolveAssetUrl(updatedUser.avatar_url || ''));
        setAvatarData('');
        setAvatarRemove(false);
        setAvatarError('');
      }
      if (avatarInputRef.current) {
        avatarInputRef.current.value = '';
      }
      handlePasswordChange('atual', '');
      handlePasswordChange('nova', '');
      handlePasswordChange('confirmar', '');
      setProfileStatus({ type: 'success', message: 'Perfil atualizado com sucesso.' });
      if (response?.emailConfirmation?.pending) {
        setProfileStatus({
          type: 'success',
          message: 'Perfil atualizado. Confirme o novo email com o codigo enviado.',
        });
      }
    } catch (e) {
      const msg = e?.message || 'Falha ao atualizar perfil.';
      setProfileStatus({ type: 'error', message: msg });
      if (typeof msg === 'string' && msg.toLowerCase().includes('imagem')) {
        setAvatarError(msg);
      }
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSavePublicProfile = useCallback(async (event) => {
    event?.preventDefault();
    if (!isEstab) return;
    setPublicProfileStatus({ type: '', message: '' });
    const scheduleError = validateWorkingHours(workingHours);
    if (scheduleError) {
      setPublicProfileStatus({ type: 'error', message: scheduleError });
      return;
    }
    setPublicProfileSaving(true);
    try {
      const phoneDigits = publicProfileForm.contato_telefone
        ? normalizePhone(publicProfileForm.contato_telefone)
        : '';
      const payload = {
        sobre: publicProfileForm.sobre?.trim() || null,
        contato_email: publicProfileForm.contato_email?.trim() || null,
        contato_telefone: phoneDigits || null,
        site_url: publicProfileForm.site_url?.trim() || null,
        instagram_url: publicProfileForm.instagram_url?.trim() || null,
        facebook_url: publicProfileForm.facebook_url?.trim() || null,
        linkedin_url: publicProfileForm.linkedin_url?.trim() || null,
        youtube_url: publicProfileForm.youtube_url?.trim() || null,
        tiktok_url: publicProfileForm.tiktok_url?.trim() || null,
        horarios: buildWorkingHoursPayload(workingHours, publicProfileForm.horarios_text),
      };
      const response = await Api.updateEstablishmentProfile(user.id, payload);
      if (response?.profile) {
        applyPublicProfile(response.profile);
      }
      setPublicProfileStatus({ type: 'success', message: 'Perfil público atualizado com sucesso.' });
    } catch (err) {
      const msg = err?.data?.message || err?.message || 'Falha ao atualizar perfil público.';
      setPublicProfileStatus({ type: 'error', message: msg });
    } finally {
      setPublicProfileSaving(false);
    }
  }, [applyPublicProfile, isEstab, publicProfileForm, user?.id, workingHours]);

  const sections = useMemo(() => {
    const list = [];

    const statusLabelMap = {
      trialing: 'Teste gratuito',
      active: 'Ativo',
      delinquent: 'Pagamento em atraso',
      pending: 'Pagamento pendente',
      canceled: 'Cancelado',
      expired: 'Expirado',
    };
    // Se a assinatura do MP estiver ativa/autorizada, tratamos como ativo para exibição
    const subStatusRaw = String(billing.subscription?.status || '').toLowerCase();
    const subscriptionIsActive = subStatusRaw === 'active' || subStatusRaw === 'authorized';
    const effectivePlanStatus = subscriptionIsActive ? 'active' : (planInfo.status || '');
    const statusLabel = statusLabelMap[effectivePlanStatus] || (effectivePlanStatus ? effectivePlanStatus.toUpperCase() : '');
    const subscriptionStatusLabel = billing.subscription?.status
      ? statusLabelMap[billing.subscription.status] || billing.subscription.status.toUpperCase()
      : null;
    const nextChargeLabel = billing.subscription?.current_period_end ? fmtDate(billing.subscription.current_period_end) : null;
    const amountLabel =
      typeof billing.subscription?.amount_cents === 'number'
        ? (billing.subscription.amount_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : null;

    list.push({
      id: 'profile',
      title: 'Perfil e Segurança',
      content: (
        <form onSubmit={handleSaveProfile} className="grid" style={{ gap: 10 }}>
          <div className="profile-avatar">
            <div className="profile-avatar__preview" aria-live="polite">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Foto do perfil" />
              ) : (
                <span>Sem foto</span>
              )}
            </div>
            <div className="profile-avatar__controls">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarFile}
                style={{ display: 'none' }}
              />
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn--outline btn--sm" onClick={handleAvatarPick}>Selecionar foto</button>
                {avatarPreview && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={handleAvatarRemove}>Remover</button>
                )}
              </div>
              {avatarError ? (
                <span className="profile-avatar__error">{avatarError}</span>
              ) : (
                <span className="profile-avatar__hint">PNG, JPG ou WEBP ate 2MB.</span>
              )}
            </div>
          </div>
          <label className="label">
            <span>Nome</span>
            <input className="input" value={profileForm.nome} onChange={(e) => handleProfileChange('nome', e.target.value)} required />
          </label>
          <label className="label">
            <span>Email</span>
            <input className="input" type="email" value={profileForm.email} onChange={(e) => handleProfileChange('email', e.target.value)} required />
          </label>
          <label className="label">
            <span>Telefone (WhatsApp)</span>
            <input
              className="input"
              value={formatPhoneLabel(profileForm.telefone)}
              onChange={(e) => handleProfileChange('telefone', e.target.value)}
              inputMode="tel"
              required
            />
          </label>
          {isEstab && (
            <>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="label" style={{ flex: '1 1 160px' }}>
                  <span>CEP</span>
                  <input
                    className="input"
                    value={profileForm.cep}
                    onChange={(e) => handleProfileChange('cep', formatCep(e.target.value))}
                    required
                    inputMode="numeric"
                  />
                </label>
                <label className="label" style={{ flex: '1 1 240px' }}>
                  <span>Endereco</span>
                  <input className="input" value={profileForm.endereco} onChange={(e) => handleProfileChange('endereco', e.target.value)} required />
                </label>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="label" style={{ flex: '0 1 120px' }}>
                  <span>NÃºmero</span>
                  <input className="input" value={profileForm.numero} onChange={(e) => handleProfileChange('numero', e.target.value)} required />
                </label>
                <label className="label" style={{ flex: '1 1 200px' }}>
                  <span>Complemento</span>
                  <input className="input" value={profileForm.complemento} onChange={(e) => handleProfileChange('complemento', e.target.value)} />
                </label>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="label" style={{ flex: '1 1 200px' }}>
                  <span>Bairro</span>
                  <input className="input" value={profileForm.bairro} onChange={(e) => handleProfileChange('bairro', e.target.value)} required />
                </label>
                <label className="label" style={{ flex: '1 1 200px' }}>
                  <span>Cidade</span>
                  <input className="input" value={profileForm.cidade} onChange={(e) => handleProfileChange('cidade', e.target.value)} required />
                </label>
                <label className="label" style={{ width: 80 }}>
                  <span>Estado</span>
                  <input className="input" value={profileForm.estado} onChange={(e) => handleProfileChange('estado', e.target.value.toUpperCase().slice(0, 2))} required />
                </label>
              </div>
              <div className="box" style={{ display: 'grid', gap: 8 }}>
                <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em' }}>Notificações</div>
                <p className="small muted" style={{ margin: 0 }}>
                  Escolha como deseja ser avisado sempre que um novo agendamento for criado ou cancelado.
                </p>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={!!profileForm.notifyEmailEstab}
                    onChange={(e) => handleProfileChange('notifyEmailEstab', e.target.checked)}
                  />
                  <span>Receber notificações por email</span>
                </label>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={!!profileForm.notifyWhatsappEstab}
                    onChange={(e) => handleProfileChange('notifyWhatsappEstab', e.target.checked)}
                  />
                  <span>Receber notificações no WhatsApp</span>
                </label>
              </div>
            </>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="label" style={{ flex: '1 1 240px' }}>
              <span>Senha atual</span>
              <input className="input" type="password" value={passwordForm.atual} onChange={(e) => handlePasswordChange('atual', e.target.value)} required />
            </label>
            <label className="label" style={{ flex: '1 1 240px' }}>
              <span>Nova senha (opcional)</span>
              <input className="input" type="password" value={passwordForm.nova} onChange={(e) => handlePasswordChange('nova', e.target.value)} />
            </label>
            <label className="label" style={{ flex: '1 1 240px' }}>
              <span>Confirmar nova senha</span>
              <input className="input" type="password" value={passwordForm.confirmar} onChange={(e) => handlePasswordChange('confirmar', e.target.value)} />
            </label>
          </div>
          {profileStatus.message && (
            <div className={`notice notice--${profileStatus.type}`} role="alert">{profileStatus.message}</div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="submit" className="btn btn--primary" disabled={profileSaving}>
              {profileSaving ? <span className="spinner" /> : 'Salvar alterações'}
            </button>
          </div>
        </form>
      ),
    });

    if (isEstab) {
      list.push({
        id: 'public-profile',
        title: 'Perfil público do estabelecimento',
        content: (
          <form onSubmit={handleSavePublicProfile} className="grid" style={{ gap: 10 }}>
            {publicProfileLoading && (
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="spinner" aria-hidden />
                <span className="muted" style={{ fontSize: 13 }}>Carregando informações públicas…</span>
              </div>
            )}
            {!publicProfileLoading && publicLink && (
              <div className="public-link-box">
                <div className="public-link-box__row">
                  <div>
                    <span className="public-link-box__label">Link da página pública</span>
                    <a className="public-link-box__url" href={publicLink} target="_blank" rel="noreferrer">
                      {publicLink}
                    </a>
                  </div>
                  <div className="public-link-box__actions">
                    <button type="button" className="btn btn--outline btn--sm" onClick={handleCopyPublicLink}>
                      Copiar link
                    </button>
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowQrCode((value) => !value)}>
                      {showQrCode ? 'Ocultar QR Code' : 'Gerar QR Code'}
                    </button>
                  </div>
                </div>
                {showQrCode && qrCodeUrl && (
                  <div className="public-link-box__qr">
                    <img src={qrCodeUrl} alt="QR Code do link público do estabelecimento" />
                    <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
                      <a
                        className="btn btn--outline btn--sm"
                        href={qrCodeUrl}
                        download={`qr-${slug || user?.id || 'estabelecimento'}.png`}
                      >
                        Baixar PNG
                      </a>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => window.open(qrCodeUrl, '_blank', 'noopener')}
                      >
                        Abrir em nova guia
                      </button>
                    </div>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Compartilhe ou imprima o QR Code para clientes acessarem a página de agendamento.
                    </span>
                  </div>
                )}
              </div>
            )}
            <label className="label">
              <span>Sobre o estabelecimento</span>
              <textarea
                className="input"
                rows={4}
                maxLength={1200}
                value={publicProfileForm.sobre}
                onChange={(e) => handlePublicProfileChange('sobre', e.target.value)}
                disabled={publicProfileLoading || publicProfileSaving}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                {`${publicProfileForm.sobre.length}/1200 caracteres`}
              </span>
            </label>
            <div className="grid" style={{ gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label className="label">
                <span>Email público</span>
                <input
                  className="input"
                  type="email"
                  value={publicProfileForm.contato_email}
                  onChange={(e) => handlePublicProfileChange('contato_email', e.target.value)}
                  disabled={publicProfileLoading || publicProfileSaving}
                  placeholder="contato@exemplo.com"
                />
              </label>
              <label className="label">
                <span>Telefone público (WhatsApp)</span>
                <input
                  className="input"
                  value={formatPhoneLabel(publicProfileForm.contato_telefone)}
                  onChange={(e) => handlePublicProfileChange('contato_telefone', e.target.value)}
                  disabled={publicProfileLoading || publicProfileSaving}
                  inputMode="tel"
                  placeholder="(11) 91234-5678"
                />
              </label>
            </div>
            <div className="label">
              <span>Horários de funcionamento</span>
              <div className="working-hours">
                {workingHours.map((day) => (
                  <div key={day.key} className="working-hours__row">
                    <label className="working-hours__day">
                      <input
                        type="checkbox"
                        checked={day.enabled}
                        onChange={(e) => handleWorkingHoursToggle(day.key, e.target.checked)}
                        disabled={publicProfileLoading || publicProfileSaving}
                      />
                      <span>{day.label}</span>
                    </label>
                    <div className="working-hours__time">
                      <input
                        type="time"
                        className="input"
                        value={day.start}
                        onChange={(e) => handleWorkingHoursTimeChange(day.key, 'start', e.target.value)}
                        disabled={publicProfileLoading || publicProfileSaving || !day.enabled}
                      />
                      <span className="working-hours__separator">as</span>
                      <input
                        type="time"
                        className="input"
                        value={day.end}
                        onChange={(e) => handleWorkingHoursTimeChange(day.key, 'end', e.target.value)}
                        disabled={publicProfileLoading || publicProfileSaving || !day.enabled}
                      />
                    </div>
                    <div className="working-hours__break">
                      <label className="switch working-hours__break-toggle">
                        <input
                          type="checkbox"
                          checked={day.blockEnabled}
                          onChange={(e) => handleWorkingHoursBlockToggle(day.key, e.target.checked)}
                          disabled={publicProfileLoading || publicProfileSaving || !day.enabled}
                        />
                        <span>Trava de horario</span>
                      </label>
                      {day.blockEnabled && (
                        <div className="working-hours__break-range">
                          <input
                            type="time"
                            className="input"
                            value={day.blockStart}
                            onChange={(e) => handleWorkingHoursBlockChange(day.key, 'blockStart', e.target.value)}
                            disabled={publicProfileLoading || publicProfileSaving || !day.enabled}
                          />
                          <span className="working-hours__separator">as</span>
                          <input
                            type="time"
                            className="input"
                            value={day.blockEnd}
                            onChange={(e) => handleWorkingHoursBlockChange(day.key, 'blockEnd', e.target.value)}
                            disabled={publicProfileLoading || publicProfileSaving || !day.enabled}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <span className="muted" style={{ fontSize: 12 }}>
                Ative os dias em que atende e informe os horarios.
              </span>
            </div>
            <label className="label">
              <span>Observações (opcional)</span>
              <textarea
                className="input"
                rows={3}
                value={publicProfileForm.horarios_text}
                onChange={(e) => handlePublicProfileChange('horarios_text', e.target.value)}
                disabled={publicProfileLoading || publicProfileSaving}
                placeholder={'Plantoes, feriados ou orientacoes especiais'}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                Essas observações aparecem junto aos horários no agendamento.
              </span>
            </label>
            <div className="grid" style={{ gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label className="label">
                <span>Site</span>
                <input
                  className="input"
                  type="url"
                  value={publicProfileForm.site_url}
                  onChange={(e) => handlePublicProfileChange('site_url', e.target.value)}
                  disabled={publicProfileLoading || publicProfileSaving}
                  placeholder="https://seusite.com"
                />
              </label>
              <label className="label">
                <span>Instagram</span>
                <input
                  className="input"
                  value={publicProfileForm.instagram_url}
                  onChange={(e) => handlePublicProfileChange('instagram_url', e.target.value)}
                  disabled={publicProfileLoading || publicProfileSaving}
                  placeholder="https://instagram.com/seuperfil"
                />
              </label>
              <label className="label">
                <span>Facebook</span>
                <input
                  className="input"
                  value={publicProfileForm.facebook_url}
                  onChange={(e) => handlePublicProfileChange('facebook_url', e.target.value)}
                  disabled={publicProfileLoading || publicProfileSaving}
                  placeholder="https://facebook.com/seupagina"
                />
              </label>
              <label className="label">
                <span>LinkedIn</span>
                <input
                  className="input"
                  value={publicProfileForm.linkedin_url}
                  onChange={(e) => handlePublicProfileChange('linkedin_url', e.target.value)}
                  disabled={publicProfileLoading || publicProfileSaving}
                  placeholder="https://linkedin.com/company/seuperfil"
                />
              </label>
              <label className="label">
                <span>YouTube</span>
                <input
                  className="input"
                  value={publicProfileForm.youtube_url}
                  onChange={(e) => handlePublicProfileChange('youtube_url', e.target.value)}
                  disabled={publicProfileLoading || publicProfileSaving}
                  placeholder="https://youtube.com/@seucanal"
                />
              </label>
              <label className="label">
                <span>TikTok</span>
                <input
                  className="input"
                  value={publicProfileForm.tiktok_url}
                  onChange={(e) => handlePublicProfileChange('tiktok_url', e.target.value)}
                  disabled={publicProfileLoading || publicProfileSaving}
                  placeholder="https://www.tiktok.com/@seuperfil"
                />
              </label>
            </div>
            {publicProfileStatus.message && (
              <div className={`notice notice--${publicProfileStatus.type}`} role="alert">
                {publicProfileStatus.message}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={publicProfileSaving}
              >
                {publicProfileSaving ? <span className="spinner" /> : 'Salvar perfil público'}
              </button>
            </div>
          </form>
        ),
      });
    }

    if (isEstab) {
      const planTierLabel = PLAN_META[planInfo.plan]?.label || planInfo.plan.toUpperCase();
      const whatsappFeature = planInfo.plan === 'starter' ? 'Lembretes por WhatsApp' : 'WhatsApp com lembretes e campanhas';
      const reportsFeature = planInfo.allowAdvanced ? 'Relatórios avançados' : 'Relatórios básicos';
      const servicesLimit = PLAN_META[planInfo.plan]?.maxServices;
      const professionalsLimit = PLAN_META[planInfo.plan]?.maxProfessionals;
      const usageText = 'Seu uso: ' + (serviceCount == null ? '...' : serviceCount) + ' serviços · ' + (professionalCount == null ? '...' : professionalCount) + ' profissionais';
      const limitsText = 'Limites do plano ' + planTierLabel + ': ' +
        (servicesLimit == null ? 'serviços ilimitados' : 'até ' + servicesLimit + ' serviços') + ' · ' +
        (professionalsLimit == null ? 'profissionais ilimitados' : 'até ' + professionalsLimit + ' profissionais');
      const planFeatures = [whatsappFeature, reportsFeature];
      const recurringDisplay = hasGatewayRecurring ? (subStatus === 'paused' ? 'Cartão (pausado)' : 'Cartão ativo') : 'Não configurada';
      const pricedAmount = amountLabel ? amountLabel + '/mês' : null;
      const summarySubscription = subscriptionStatusLabel
        ? subscriptionStatusLabel + (pricedAmount ? ' · ' + pricedAmount : '')
        : 'Sem cobrança recorrente';
      const nextChargeDisplay = nextChargeLabel || (planInfo.activeUntil ? fmtDate(planInfo.activeUntil) : '—');

      const planAlerts = [];
      if (billingLoading) {
        planAlerts.push({ key: 'loading', variant: 'info', message: 'Atualizando informações de cobrança...' });
      }
      if (planInfo.status === 'delinquent') planAlerts.push({ key: 'delinquent', variant: 'error', message: 'Pagamento em atraso. Regularize para manter o acesso aos recursos.' });
      if (effectivePlanStatus === 'pending') planAlerts.push({ key: 'pending', variant: 'warn', message: 'Pagamento pendente. Finalize o checkout para concluir a contratação.' });
      if (planInfo.plan === 'starter' && hasPaidHistory) planAlerts.push({ key: 'trial-blocked', variant: 'muted', message: 'Teste grátis indisponível: já houve uma assinatura contratada nesta conta.' });
      else if (planInfo.plan === 'starter' && trialEligible) planAlerts.push({ key: 'trial-available', variant: 'info', message: 'Experimente o plano Pro gratuitamente por 7 dias quando desejar.' });
      if (needsRecurringSetup && hasActiveSubscription) planAlerts.push({ key: 'rec-setup', variant: 'info', message: 'Configure a recorrência no cartão para automatizar as próximas cobranças.' });
      if (recurringError) planAlerts.push({ key: 'rec-error', variant: 'error', message: recurringError });
      else if (recurringNotice) planAlerts.push({ key: 'rec-notice', variant: 'info', message: recurringNotice });

      const planChangeButtons = [];
      if (planInfo.plan === 'starter') {
        if (!planInfo.trialEnd && trialEligible) {
          planChangeButtons.push(
            <button
              key="trial"
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={startTrial}
              disabled={planInfo.status === 'delinquent' || checkoutLoading}
            >
              {checkoutLoading ? <span className="spinner" /> : 'Ativar 7 dias grátis'}
            </button>
          );
        }
        planChangeButtons.push(
          <button
            key="upgrade-pro"
            className="btn btn--primary btn--sm"
            type="button"
            onClick={() => {
              if (hasActiveSubscription) {
                handleChangePlan('pro');
              } else {
                handleCheckout('pro');
              }
            }}
            disabled={checkoutLoading}
          >
            {checkoutLoading ? <span className="spinner" /> : 'Alterar para plano Pro'}
          </button>
        );
      } else {
        PLAN_TIERS.filter((p) => p !== planInfo.plan).forEach((p) => {
          const disabled = checkoutLoading || exceedsServices(p) || exceedsProfessionals(p);
          planChangeButtons.push(
            <button
              key={'tier-' + p}
              className="btn btn--outline btn--sm"
              type="button"
              disabled={disabled}
              title={
                exceedsServices(p)
                  ? 'Reduza seus serviços para até ' + PLAN_META[p].maxServices + ' antes de migrar para o plano ' + planLabel(p) + '.'
                  : exceedsProfessionals(p)
                  ? 'Reduza seus profissionais para até ' + PLAN_META[p].maxProfessionals + ' antes de migrar para o plano ' + planLabel(p) + '.'
                  : ''
              }
              onClick={() => handleChangePlan(p)}
            >
              {'Ir para ' + planLabel(p)}
            </button>
          );
        });
      }

      const recurringButtons = [];
      if (needsRecurringSetup) {
        recurringButtons.push(
          <button
            key="recurring-setup"
            className="btn btn--brand-outline btn--sm"
            type="button"
            onClick={async () => {
              try {
                setCheckoutLoading(true);
                const data = await Api.billingRecurringSetup();
                if (data?.init_point) window.location.href = data.init_point;
              } catch (err) {
                setCheckoutError(err?.data?.message || err?.message || 'Falha ao configurar recorrência.');
              } finally {
                setCheckoutLoading(false);
              }
            }}
            disabled={checkoutLoading}
          >
            {checkoutLoading ? <span className="spinner" /> : 'Configurar recorrência no cartão'}
          </button>
        );
      }
      if (hasGatewayRecurring) {
        if (subStatus !== 'paused') {
          recurringButtons.push(
            <button
              key="recurring-pause"
              className="btn btn--outline btn--sm"
              type="button"
              onClick={async () => {
                if (!confirm('Pausar a recorrência? Você pode retomar quando quiser.')) return;
                setRecurringError(''); setRecurringNotice(''); setRecurringLoading(true);
                try {
                  await Api.billingRecurringPause();
                  setRecurringNotice('Recorrência pausada.');
                  await fetchBilling();
                } catch (e) {
                  setRecurringError(e?.data?.message || e?.message || 'Falha ao pausar recorrência.');
                } finally {
                  setRecurringLoading(false);
                }
              }}
              disabled={recurringLoading}
            >
              {recurringLoading ? <span className="spinner" /> : 'Pausar recorrência'}
            </button>
          );
        }
        if (subStatus === 'paused') {
          recurringButtons.push(
            <button
              key="recurring-resume"
              className="btn btn--outline btn--sm"
              type="button"
              onClick={async () => {
                setRecurringError(''); setRecurringNotice(''); setRecurringLoading(true);
                try {
                  await Api.billingRecurringResume();
                  setRecurringNotice('Recorrência retomada.');
                  await fetchBilling();
                } catch (e) {
                  setRecurringError(e?.data?.message || e?.message || 'Falha ao retomar recorrência.');
                } finally {
                  setRecurringLoading(false);
                }
              }}
              disabled={recurringLoading}
            >
              {recurringLoading ? <span className="spinner" /> : 'Retomar recorrência'}
            </button>
          );
        }
        recurringButtons.push(
          <button
            key="recurring-cancel"
            className="btn btn--ghost btn--sm"
            type="button"
            onClick={async () => {
              if (!confirm('Cancelar a recorrência? Você continuará ativo até o fim do ciclo atual.')) return;
              setRecurringError(''); setRecurringNotice(''); setRecurringLoading(true);
              try {
                await Api.billingRecurringCancel();
                setRecurringNotice('Recorrência cancelada.');
                await fetchBilling();
              } catch (e) {
                setRecurringError(e?.data?.message || e?.message || 'Falha ao cancelar recorrência.');
              } finally {
                setRecurringLoading(false);
              }
            }}
            disabled={recurringLoading}
          >
            {recurringLoading ? <span className="spinner" /> : 'Cancelar recorrência'}
          </button>
        );
      }

      const secondaryActions = [
        ...recurringButtons,
        <Link key="plans-link" className="btn btn--ghost btn--sm" to="/planos">Conhecer planos</Link>,
      ];
      if (!hasActiveSubscription) {
        secondaryActions.unshift(
          <button
            key="pix-checkout"
            className="btn btn--chip btn--sm"
            type="button"
            onClick={() => handleCheckoutPix(planInfo.plan, pixCycle)}
            disabled={checkoutLoading}
            title="Gerar cobrança via PIX"
          >
            {checkoutLoading ? <span className="spinner" /> : 'Gerar PIX'}
          </button>
        );
        secondaryActions.unshift(
          <label key="pix-cycle" className="plan-card__pix-select">
            <span>Ciclo</span>
            <select value={pixCycle} onChange={(e) => setPixCycle(e.target.value)} disabled={checkoutLoading} className="input input--sm">
              <option value="mensal">Mensal</option>
              <option value="anual">Anual</option>
            </select>
          </label>
        );
      }
      const planNotice = hasActiveSubscription
        ? 'Assinatura ativa' + (planInfo.activeUntil ? ' até ' + fmtDate(planInfo.activeUntil) : '') + '.'
        : 'Finalize o pagamento para ativar sua assinatura.';

      list.push({
        id: 'plan',
        title: 'Plano do Estabelecimento',
        content: (
          <article className="plan-card">
            <header className="plan-card__header">
              <div>
                <h3 className="plan-card__title">{planTierLabel}</h3>
                <div className="plan-card__chips">
                  <span className={'chip chip--status-' + (effectivePlanStatus || 'default')}>{statusLabel || '—'}</span>
                  {subscriptionStatusLabel && (
                    <span className={'chip chip--status-' + (subStatus || 'default')}>{subscriptionStatusLabel}</span>
                  )}
                </div>
              </div>
              <span className="chip chip--tier">{planInfo.plan.toUpperCase()}</span>
            </header>

            <div className="plan-card__summary">
              <div className="plan-card__summary-item">
                <span className="plan-card__summary-label">Assinatura Mercado Pago</span>
                <strong>{summarySubscription}</strong>
              </div>
              <div className="plan-card__summary-item">
                <span className="plan-card__summary-label">Próxima cobrança</span>
                <strong>{nextChargeDisplay}</strong>
                {planInfo.activeUntil && !nextChargeLabel && <span className="plan-card__summary-extra">Plano ativo até {fmtDate(planInfo.activeUntil)}</span>}
              </div>
              <div className="plan-card__summary-item">
                <span className="plan-card__summary-label">Recorrência</span>
                <strong>{recurringDisplay}</strong>
                {!hasGatewayRecurring && hasActiveSubscription && <span className="plan-card__summary-extra">Ative para automatizar as renovações</span>}
              </div>
            </div>

            {planAlerts.map((alert) => (
              <div key={alert.key} className={'plan-card__alert plan-card__alert--' + alert.variant}>{alert.message}</div>
            ))}
            {checkoutNotice.message && (
              <div className={'plan-card__alert plan-card__alert--' + (checkoutNotice.kind || 'info')}>
                {checkoutNotice.syncing ? (<><span className="spinner" /> {checkoutNotice.message}</>) : checkoutNotice.message}
              </div>
            )}
            {checkoutError && (
              <div className="plan-card__alert plan-card__alert--error">{checkoutError}</div>
            )}

            <div className="plan-card__body">
              <div className="plan-card__features">
                <span className="plan-card__section-title">Recursos incluídos</span>
                <ul>
                  {planFeatures.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </div>
              <div className="plan-card__notice muted">{planNotice}</div>
            </div>

            <div className="plan-card__actions">
              {planChangeButtons.length > 0 && (
                <div className="plan-card__actions-group">{planChangeButtons}</div>
              )}
              {secondaryActions.length > 0 && (
                <div className="plan-card__actions-group plan-card__actions-group--secondary">{secondaryActions}</div>
              )}
            </div>

            <footer className="plan-card__foot">
              <span>{usageText}</span>
              <span>{limitsText}</span>
            </footer>
          </article>
        ),
      });
    }

    list.push({
      id: 'support',
      title: 'Ajuda',
      content: (
        <>
          <p className="muted">Tire dúvidas, veja perguntas frequentes e formas de contato.</p>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Link className="btn btn--outline" to="/ajuda">Abrir Ajuda</Link>
          </div>
        </>
      ),
    });

    return list;
  }, [
    isEstab,
    planInfo.plan,
    planInfo.status,
    planInfo.trialEnd,
    planInfo.trialDaysLeft,
    planInfo.trialWarn,
    planInfo.allowAdvanced,
    planInfo.activeUntil,
    daysLeft,
    fmtDate,
    publicLink,
    slug,
    msg,
    savingMessages,
    user?.id,
    profileForm,
    passwordForm,
    profileSaving,
    profileStatus,
    avatarPreview,
    avatarError,
    billing,
    billingLoading,
    checkoutLoading,
    checkoutError,
    startTrial,
    handleCheckout,
    handleCheckoutPix,
    handleChangePlan,
    hasPaidHistory,
    trialEligible,
    hasActiveSubscription,
    needsRecurringSetup,
    hasGatewayRecurring,
    recurringLoading,
    recurringError,
    recurringNotice,
    fetchBilling,
    pixCycle,
    focusedSection,
    publicProfileForm,
    publicProfileStatus,
    publicProfileLoading,
    publicProfileSaving,
    workingHours,
    handlePublicProfileChange,
    handleWorkingHoursToggle,
    handleWorkingHoursTimeChange,
    handleWorkingHoursBlockToggle,
    handleWorkingHoursBlockChange,
    handleSavePublicProfile,
    handleCopyPublicLink,
    qrCodeUrl,
    showQrCode,
  ]);

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Configurações</h2>
        <p className="muted" style={{ marginTop: 0 }}>Gerencie sua conta e preferências.</p>
      </div>

      {sections.map(({ id, title, content }) => {
        const isOpen = !!openSections[id];
        const isHighlighted = focusedSection === id;
        return (
          <div
            key={id}
            className={`card config-section${isHighlighted ? ' config-section--highlight' : ''}`}
            ref={(node) => {
              if (node) sectionRefs.current[id] = node;
              else delete sectionRefs.current[id];
            }}
          >
            <button
              type="button"
              className={`config-section__toggle${isOpen ? ' is-open' : ''}`}
              onClick={() => toggleSection(id)}
              aria-expanded={isOpen}
            >
              <span>{title}</span>
              <IconChevronRight className="config-section__icon" aria-hidden="true" />
            </button>
            {isOpen && <div className="config-section__content">{content}</div>}
          </div>
        );
      })}
      {changePlanTarget && (
        <Modal
          title={`Confirmar alteração para ${planLabel(changePlanTarget)}`}
          onClose={closeChangePlanModal}
          actions={[
            <button
              key="cancel"
              type="button"
              className="btn btn--outline"
              onClick={closeChangePlanModal}
              disabled={changePlanSubmitting}
            >
              Cancelar
            </button>,
            <button
              key="confirm"
              type="button"
              className="btn btn--primary"
              onClick={confirmChangePlan}
              disabled={changePlanSubmitting}
            >
              {changePlanSubmitting ? <span className="spinner" /> : 'Confirmar alteração'}
            </button>,
          ]}
        >
          <p className="muted">
            Informe sua senha para seguir com a mudança para <strong>{planLabel(changePlanTarget)}</strong>.
            Upgrades liberam recursos imediatamente e a cobrança do novo valor acontece no próximo ciclo. Downgrades passam a valer no ciclo seguinte, desde que os limites sejam atendidos.
          </p>
          <label className="label" style={{ marginTop: 12 }}>
            <span>Senha</span>
            <input
              className="input"
              type="password"
              value={changePlanPassword}
              onChange={(e) => setChangePlanPassword(e.target.value)}
              autoFocus
              disabled={changePlanSubmitting}
            />
          </label>
          {changePlanError && (
            <div className="notice notice--error" role="alert" style={{ marginTop: 12 }}>
              {changePlanError}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
