import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Api, resolveAssetUrl } from '../utils/api'
import { getUser, USER_EVENT } from '../utils/auth'
import Modal from '../components/Modal.jsx'
import CockpitOverview from '../components/estab/CockpitOverview.jsx'
import WhatsAppOptInBanner from '../components/estab/WhatsAppOptInBanner.jsx'
import { useLocation, useSearchParams } from 'react-router-dom'


const CALENDAR_TIME_ZONE = 'America/Sao_Paulo'



const DateHelpers = {

  parseLocal: (dateish) => {

    if (dateish instanceof Date) return new Date(dateish)

    if (typeof dateish === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateish)) {

      const [y, m, d] = dateish.split('-').map(Number)

      return new Date(y, m - 1, d, 0, 0, 0, 0)

    }

    return new Date(dateish)

  },

  formatLocalISO: (date) => {

    const y = date.getFullYear()

    const m = String(date.getMonth() + 1).padStart(2, '0')

    const d = String(date.getDate()).padStart(2, '0')

    return `${y}-${m}-${d}`

  },

  weekStartISO: (d = new Date()) => {

    const date = DateHelpers.parseLocal(d)

    const day = date.getDay()

    const diff = (day + 6) % 7

    date.setHours(0, 0, 0, 0)

    date.setDate(date.getDate() - diff)

    return DateHelpers.formatLocalISO(date)

  },

  toISODate: (d) => {

    const date = DateHelpers.parseLocal(d)

    date.setHours(0, 0, 0, 0)

    return DateHelpers.formatLocalISO(date)

  },

  addDays: (d, n) => {

    const date = DateHelpers.parseLocal(d)

    date.setDate(date.getDate() + n)

    return date

  },

  addMinutes: (d, n) => {

    const date = new Date(d)

    date.setMinutes(date.getMinutes() + n)

    return date

  },

  addWeeksISO: (iso, n) => DateHelpers.toISODate(DateHelpers.addDays(DateHelpers.parseLocal(iso), n * 7)),

  sameYMD: (a, b) => a.slice(0, 10) === b.slice(0, 10),

  weekDays: (isoMonday) => {

    const base = DateHelpers.parseLocal(isoMonday)

    return Array.from({ length: 7 }).map((_, i) => {

      const d = DateHelpers.addDays(base, i)

      return { iso: DateHelpers.toISODate(d), date: d }

    })

  },

  firstOfMonthISO: (d = new Date()) => {

    const dt = DateHelpers.parseLocal(d)

    dt.setDate(1)

    dt.setHours(0, 0, 0, 0)

    return DateHelpers.formatLocalISO(dt)

  },

  addMonths: (d, n) => {

    const dt = DateHelpers.parseLocal(d)

    const day = dt.getDate()

    dt.setDate(1)

    dt.setMonth(dt.getMonth() + n)

    const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate()

    dt.setDate(Math.min(day, lastDay))

    return dt

  },

  monthGrid: (monthStartIso) => {

    const first = DateHelpers.parseLocal(monthStartIso)

    first.setDate(1)

    const firstWeekday = (first.getDay() + 6) % 7

    const start = DateHelpers.addDays(first, -firstWeekday)

    const cells = []

    for (let i = 0; i < 42; i++) {

      const d = DateHelpers.addDays(start, i)

      const iso = DateHelpers.toISODate(d)

      const inMonth = d.getMonth() === first.getMonth()

      cells.push({ iso, inMonth, date: d })

    }

    return cells

  },

  isSameMonth: (isoA, isoB) => {

    const a = DateHelpers.parseLocal(isoA)

    const b = DateHelpers.parseLocal(isoB)

    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()

  },

  formatWeekLabel: (isoMonday) => {

    const days = DateHelpers.weekDays(isoMonday)

    const start = days[0].date

    const end = days[6].date

    const fmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })

    const s1 = fmt.format(start)

    const s2 = fmt.format(end)

    return `${s1} • ${s2}`.replace(/\./g, '')

  },

  formatTime: (datetime) => {

    return formatTime24h(datetime)

  },

  nowInTimeZone: (timeZone = CALENDAR_TIME_ZONE) => {

    const now = new Date()

    const parts = new Intl.DateTimeFormat('en-US', {

      timeZone,

      year: 'numeric',

      month: '2-digit',

      day: '2-digit',

      hour: '2-digit',

      minute: '2-digit',

      second: '2-digit',

      hour12: false,

    }).formatToParts(now)

    const map = {}

    parts.forEach(({ type, value }) => {

      if (type !== 'literal') map[type] = value

    })

    return new Date(

      Number(map.year),

      Number(map.month) - 1,

      Number(map.day),

      Number(map.hour),

      Number(map.minute),

      Number(map.second),

      now.getMilliseconds()

    )

  },

  isPastSlot: (datetime) => new Date(datetime).getTime() < Date.now(),

  formatDateFull: (date) =>

    new Date(date).toLocaleDateString('pt-BR', {

      weekday: 'long',

      day: '2-digit',

      month: 'long',

      year: 'numeric',

    }),

}



const formatPhoneDisplay = (value = '') => {

  let digits = String(value || '').replace(/\D/g, '')

  if (!digits) return ''

  if (digits.length > 11 && digits.startsWith('55')) {

    digits = digits.slice(2)

  }

  if (digits.length > 11) {

    digits = digits.slice(-11)

  }

  if (digits.length <= 2) return digits

  const ddd = digits.slice(0, 2)

  const rest = digits.slice(2)

  if (!rest) return `(${ddd})`

  if (rest.length <= 4) return `(${ddd}) ${rest}`

  if (rest.length === 7) return `(${ddd}) ${rest.slice(0, 3)}-${rest.slice(3)}`

  if (rest.length === 8) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`

  if (rest.length === 9) return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`
  return `(${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`

}



const normalizePhoneDigits = (value = '') => {

  let digits = String(value || '').replace(/\D/g, '')

  if (digits.length > 11 && digits.startsWith('55')) {

    digits = digits.slice(2)

  }

  if (digits.length > 11) {

    digits = digits.slice(-11)

  }

  return digits

}



const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isValidEmail = (value = '') => EMAIL_REGEX.test(String(value || '').trim().toLowerCase())



const WEEKDAY_SHORT_LABELS = Object.freeze(['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'])



const DEFAULT_BUSINESS_HOURS = { start: 9, end: 22 }

const CALENDAR_STEP_MINUTES = 60



const normalizeSlotLabel = (value) => {

  if (value === null || value === undefined) return ''

  return String(value)

    .toLowerCase()

    .normalize('NFD')

    .replace(/[^a-z0-9:/-]/g, '')

}



const isAvailableLabel = (value) => {

  const normalized = normalizeSlotLabel(value)

  return normalized === 'disponivel' || normalized === 'available'

}



const slotStatusClass = (label) => {

  const normalized = normalizeSlotLabel(label)

  if (normalized === 'agendado' || normalized === 'ocupado') return 'busy'

  if (normalized === 'bloqueado') return 'block'

  return 'ok'

}



const inBusinessHours = (isoDatetime, schedule = null, durationMinutes = 0) => {

  const d = new Date(isoDatetime)

  if (Number.isNaN(d.getTime())) return false

  const duration = Number(durationMinutes) || 0

  const endDate = duration > 0 ? new Date(d.getTime() + duration * 60000) : d

  const isSameDay =

    endDate.getFullYear() === d.getFullYear() &&

    endDate.getMonth() === d.getMonth() &&

    endDate.getDate() === d.getDate()

  const startMinutes = d.getHours() * 60 + d.getMinutes()

  const endMinutes = endDate.getHours() * 60 + endDate.getMinutes()

  if (schedule) {

    const rule = schedule[d.getDay()]

    if (!rule || !rule.enabled) return false

    if (Array.isArray(rule.blockMinutes) && rule.blockMinutes.some(([start, end]) => startMinutes >= start && startMinutes < end)) {

      return false

    }

    if (!isSameDay) return false

    return startMinutes >= rule.startMinutes && endMinutes <= rule.endMinutes

  }

  if (!isSameDay) return false

  const openMinutes = DEFAULT_BUSINESS_HOURS.start * 60

  const closeMinutes = DEFAULT_BUSINESS_HOURS.end * 60

  return startMinutes >= openMinutes && endMinutes <= closeMinutes

}



const SlotButton = ({ slot, isSelected, onClick, density = 'compact', disabled = false }) => {

  const isPast = DateHelpers.isPastSlot(slot.datetime)

  const statusClass = slotStatusClass(slot.label)

  const disabledReason = disabled || isPast || !isAvailableLabel(slot.label)

  const tooltipLabel = slot?.label ?? 'disponivel'
  const capacity = Math.max(1, Number(slot?.capacidade ?? slot?.capacity ?? 1) || 1)
  const remainingValue = Number(slot?.vagas_restantes ?? slot?.vagasRestantes ?? slot?.remaining_slots ?? slot?.remaining ?? capacity)
  const remaining = Number.isFinite(remainingValue) ? Math.max(0, remainingValue) : capacity
  const metaLabel = capacity > 1 && remaining > 0 ? `${remaining} vagas` : ''

  const className = [

    'slot-btn',

    statusClass,

    isSelected ? 'is-selected' : '',

    isPast ? 'is-past' : '',

    density === 'compact' ? 'slot-btn--compact' : 'slot-btn--comfortable',

  ].join(' ')

  return (

    <button

      className={className}

      title={`${new Date(slot.datetime).toLocaleString('pt-BR')} - ${tooltipLabel}${isPast ? ' (passado)' : ''}`}

      onClick={onClick}

      disabled={disabledReason}

      aria-disabled={disabledReason}

      tabIndex={disabledReason ? -1 : 0}

      aria-pressed={isSelected}

      data-datetime={slot.datetime}

    >

      <span className="slot-btn__time">{DateHelpers.formatTime(slot.datetime)}</span>
      {metaLabel && <span className="slot-btn__meta">{metaLabel}</span>}

    </button>

  )

}



const normalizeText = (value) =>

  String(value || '')

    .normalize('NFD')

    .replace(/[\u0300-\u036f]/g, '')

    .toLowerCase()



const normalizeDayToken = (value) => normalizeText(value).replace(/[^a-z0-9]/g, '')



const DAY_TOKEN_MAP = Object.freeze({

  sunday: ['domingo', 'dom', 'domingo-feira', 'sun', 'sunday'],

  monday: ['segunda', 'segunda-feira', 'seg', '2a', 'mon', 'monday'],

  tuesday: ['terça', 'terca', 'terça-feira', 'terca-feira', 'ter', 'tue', 'tuesday'],

  wednesday: ['quarta', 'quarta-feira', 'qua', 'wed', 'wednesday'],

  thursday: ['quinta', 'quinta-feira', 'qui', 'thu', 'thursday'],

  friday: ['sexta', 'sexta-feira', 'sex', 'fri', 'friday'],

  saturday: ['sábado', 'sabado', 'sábado-feira', 'sab', 'sat', 'saturday'],

})



const DAY_SLUG_TO_INDEX = Object.freeze({

  sunday: 0,

  monday: 1,

  tuesday: 2,

  wednesday: 3,

  thursday: 4,

  friday: 5,

  saturday: 6,

})



const DAY_TOKEN_LOOKUP = (() => {

  const map = new Map()

  Object.entries(DAY_TOKEN_MAP).forEach(([slug, tokens]) => {

    tokens.forEach((token) => {

      const normalized = normalizeDayToken(token)

      if (normalized) map.set(normalized, slug)

    })

  })

  return map

})()



const TIME_VALUE_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/



const ensureTimeValue = (value) => {

  if (value == null) return ''

  const text = String(value).trim()

  if (!text) return ''

  const direct = text.match(/^(\d{1,2})(?:[:h](\d{2}))?$/i)

  if (direct) {

    const hours = Number(direct[1])

    const minutes = Number(direct[2] ?? '00')

    if (

      Number.isInteger(hours) &&

      hours >= 0 &&

      hours <= 23 &&

      Number.isInteger(minutes) &&

      minutes >= 0 &&

      minutes <= 59

    ) {

      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`

    }

  }

  const digits = text.replace(/\D/g, '')

  if (!digits) return ''

  if (digits.length <= 2) {

    const hours = Number(digits)

    if (!Number.isInteger(hours) || hours < 0 || hours > 23) return ''

    return `${String(hours).padStart(2, '0')}:00`

  }

  const hoursNum = Number(digits.slice(0, -2))

  const minutesNum = Number(digits.slice(-2))

  if (

    !Number.isInteger(hoursNum) ||

    hoursNum < 0 ||

    hoursNum > 23 ||

    !Number.isInteger(minutesNum) ||

    minutesNum < 0 ||

    minutesNum > 59

  ) {

    return ''

  }

  return `${String(hoursNum).padStart(2, '0')}:${String(minutesNum).padStart(2, '0')}`

}



const toMinutes = (value) => {

  if (!TIME_VALUE_REGEX.test(String(value || ''))) return null

  const [hours, minutes] = String(value).split(':').map(Number)

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null

  return hours * 60 + minutes

}



const parseTimeRangeHint = (label) => {

  if (!label) return { start: '', end: '' }

  const matches = Array.from(String(label).matchAll(/(\d{1,2})(?:[:h](\d{2}))?/gi))

  if (!matches.length) return { start: '', end: '' }

  const times = matches

    .map(([_, hh, mm]) => ensureTimeValue(`${hh}${mm ?? ''}`))

    .filter(Boolean)

  if (!times.length) return { start: '', end: '' }

  const [start, end] = times

  return { start: start || '', end: end || '' }

}



const resolveDayIndex = (entry) => {

  if (!entry) return null

  const explicitSlug =

    entry.day || entry.weekday || entry.week_day || entry.key || entry.dia || null

  if (explicitSlug && Object.prototype.hasOwnProperty.call(DAY_SLUG_TO_INDEX, explicitSlug)) {

    return DAY_SLUG_TO_INDEX[explicitSlug]

  }

  const labelToken = normalizeDayToken(entry.label || '')

  if (labelToken && DAY_TOKEN_LOOKUP.has(labelToken)) {

    return DAY_SLUG_TO_INDEX[DAY_TOKEN_LOOKUP.get(labelToken)]

  }

  if (entry.value) {

    const firstPart = String(entry.value).split(/[:\-]/)[0]

    const normalized = normalizeDayToken(firstPart || '')

    if (normalized && DAY_TOKEN_LOOKUP.has(normalized)) {

      return DAY_SLUG_TO_INDEX[DAY_TOKEN_LOOKUP.get(normalized)]

    }

  }

  return null

}



const buildWorkingSchedule = (entries) => {

  if (!Array.isArray(entries) || !entries.length) return null

  const rules = Array.from({ length: 7 }, () => ({

    enabled: false,

    isClosed: false,

    start: '',

    end: '',

    startMinutes: null,

    endMinutes: null,

    blocks: [],

    breaks: [],

    blockMinutes: [],

  }))

  const recognized = new Set()



  entries.forEach((item) => {

    const dayIndex = resolveDayIndex(item)

    if (dayIndex == null) return

    recognized.add(dayIndex)



    const valueText = normalizeText(item.value || '')

    if (/fechado|sem atendimento|nao atende/.test(valueText)) {

      rules[dayIndex] = {

        enabled: false,

        isClosed: true,

        start: '',

        end: '',

        startMinutes: null,

        endMinutes: null,

        blocks: [],

        breaks: [],

        blockMinutes: [],

      }

      return

    }



    let start = ensureTimeValue(item.start ?? item.begin ?? item.from ?? '')

    let end = ensureTimeValue(item.end ?? item.finish ?? item.to ?? '')

    if ((!start || !end) && item.value) {

      const parsed = parseTimeRangeHint(item.value)

      if (!start && parsed.start) start = parsed.start

      if (!end && parsed.end) end = parsed.end

    }

    if (!start || !end) {

      rules[dayIndex] = {

        enabled: false,

        isClosed: true,

        start: '',

        end: '',

        startMinutes: null,

        endMinutes: null,

        blocks: [],

        breaks: [],

        blockMinutes: [],

      }

      return

    }

    const startMinutes = toMinutes(start)

    const endMinutes = toMinutes(end)

    if (

      startMinutes == null ||

      endMinutes == null ||

      startMinutes >= endMinutes

    ) {

      rules[dayIndex] = {

        enabled: false,

        isClosed: true,

        start: '',

        end: '',

        startMinutes: null,

        endMinutes: null,

        blocks: [],

        breaks: [],

        blockMinutes: [],

      }

      return

    }



    const rawBlocks = Array.isArray(item.blocks)

      ? item.blocks

      : Array.isArray(item.breaks)

        ? item.breaks

        : item.block_start || item.blockStart || item.block_end || item.blockEnd

          ? [

            {

              start: item.block_start ?? item.blockStart ?? null,

              end: item.block_end ?? item.blockEnd ?? null,

            },

          ]

          : []



    const sanitizedBlocks = []

    rawBlocks.forEach((block) => {

      if (!block) return

      const blockStart = ensureTimeValue(block.start ?? block.begin ?? block.from ?? '')

      const blockEnd = ensureTimeValue(block.end ?? block.finish ?? block.to ?? '')

      if (!blockStart || !blockEnd) return

      const blockStartMinutes = toMinutes(blockStart)

      const blockEndMinutes = toMinutes(blockEnd)

      if (

        blockStartMinutes == null ||

        blockEndMinutes == null ||

        blockStartMinutes >= blockEndMinutes

      ) {

        return

      }

      if (blockStartMinutes < startMinutes || blockEndMinutes > endMinutes) {

        return

      }

      sanitizedBlocks.push({

        start: blockStart,

        end: blockEnd,

        startMinutes: blockStartMinutes,

        endMinutes: blockEndMinutes,

      })

    })



    rules[dayIndex] = {

      enabled: true,

      isClosed: false,

      start,

      end,

      startMinutes,

      endMinutes,

      blocks: sanitizedBlocks.map(({ start: bStart, end: bEnd }) => ({ start: bStart, end: bEnd })),

      breaks: sanitizedBlocks.map(({ start: bStart, end: bEnd }) => ({ start: bStart, end: bEnd })),

      blockMinutes: sanitizedBlocks.map(({ startMinutes: bStart, endMinutes: bEnd }) => [bStart, bEnd]),

    }

  })



  if (!recognized.size) return null

  return rules

}



const getScheduleRuleForDate = (dateish, schedule) => {

  if (!schedule) return null

  try {

    const date = DateHelpers.parseLocal(dateish)

    if (!date || Number.isNaN(date.getTime())) return null

    const dayIdx = date.getDay()

    return schedule[dayIdx] || null

  } catch {

    return null

  }

}



export default function DashboardEstabelecimento() {
  const [itens, setItens] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('todos')
  const [currentUser, setCurrentUser] = useState(() => getUser())
  const [showProAgenda, setShowProAgenda] = useState(true)
  const [professionals, setProfessionals] = useState([])
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const onboardingNoticeHandledRef = useRef(false)
  const [trialModalOpen, setTrialModalOpen] = useState(false)
  // Sinal para o botão "Novo agendamento" do cockpit abrir o self-booking (hospedado no host invisível).
  const [newApptSignal, setNewApptSignal] = useState(0)
  // Sinal para o cockpit re-buscar ao criar um agendamento (mantém os indicadores em dia).
  const [cockpitRefresh, setCockpitRefresh] = useState(0)
  const [dashboardNotice, setDashboardNotice] = useState('')
  const establishmentId =
    currentUser && currentUser.tipo === 'estabelecimento' ? currentUser.id : null


  useEffect(() => {
    const handleUserEvent = (event) => {
      if (event?.detail && Object.prototype.hasOwnProperty.call(event.detail, 'user')) {
        setCurrentUser(event.detail.user)
      } else {
        setCurrentUser(getUser())
      }
    }
    const handleStorage = (event) => {
      if (event.key === 'user') {
        setCurrentUser(getUser())
      }
    }


    window.addEventListener(USER_EVENT, handleUserEvent)

    window.addEventListener('storage', handleStorage)

    return () => {

      window.removeEventListener(USER_EVENT, handleUserEvent)

      window.removeEventListener('storage', handleStorage)

    }

  }, [])

  useEffect(() => {
    const trialParam = searchParams.get('trial')
    if (trialParam !== 'sucesso') return
    setTrialModalOpen(true)
    const updatedParams = new URLSearchParams(searchParams)
    updatedParams.delete('trial')
    setSearchParams(updatedParams, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (onboardingNoticeHandledRef.current) return undefined
    const onboardingParam = searchParams.get('onboarding')
    const stateSuccess = Boolean(location?.state?.onboardingSuccess)
    if (onboardingParam !== 'sucesso' && !stateSuccess) return undefined

    onboardingNoticeHandledRef.current = true
    setDashboardNotice('Configuração inicial concluída. Sua agenda já pode receber agendamentos.')

    if (onboardingParam === 'sucesso') {
      const updatedParams = new URLSearchParams(searchParams)
      updatedParams.delete('onboarding')
      setSearchParams(updatedParams, { replace: true })
    }

    return undefined
  }, [location?.state, searchParams, setSearchParams])

  useEffect(() => {
    if (!dashboardNotice) return undefined
    const timeoutId = window.setTimeout(() => setDashboardNotice(''), 7000)
    return () => window.clearTimeout(timeoutId)
  }, [dashboardNotice])


  useEffect(() => {

    if (!establishmentId) {

      setProfessionals([])

      return

    }

    let mounted = true

    Api.profissionaisList()

      .then((data) => {

        if (mounted) setProfessionals(Array.isArray(data) ? data : [])

      })

      .catch(() => {

        if (mounted) setProfessionals([])

      })

    return () => {

      mounted = false

    }

  }, [establishmentId])



  useEffect(() => {

    let mounted = true

    setLoading(true)

    const reqStatus = status || 'todos'

    Api.agendamentosEstabelecimento(reqStatus)

      .then((data) => {

        if (mounted) setItens(Array.isArray(data) ? data : [])

      })

      .catch(() => {

        if (mounted) setItens([])

      })

      .finally(() => {

        if (mounted) setLoading(false)

      })

    return () => {

      mounted = false

    }

  }, [status])



  const totals = useMemo(() => {

    const acc = { recebidos: 0, cancelados: 0 }

    for (const item of itens) {

      const st = String(item?.status || '').toLowerCase()

      if (st === 'confirmado' || st === 'pendente') acc.recebidos += 1

      if (st === 'cancelado') acc.cancelados += 1

    }

    return acc

  }, [itens])



  const filtered = useMemo(() => {

    const now = Date.now()

    const normalized = (i) =>

      String(i?.status || '')

        .normalize('NFD')

        .replace(/[\u0300-\u036f]/g, '')

        .toLowerCase()



    if (status === 'confirmado') {

      return itens.filter((i) => {

        if (normalized(i) !== 'confirmado') return false

        const endTime = new Date(i.fim || i.inicio).getTime()

        return Number.isFinite(endTime) ? endTime >= now : true

      })

    }

    if (status === 'concluido') {

      return itens.filter((i) => {

        const st = normalized(i)

        if (st === 'concluido' || st === 'concluido.') return true

        if (st === 'confirmado') {

          const endTime = new Date(i.fim || i.inicio).getTime()

          return Number.isFinite(endTime) && endTime < now

        }

        return st === 'done'

      })

    }

    if (status === 'cancelado') {

      return itens.filter((i) => normalized(i) === 'cancelado')

    }

    return itens

  }, [itens, status])



  const handleForceCancel = useCallback(async (id) => {

    await Api.cancelarAgendamentoEstab(id)

    setItens((prev) => prev.map((item) => (item.id === id ? { ...item, status: 'cancelado' } : item)))

  }, [])



  const handleUpdateAppointment = useCallback((id, updates) => {

    if (!id || !updates) return

    setItens((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)))

  }, [])



  const handleAddAppointment = useCallback((appointment) => {

    if (!appointment) return

    setItens((prev) => {

      const exists = prev.some((item) => item.id === appointment.id)

      if (exists) {

        return prev.map((item) => (item.id === appointment.id ? { ...item, ...appointment } : item))

      }

      return [appointment, ...prev]

    })

    setCockpitRefresh((n) => n + 1)

  }, [])



  return (

    <div className="dashboard-narrow dashboard-pro dashboard-estab-pro">

      {dashboardNotice ? <div className="dashboard-success-banner">{dashboardNotice}</div> : null}

      {/* Só aparece para o dono que ainda não autorizou o WhatsApp — e some sozinho no clique.
          É a única coisa que ganhou o direito de voltar ao topo do painel (que foi desentupido em
          a713972): é acionável, resolve-se de uma vez, e sem ela o dono não descobre que os avisos
          dele estão bloqueados. */}
      <WhatsAppOptInBanner />

      <CockpitOverview
        establishmentId={establishmentId}
        currentUser={currentUser}
        professionals={professionals}
        onNewAppointment={() => setNewApptSignal((n) => n + 1)}
        refreshSignal={cockpitRefresh}
      />

            <ProfessionalAgendaView
              items={filtered}
              professionals={professionals}
              onForceCancel={handleForceCancel}
              onUpdateAppointment={handleUpdateAppointment}
              onAddAppointment={handleAddAppointment}
              establishmentId={establishmentId}
              currentUser={currentUser}
              trialModalOpen={trialModalOpen}
              onDismissTrialModal={() => setTrialModalOpen(false)}
              openBookingSignal={newApptSignal}
              prefillClient={location?.state?.prefillClient || null}
            />

    </div>

  )



}



const AGENDA_STATUS_THEME = Object.freeze({

  confirmado_wa: {

    label: 'Confirmado (WhatsApp)',

    bg: '#d1fae5',

    border: '#34d399',

    dot: '#059669',

    text: '#065f46',

    badge: 'rgba(5,150,105,0.2)',

  },

  confirmado: {

    label: 'Confirmado',

    bg: '#e0f2fe',

    border: '#7dd3fc',

    dot: '#0284c7',

    text: '#0c4a6e',

    badge: 'rgba(2,132,199,0.18)',

  },

  concluido: {

    label: 'Concluído',

    bg: '#e0e7ff',

    border: '#a5b4fc',

    dot: '#4f46e5',

    text: '#312e81',

    badge: 'rgba(79,70,229,0.16)',

  },

  cancelado: {

    label: 'Cancelado',

    bg: '#fee2e2',

    border: '#fca5a5',

    dot: '#dc2626',

    text: '#7f1d1d',

    badge: 'rgba(220,38,38,0.16)',

  },

  pendente: {

    label: 'Pendente',

    bg: '#fef3c7',

    border: '#fbbf24',

    dot: '#d97706',

    text: '#78350f',

    badge: 'rgba(217,119,6,0.2)',

  },

  default: {

    label: 'Agendamento',

    bg: '#e5e7eb',

    border: '#d1d5db',

    dot: '#6b7280',

    text: '#374151',

    badge: 'rgba(107,114,128,0.16)',

  },

})



const getAgendaTheme = (status) => AGENDA_STATUS_THEME[status] || AGENDA_STATUS_THEME.default

const formatTime24h = (date) => {

  const dt = date instanceof Date ? date : new Date(date)

  if (!Number.isFinite(dt?.getTime?.())) return ''

  const hours = String(dt.getHours()).padStart(2, '0')

  const minutes = String(dt.getMinutes()).padStart(2, '0')

  return `${hours}:${minutes}`

}

const formatDateShort = (date) => {

  const d = date instanceof Date ? date : new Date(date)

  if (!Number.isFinite(d?.getTime?.())) return ''

  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

}



const formatTime12h = (date, { showMinutes = false, compact = false, lowercase = false } = {}) => {

  const dt = date instanceof Date ? date : new Date(date)

  if (!Number.isFinite(dt?.getTime?.())) return ''

  const hours = dt.getHours()

  const minutes = dt.getMinutes()

  const h12 = hours % 12 || 12

  const suffix = hours >= 12 ? 'PM' : 'AM'

  const minsPart = showMinutes || minutes ? `:${String(minutes).padStart(2, '0')}` : ''

  const space = compact ? '' : ' '

  const text = `${h12}${minsPart}${space}${suffix}`

  return lowercase ? text.toLowerCase() : text

}

const formatHourRange = (start, end) => {

  const s = start instanceof Date ? start : new Date(start)

  const e = end instanceof Date ? end : new Date(end)

  if (!Number.isFinite(s?.getTime?.()) || !Number.isFinite(e?.getTime?.())) return ''

  return `${formatTime24h(s)} - ${formatTime24h(e)}`

}



const RESOURCE_COLORS = [

  { bg: '#ecfdf3', border: '#bbf7d0', dot: '#15803d', text: '#064e3b' },

  { bg: '#eff6ff', border: '#bfdbfe', dot: '#1d4ed8', text: '#0f172a' },

  { bg: '#fef3c7', border: '#fde68a', dot: '#d97706', text: '#78350f' },

  { bg: '#f3e8ff', border: '#e9d5ff', dot: '#9333ea', text: '#581c87' },

  { bg: '#e0f2fe', border: '#bae6fd', dot: '#0284c7', text: '#0c4a6e' },

  { bg: '#fee2e2', border: '#fecaca', dot: '#dc2626', text: '#7f1d1d' },

  { bg: '#f5f3ff', border: '#ddd6fe', dot: '#7c3aed', text: '#312e81' },

  { bg: '#fef9c3', border: '#fde68a', dot: '#ca8a04', text: '#854d0e' },

]





function ProfessionalAgendaView({
  items,
  onForceCancel,
  onUpdateAppointment,
  onAddAppointment,
  professionals,
  establishmentId,
  currentUser,
  trialModalOpen,
  onDismissTrialModal,
  openBookingSignal,
  prefillClient,
}) {
  const prefillHandledRef = useRef(null)
  const getResourceId = (item) =>

    item?.profissional_id ??

    item?.professional_id ??

    item?.profissional ??

    item?.professional ??

    item?.profissional_nome ??

    item?.professional_name ??

    'sem-id'



  const getResourceName = (item) =>

    item?.profissional_nome ||

    item?.profissional ||

    item?.professional_name ||

    item?.professional ||

    'Profissional'



  const getResourceAvatar = (value) => {

    const resolved = resolveAssetUrl(value || '')

    return resolved || null

  }



  const resources = useMemo(() => {

    const map = new Map()

    ;(professionals || []).forEach((prof) => {

      const id =

        prof?.id ??

        prof?.profissional_id ??

        prof?.professional_id ??

        prof?.profissional ??

        prof?.professional

      if (id == null) return

      const name =

        prof?.nome ||

        prof?.name ||

        prof?.profissional_nome ||

        prof?.professional_name ||

        'Profissional'

      const avatar = getResourceAvatar(prof?.avatar_url || prof?.avatar || '')

      map.set(id, { id, title: name, avatar })

    })

    ;(items || []).forEach((item) => {

      const id = getResourceId(item)

      const name = getResourceName(item)

      const avatar = getResourceAvatar(item?.profissional_avatar_url || item?.professional_avatar || '')

      if (!map.has(id)) map.set(id, { id, title: name, avatar })

    })

    if (!map.size) map.set('sem-id', { id: 'sem-id', title: 'Profissional', avatar: null })

    return Array.from(map.values()).sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))

  }, [items, professionals])



  const resourceThemes = useMemo(() => {

    const themes = new Map()

    resources.forEach((res, index) => {

      const palette = RESOURCE_COLORS[index % RESOURCE_COLORS.length]

      themes.set(res.id, palette)

    })

    return themes

  }, [resources])



  const resourceLookup = useMemo(() => {

    const lookup = new Map()

    resources.forEach((res) => {

      lookup.set(res.id, res)

    })

    return lookup

  }, [resources])



  const [resourceFilter, setResourceFilter] = useState('all')

  const [selectedEvent, setSelectedEvent] = useState(null)

  const [cancelling, setCancelling] = useState(false)

  const [rescheduleOpen, setRescheduleOpen] = useState(false)

  const [rescheduleDate, setRescheduleDate] = useState('')

  const [rescheduleTime, setRescheduleTime] = useState('')

  const [rescheduleSaving, setRescheduleSaving] = useState(false)

  const [rescheduleError, setRescheduleError] = useState('')

  const [workingSchedule, setWorkingSchedule] = useState(null)

  const [services, setServices] = useState([])

  const [servicesLoading, setServicesLoading] = useState(false)

  const [servicesError, setServicesError] = useState('')

  const [selfBookingOpen, setSelfBookingOpen] = useState(false)

  const [selfBookingServiceId, setSelfBookingServiceId] = useState('')

  const [selfBookingProfessionalId, setSelfBookingProfessionalId] = useState('')

  const [selfBookingDate, setSelfBookingDate] = useState('')

  const [selfBookingTime, setSelfBookingTime] = useState('')

  const [selfBookingName, setSelfBookingName] = useState('')

  const [selfBookingEmail, setSelfBookingEmail] = useState('')

  const [selfBookingPhone, setSelfBookingPhone] = useState('')

  const [selfBookingBirthdate, setSelfBookingBirthdate] = useState('')

  const [selfBookingCep, setSelfBookingCep] = useState('')

  const [selfBookingEndereco, setSelfBookingEndereco] = useState('')

  const [selfBookingNumero, setSelfBookingNumero] = useState('')

  const [selfBookingComplemento, setSelfBookingComplemento] = useState('')

  const [selfBookingBairro, setSelfBookingBairro] = useState('')

  const [selfBookingCidade, setSelfBookingCidade] = useState('')

  const [selfBookingEstado, setSelfBookingEstado] = useState('')

  const [showSelfBookingOptional, setShowSelfBookingOptional] = useState(false)

  const [selfBookingSaving, setSelfBookingSaving] = useState(false)

  const [selfBookingError, setSelfBookingError] = useState('')

  const [selfBookingWeekStart, setSelfBookingWeekStart] = useState('')

  const [selfBookingMonthStart, setSelfBookingMonthStart] = useState('')

  const [selfBookingSelectedDate, setSelfBookingSelectedDate] = useState('')

  const [selfBookingSelectedSlot, setSelfBookingSelectedSlot] = useState(null)

  const [selfBookingSlots, setSelfBookingSlots] = useState([])

  const [selfBookingSlotsLoading, setSelfBookingSlotsLoading] = useState(false)

  const [selfBookingSlotsError, setSelfBookingSlotsError] = useState('')

  const [toast, setToast] = useState(null)



  function showToast(type, msg, ms = 5000) {

    setToast({ type, msg })

    window.clearTimeout(showToast._t)

    showToast._t = window.setTimeout(() => setToast(null), ms)

  }



  useEffect(() => {

    setResourceFilter('all')

  }, [])



  useEffect(() => {

    if (!resources.length) return

    if (resourceFilter === 'all') return

    const hasResource = resources.some((res) => String(res.id) === String(resourceFilter))

    if (!hasResource) {

      setResourceFilter('all')

    }

  }, [resourceFilter, resources])



  useEffect(() => {

    if (!establishmentId) {

      setWorkingSchedule(null)

      return

    }

    let cancelled = false

    ;(async () => {

      try {

        const data = await Api.getEstablishment(establishmentId)

        if (cancelled) return

        const list = Array.isArray(data?.profile?.horarios) ? data.profile.horarios : []

        setWorkingSchedule(buildWorkingSchedule(list))

      } catch {

        if (!cancelled) setWorkingSchedule(null)

      }

    })()

    return () => {

      cancelled = true

    }

  }, [establishmentId])



  useEffect(() => {

    if (!establishmentId) {

      setServices([])

      setServicesError('')

      return

    }

    let cancelled = false

    setServicesLoading(true)

    setServicesError('')

    Api.servicosList()

      .then((data) => {

        if (cancelled) return

        const list = Array.isArray(data) ? data : []

        const active = list.filter((svc) => svc?.ativo == null || Number(svc.ativo) !== 0)

        active.sort((a, b) => String(a?.nome || a?.title || '').localeCompare(String(b?.nome || b?.title || '')))

        setServices(active)

      })

      .catch(() => {

        if (!cancelled) {

          setServices([])

          setServicesError('Não foi possível carregar os serviços.')

        }

      })

      .finally(() => {

        if (!cancelled) setServicesLoading(false)

      })

    return () => {

      cancelled = true

    }

  }, [establishmentId])



  const events = useMemo(() => {

    return (items || [])

      .map((item) => {

        const start = new Date(item?.inicio || item?.start || 0)

        let end = new Date(item?.fim || item?.fim_prevista || item?.end || start)

        if (!Number.isFinite(start.getTime())) return null

        if (!Number.isFinite(end.getTime()) || end <= start) {

          end = new Date(start.getTime() + 30 * 60000)

        }

        const resourceId = getResourceId(item)

        const serviceNames = Array.isArray(item?.servicos)
           ? item.servicos.map((svc) => svc?.nome).filter(Boolean)
          : []
        const service = serviceNames.length
           ? serviceNames.join(' + ')
          : (item?.servico_nome || item?.service_name || 'Serviço')
        const client = item?.cliente_nome || item?.client_name || ''

        const clientPhone =

          item?.cliente_whatsapp ||

          item?.cliente_telefone ||

          item?.cliente_celular ||

          item?.client_phone ||

          item?.client_phone_number ||

          item?.telefone_cliente ||

          item?.telefone ||

          item?.phone ||

          item?.celular ||

          item?.whatsapp ||

          item?.cliente?.whatsapp ||

          item?.cliente?.telefone ||

          item?.cliente?.celular ||

          item?.cliente?.phone ||

          item?.cliente?.contato_telefone ||

          item?.cliente?.contatoTelefone ||

          item?.client?.whatsapp ||

          item?.client?.telefone ||

          item?.client?.celular ||

          item?.client?.phone ||

          item?.user?.telefone ||

          item?.usuario?.telefone ||

          ''

        const confirmedAt =

          item?.cliente_confirmou_whatsapp_at ||

          item?.cliente_confirmou_whatsapp_em ||

          item?.client_confirmed_whatsapp_at ||

          item?.client_confirmed_at ||

          null

        const title = client ? `${client} - ${service}` : service

        const rawStatus = String(item?.status || '').toLowerCase()

        let status = normalizeText(rawStatus)

        if (status.startsWith('conclu')) status = 'concluido'

        else if (status.startsWith('confirm')) status = 'confirmado'

        else if (status.startsWith('cancel')) status = 'cancelado'

        else if (status.startsWith('pend')) status = 'pendente'

        // normaliza confirmados passados para concluido

        if (status === 'confirmado' && end.getTime() < Date.now()) {

          status = 'concluido'

        }

        if (status === 'confirmado') {

          status = confirmedAt ? 'confirmado_wa' : 'pendente'

        }

        const baseTheme = resourceThemes.get(resourceId) || RESOURCE_COLORS[0]

        const statusTheme = getAgendaTheme(status)

        const theme = {

          ...statusTheme,

          dot: statusTheme.dot || baseTheme.dot,

          border: statusTheme.border || baseTheme.border,

        }

        return {

          id: item?.id || `${resourceId}-${start.getTime()}`,

          title,

          start,

          end,

          resourceId,

          allDay: false,

          status,

          service,

          client,

          clientPhone,

          statusLabel: theme.label,

          confirmedAt,

          _theme: theme,

        }

      })

      .filter(Boolean)

      .sort((a, b) => {

        if (a.resourceId !== b.resourceId) return String(a.resourceId).localeCompare(String(b.resourceId))

        return new Date(a.start) - new Date(b.start)

      })

  }, [items])



  const getStatusPresentation = (eventItem) => {

    const status = String(eventItem?.status || '').toLowerCase()

    const isCancelled = status === 'cancelado'

    const isDone = status === 'concluido'

    const hasWhatsappConfirm = Boolean(eventItem?.confirmedAt) || status === 'confirmado_wa'

    const isConfirmed = hasWhatsappConfirm || status === 'confirmado'

    const label = isCancelled

       ? 'Status: cancelado'

      : isDone

         ? 'Status: concluído'

        : hasWhatsappConfirm

           ? 'Status: confirmado no WhatsApp'

          : isConfirmed

             ? 'Status: confirmado'

            : 'Status: aguardando confirmação no WhatsApp'

    const badgeClass = isCancelled

       ? 'pro-agenda__badge pro-agenda__badge--danger'

      : isDone

         ? 'pro-agenda__badge pro-agenda__badge--info'

        : hasWhatsappConfirm

           ? 'pro-agenda__badge pro-agenda__badge--success-strong'

        : isConfirmed

           ? 'pro-agenda__badge pro-agenda__badge--success'

          : 'pro-agenda__badge pro-agenda__badge--warning'

    return { label, badgeClass, isCancelled, isDone, isConfirmed }

  }



  const toDigits = (value) => String(value || '').replace(/\D/g, '')

  const buildWhatsappLink = (eventItem) => {

    const digits = toDigits(eventItem?.clientPhone)

    if (!digits) return null

    const name = eventItem?.client || ''

    const msg = encodeURIComponent(`Olá ${name}, tudo bem?`.trim())

    return `https://wa.me/${digits}?text=${msg}`

  }



  useEffect(() => {

    if (!selectedEvent?.id) return

    const updated = events.find((ev) => ev.id === selectedEvent.id)

    if (!updated) {

      setSelectedEvent(null)

      return

    }

    if (updated !== selectedEvent) {

      setSelectedEvent(updated)

    }

  }, [events, selectedEvent?.id])



  useEffect(() => {

    if (!selectedEvent?.id) return

    setCancelling(false)

  }, [selectedEvent?.id])



  useEffect(() => {

    if (!selectedEvent?.id) {

      setRescheduleOpen(false)

      setRescheduleDate('')

      setRescheduleTime('')

      setRescheduleSaving(false)

      setRescheduleError('')

      return

    }

    const startDate = selectedEvent.start instanceof Date

       ? selectedEvent.start

      : new Date(selectedEvent.start)

    if (!Number.isFinite(startDate.getTime())) {

      setRescheduleDate('')

      setRescheduleTime('')

      setRescheduleOpen(false)

      setRescheduleSaving(false)

      setRescheduleError('')

      return

    }

    setRescheduleDate(DateHelpers.formatLocalISO(startDate))

    setRescheduleTime(formatTime24h(startDate))

    setRescheduleOpen(false)

    setRescheduleSaving(false)

    setRescheduleError('')

  }, [selectedEvent?.id])



  useEffect(() => {

    if (!selectedEvent && !selfBookingOpen) return

    const handleKeyDown = (eventKey) => {

      if (eventKey.key === 'Escape') {

        setSelectedEvent(null)

        setSelfBookingOpen(false)

      }

    }

    document.addEventListener('keydown', handleKeyDown)

    return () => document.removeEventListener('keydown', handleKeyDown)

  }, [selectedEvent, selfBookingOpen])






  const filteredEvents = useMemo(

    () => (resourceFilter === 'all' ? events : events.filter((ev) => ev.resourceId === resourceFilter)),

    [events, resourceFilter]

  )




  const initialDate = useMemo(

    () => (filteredEvents.length && filteredEvents[0]?.start instanceof Date ? filteredEvents[0].start : new Date()),

    [filteredEvents]

  )

  const [currentDate, setCurrentDate] = useState(() => initialDate)












  const selectedService = useMemo(

    () => services.find((svc) => String(svc?.id || '') === String(selfBookingServiceId)) || null,

    [services, selfBookingServiceId]

  )



  const serviceProfessionals = useMemo(() => {

    if (!selectedService) return []

    if (Array.isArray(selectedService.professionals)) return selectedService.professionals

    if (Array.isArray(selectedService.profissionais)) return selectedService.profissionais

    return []

  }, [selectedService])



  const selfBookingServiceDuration = useMemo(

    () => Number(selectedService?.duracao_min || selectedService?.duration || 0),

    [selectedService]

  )



  const selfBookingSlotsByDate = useMemo(() => {

    const grouped = {}

    ;(selfBookingSlots || []).forEach((slot) => {

      const iso = DateHelpers.toISODate(new Date(slot.datetime))

      if (!grouped[iso]) grouped[iso] = []

      grouped[iso].push(slot)

    })

    Object.values(grouped).forEach((list) => {

      list.sort((a, b) => new Date(a.datetime) - new Date(b.datetime))

    })

    return grouped

  }, [selfBookingSlots])



  const selfBookingSlotsForDay = selfBookingSelectedDate

     ? (selfBookingSlotsByDate[selfBookingSelectedDate] || [])

    : []



  useEffect(() => {

    if (!selfBookingOpen) return

    if (!selfBookingServiceId && services.length === 1) {

      const only = String(services[0]?.id || '')

      if (only) setSelfBookingServiceId(only)

    }

  }, [selfBookingOpen, selfBookingServiceId, services])



  useEffect(() => {

    if (!selfBookingOpen) return

    if (!serviceProfessionals.length) {

      if (selfBookingProfessionalId) setSelfBookingProfessionalId('')

      return

    }

    if (serviceProfessionals.length === 1) {

      const only = String(serviceProfessionals[0]?.id || '')

      if (only && selfBookingProfessionalId !== only) {

        setSelfBookingProfessionalId(only)

      }

      return

    }

    const hasCurrent = serviceProfessionals.some(

      (prof) => String(prof?.id || '') === String(selfBookingProfessionalId)

    )

    if (!hasCurrent) setSelfBookingProfessionalId('')

  }, [selfBookingOpen, serviceProfessionals, selfBookingProfessionalId])



  useEffect(() => {

    if (!selfBookingOpen) return

    setSelfBookingSelectedSlot(null)

    setSelfBookingTime('')

  }, [selfBookingOpen, selfBookingServiceId, selfBookingProfessionalId])



  useEffect(() => {

    if (!selfBookingOpen || !establishmentId || !selfBookingWeekStart) return

    let cancelled = false

    setSelfBookingSlotsLoading(true)

    setSelfBookingSlotsError('')

    Api.getSlots(establishmentId, selfBookingWeekStart, {
      includeBusy: true,
      serviceIds: selfBookingServiceId ? [Number(selfBookingServiceId)] : undefined,
      professionalId: selfBookingProfessionalId || undefined,
    })
      .then((data) => {

        if (cancelled) return

        const list = Array.isArray(data?.slots) ? data.slots : []

        setSelfBookingSlots(list)

        setSelfBookingSlotsLoading(false)

      })

      .catch(() => {

        if (cancelled) return

        setSelfBookingSlots([])

        setSelfBookingSlotsLoading(false)

        setSelfBookingSlotsError('Não foi possível carregar os horários.')

      })

    return () => {

      cancelled = true

    }

  }, [selfBookingOpen, establishmentId, selfBookingWeekStart, selfBookingServiceId, selfBookingProfessionalId])













  const selfBookingTitleId = 'agenda-self-booking-title'






  const handleOpenSelfBooking = () => {
    if (!establishmentId) return
    const baseDate = currentDate instanceof Date ? currentDate : new Date()

    const baseIso = DateHelpers.formatLocalISO(baseDate)

    setSelectedEvent(null)

    setSelfBookingServiceId('')

    setSelfBookingProfessionalId('')

    setSelfBookingDate(baseIso)

    setSelfBookingTime('')

    setSelfBookingName('')

    setSelfBookingEmail('')

    setSelfBookingPhone('')

    setSelfBookingBirthdate('')

    setSelfBookingCep('')

    setSelfBookingEndereco('')

    setSelfBookingNumero('')

    setSelfBookingComplemento('')

    setSelfBookingBairro('')

    setSelfBookingCidade('')

    setSelfBookingEstado('')

    setSelfBookingWeekStart(DateHelpers.weekStartISO(baseDate))

    setSelfBookingMonthStart(DateHelpers.firstOfMonthISO(baseDate))

    setSelfBookingSelectedDate(baseIso)

    setSelfBookingSelectedSlot(null)

    setSelfBookingSlots([])

    setSelfBookingSlotsError('')

    setSelfBookingError('')

    setShowSelfBookingOptional(false)
    setSelfBookingOpen(true)
  }

  // Botão "Novo agendamento" do cockpit (via openBookingSignal) abre o mesmo self-booking.
  useEffect(() => {
    if (openBookingSignal > 0) handleOpenSelfBooking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openBookingSignal])

  useEffect(() => {
    const prefill = prefillClient
    if (!prefill) return
    const prefillKey = String(prefill.id || prefill.cliente_id || '')
    if (prefillHandledRef.current === prefillKey) return
    prefillHandledRef.current = prefillKey
    handleOpenSelfBooking()
    setSelfBookingName(prefill.nome || '')
    setSelfBookingEmail(prefill.email || '')
    setSelfBookingPhone(normalizePhoneDigits(prefill.telefone || ''))
    if (prefill.data_nascimento) {
      setSelfBookingBirthdate(String(prefill.data_nascimento).slice(0, 10))
      setShowSelfBookingOptional(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillClient])

  const handleCloseSelfBooking = () => {
    setSelfBookingOpen(false)
    setSelfBookingError('')

    setShowSelfBookingOptional(false)

    setSelfBookingSelectedSlot(null)

  }



  const handleCreateSelfBooking = async () => {

    if (selfBookingSaving || !establishmentId) return

    const nome = String(selfBookingName || '').trim()

    const email = String(selfBookingEmail || '').trim()

    const telefone = normalizePhoneDigits(selfBookingPhone)

    const servicoIdNum = Number(selfBookingServiceId)

    if (!servicoIdNum) {

      setSelfBookingError('Selecione um serviço.')

      return

    }

    const selectedSlotIso =

      selfBookingSelectedSlot?.datetime ||

      (selfBookingDate && selfBookingTime ? new Date(`${selfBookingDate}T${selfBookingTime}:00`).toISOString() : '')

    if (!selectedSlotIso) {

      setSelfBookingError('Selecione uma data e horário.')

      return

    }

    if (!nome || !email || !telefone) {

      setSelfBookingError('Informe nome, e-mail e telefone.')

      return

    }

    if (!isValidEmail(email)) {

      setSelfBookingError('Informe um e-mail válido.')

      return

    }

    if (telefone.length < 10) {

      setSelfBookingError('Informe um telefone com DDD para contato.')

      return

    }

    const cepDigitsRaw = String(selfBookingCep || '').replace(/\D/g, '')

    if (cepDigitsRaw && cepDigitsRaw.length !== 8) {

      setSelfBookingError('Informe um CEP válido com 8 dígitos.')

      return

    }

    const estadoTrim = String(selfBookingEstado || '').trim().toUpperCase()

    if (estadoTrim && estadoTrim.length !== 2) {

      setSelfBookingError('Informe a UF com 2 letras.')

      return

    }

    if (serviceProfessionals.length && !selfBookingProfessionalId) {

      setSelfBookingError('Selecione um profissional.')

      return

    }

    const localDateTime = new Date(selectedSlotIso)

    if (!Number.isFinite(localDateTime.getTime())) {

      setSelfBookingError('Data/hora inválida.')

      return

    }

    if (localDateTime.getTime() <= Date.now()) {

      setSelfBookingError('Não e possível agendar no passado.')

      return

    }



    const profId =

      serviceProfessionals.length && selfBookingProfessionalId

         ? Number(selfBookingProfessionalId)

        : null

    const payload = {
      estabelecimento_id: establishmentId,
      servico_ids: [servicoIdNum],
      inicio: localDateTime.toISOString(),
      nome,
      email,
      telefone,

      ...(profId ? { profissional_id: profId } : {}),

    }

    const dataNascimento = String(selfBookingBirthdate || '').trim()

    if (dataNascimento) payload.data_nascimento = dataNascimento

    const cepDigits = cepDigitsRaw.slice(0, 8)

    if (cepDigits) payload.cep = cepDigits

    const enderecoTrim = String(selfBookingEndereco || '').trim()

    if (enderecoTrim) payload.endereco = enderecoTrim

    const numeroTrim = String(selfBookingNumero || '').trim()

    if (numeroTrim) payload.numero = numeroTrim

    const complementoTrim = String(selfBookingComplemento || '').trim()

    if (complementoTrim) payload.complemento = complementoTrim

    const bairroTrim = String(selfBookingBairro || '').trim()

    if (bairroTrim) payload.bairro = bairroTrim

    const cidadeTrim = String(selfBookingCidade || '').trim()

    if (cidadeTrim) payload.cidade = cidadeTrim

    if (estadoTrim) payload.estado = estadoTrim



    try {

      setSelfBookingSaving(true)

      setSelfBookingError('')

      const created = await Api.agendarEstabelecimento(payload)

      const serviceName =

        selectedService?.nome ||

        selectedService?.title ||

        'Serviço'

      const profName = profId
        ? (serviceProfessionals.find((prof) => String(prof.id) === String(profId))?.nome ||
          professionals.find((prof) => String(prof.id) === String(profId))?.nome ||
          '')
        : ''

      const startIso = created?.inicio || payload.inicio

      const endIso = created?.fim || (() => {

        const dur = Number(selectedService?.duracao_min || 0)

        if (!Number.isFinite(dur) || dur <= 0) return null

        const startDate = new Date(startIso)

        if (!Number.isFinite(startDate.getTime())) return null

        return new Date(startDate.getTime() + dur * 60000).toISOString()

      })()

      const newItem = {
        id: created?.id || `public-${Date.now()}`,
        inicio: startIso,
        fim: endIso || startIso,
        status: created?.status || 'confirmado',
        servico_ids: [servicoIdNum],
        servico_nome: serviceName,
        profissional_id: profId,
        profissional_nome: profName,

        cliente_nome: nome,

        cliente_telefone: telefone,

        cliente_whatsapp: telefone,

        cliente_email: email,

      }

      if (onAddAppointment) {

        onAddAppointment(newItem)

      }

      showToast('success', 'Agendamento realizado com sucesso.')

      setSelfBookingOpen(false)

    } catch (err) {

      const msg =

        err?.data?.message ||

        err?.message ||

        'Não foi possível criar o agendamento.'

      setSelfBookingError(msg)

    } finally {

      setSelfBookingSaving(false)

    }

  }



  return (

    <>

      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}

      {selfBookingOpen && (

        <div className="modal-backdrop" role="presentation" onClick={handleCloseSelfBooking}>

          <div

            className="modal"

            role="dialog"

            aria-modal="true"

            aria-labelledby={selfBookingTitleId}

            onClick={(eventClick) => eventClick.stopPropagation()}

          >

            <div className="modal__header">

              <h3 className="modal__title" id={selfBookingTitleId}>Novo agendamento</h3>

              <button type="button" className="modal__close" onClick={handleCloseSelfBooking} aria-label="Fechar">

                x

              </button>

            </div>

            <div className="modal__body">

              <div className="pro-agenda__modal-label">Dados do agendamento</div>

              <div className="pro-agenda__modal-reschedule-grid">

                <label className="label">

                  <span>Serviço</span>

                  <select

                    className="input"

                    value={selfBookingServiceId}

                    onChange={(eventChange) => {

                      setSelfBookingServiceId(eventChange.target.value)

                      if (selfBookingError) setSelfBookingError('')

                    }}

                  >

                    <option value="">

                      {servicesLoading

                         ? 'Carregando...'

                        : services.length

                         ? 'Selecione um serviço'

                        : 'Nenhum serviço cadastrado'}

                    </option>

                    {services.map((svc) => (

                      <option key={svc.id} value={svc.id}>

                        {svc?.nome || svc?.title || 'Serviço'}

                      </option>

                    ))}

                  </select>

                </label>

                {serviceProfessionals.length > 0 && (

                  <label className="label">

                    <span>Profissional</span>

                    <select

                      className="input"

                      value={selfBookingProfessionalId}

                      onChange={(eventChange) => {

                        setSelfBookingProfessionalId(eventChange.target.value)

                        if (selfBookingError) setSelfBookingError('')

                      }}

                    >

                      <option value="">Selecione um profissional</option>

                      {serviceProfessionals.map((prof) => (

                        <option key={prof.id} value={prof.id}>

                          {prof?.nome || prof?.name || 'Profissional'}

                        </option>

                      ))}

                    </select>

                  </label>

                )}

              </div>

              <div className="pro-agenda__modal-label" style={{ marginTop: 12 }}>Data e horário</div>

              <div className="novo-agendamento__calendar">

                <div className="month card" style={{ padding: 8, marginBottom: 8 }}>

                  <div className="row spread" style={{ alignItems: 'center', marginBottom: 6 }}>

                    <div className="row" style={{ gap: 6, alignItems: 'center' }}>

                      <button

                        className="btn btn--sm"

                        aria-label="Mes anterior"

                        onClick={() =>

                          setSelfBookingMonthStart(

                            DateHelpers.formatLocalISO(

                              DateHelpers.addMonths(selfBookingMonthStart || DateHelpers.formatLocalISO(new Date()), -1)

                            )

                          )

                        }

                      >

                        &lt;

                      </button>

                      <strong>

                        {selfBookingMonthStart

                           ? new Date(`${selfBookingMonthStart}T00:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

                          : ''}

                      </strong>

                      <button

                        className="btn btn--sm"

                        aria-label="Próximo mês"

                        onClick={() =>

                          setSelfBookingMonthStart(

                            DateHelpers.formatLocalISO(

                              DateHelpers.addMonths(selfBookingMonthStart || DateHelpers.formatLocalISO(new Date()), 1)

                            )

                          )

                        }

                      >

                        &gt;

                      </button>

                    </div>

                  </div>

                  <div className="month__grid">

                    {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'].map((d, index) => (

                      <div key={`${d}-${index}`} className="month__dow muted">{d}</div>

                    ))}

                    {DateHelpers.monthGrid(selfBookingMonthStart || DateHelpers.formatLocalISO(new Date())).map(({ iso, inMonth, date }) => {

                      const todayIso = DateHelpers.toISODate(new Date())

                      const isToday = DateHelpers.sameYMD(iso, todayIso)

                      const isPastDay = iso < todayIso

                      const isSelected = selfBookingSelectedDate && DateHelpers.sameYMD(selfBookingSelectedDate, iso)

                      const classNameParts = ['month__day']

                      if (!inMonth) classNameParts.push('is-dim')

                      if (isToday) classNameParts.push('is-today')

                      if (isSelected) classNameParts.push('is-selected')

                      if (isPastDay) classNameParts.push('is-past')

                      const className = classNameParts.join(' ')

                      return (

                        <button

                          key={iso}

                          type="button"

                          className={className}

                          onClick={isPastDay ? undefined : () => {

                            setSelfBookingSelectedDate(iso)

                            setSelfBookingDate(iso)

                            setSelfBookingSelectedSlot(null)

                            setSelfBookingTime('')

                            const nextWeek = DateHelpers.weekStartISO(iso)

                            if (nextWeek !== selfBookingWeekStart) setSelfBookingWeekStart(nextWeek)

                          }}

                          title={date.toLocaleDateString('pt-BR')}

                          disabled={isPastDay}

                        >

                          {date.getDate()}

                        </button>

                      )

                    })}

                  </div>

                </div>

                {selfBookingSlotsError && (

                  <div className="box error" style={{ marginTop: 8 }}>

                    {selfBookingSlotsError}

                  </div>

                )}

                <div className="card" style={{ marginTop: 8 }}>

                  <h3 style={{ marginTop: 0, marginBottom: 8 }}>

                    {selfBookingSelectedDate

                       ? new Date(`${selfBookingSelectedDate}T00:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })

                      : 'Selecione uma data'}

                  </h3>

                  {selfBookingSelectedDate ? (

                    serviceProfessionals.length > 0 && !selfBookingProfessionalId ? (

                      <div className="empty">Selecione um profissional para ver os horários.</div>

                    ) : (

                      <div className="slots--grid">

                        {selfBookingSlotsLoading ? (

                          Array.from({ length: 8 }).map((_, i) => <div key={i} className="shimmer pill" />)

                        ) : selfBookingSlotsForDay.length === 0 ? (

                          <div className="empty">Sem horários para este dia.</div>

                        ) : (

                          selfBookingSlotsForDay.map((slot) => {

                            const slotDisabled = !inBusinessHours(slot.datetime, workingSchedule, selfBookingServiceDuration)

                            return (

                              <SlotButton

                                key={slot.datetime}

                                slot={slot}

                                isSelected={selfBookingSelectedSlot?.datetime === slot.datetime}

                                onClick={() => {

                                  if (slotDisabled || !isAvailableLabel(slot.label) || DateHelpers.isPastSlot(slot.datetime)) return

                                  setSelfBookingSelectedSlot(slot)

                                  const slotDate = new Date(slot.datetime)

                                  const isoDate = DateHelpers.toISODate(slotDate)

                                  setSelfBookingDate(isoDate)

                                  setSelfBookingSelectedDate(isoDate)

                                  setSelfBookingTime(DateHelpers.formatTime(slot.datetime))

                                }}

                                disabled={slotDisabled}

                              />

                            )

                          })

                        )}

                      </div>

                    )

                  ) : (

                    <div className="empty">Escolha uma data no calendário acima.</div>

                  )}

                </div>

              </div>

              <div className="pro-agenda__modal-label" style={{ marginTop: 12 }}>Dados do cliente</div>

              <div className="pro-agenda__modal-reschedule-grid">

                <label className="label">

                  <span>Nome</span>

                  <input

                    type="text"

                    className="input"

                    value={selfBookingName}

                    onChange={(eventChange) => {

                      setSelfBookingName(eventChange.target.value)

                      if (selfBookingError) setSelfBookingError('')

                    }}

                  />

                </label>

                <label className="label">

                  <span>E-mail</span>

                  <input

                    type="email"

                    className="input"

                    value={selfBookingEmail}

                    onChange={(eventChange) => {

                      setSelfBookingEmail(eventChange.target.value)

                      if (selfBookingError) setSelfBookingError('')

                    }}

                  />

                </label>

                <label className="label">

                  <span>Telefone</span>

                  <input

                    type="tel"

                    className="input"

                    inputMode="tel"

                    value={formatPhoneDisplay(selfBookingPhone)}

                    onChange={(eventChange) => {

                      setSelfBookingPhone(normalizePhoneDigits(eventChange.target.value))

                      if (selfBookingError) setSelfBookingError('')

                    }}

                  />

                </label>

              </div>

              <div className="row" style={{ marginTop: 6 }}>

                <button

                  type="button"

                  className="btn btn--ghost btn--sm"

                  onClick={() => setShowSelfBookingOptional((prev) => !prev)}

                  disabled={selfBookingSaving}

                >

                  {showSelfBookingOptional ? 'Ocultar dados opcionais' : 'Adicionar dados opcionais'}

                </button>

              </div>

              {showSelfBookingOptional && (

                <div className="pro-agenda__modal-reschedule-grid" style={{ marginTop: 8 }}>

                  <label className="label">

                    <span>Data de nascimento (opcional)</span>

                    <input

                      type="date"

                      className="input"

                      value={selfBookingBirthdate}

                      onChange={(eventChange) => {

                        setSelfBookingBirthdate(eventChange.target.value)

                        if (selfBookingError) setSelfBookingError('')

                      }}

                    />

                  </label>

                  <label className="label">

                    <span>CEP (opcional)</span>

                    <input

                      type="text"

                      className="input"

                      inputMode="numeric"

                      value={selfBookingCep}

                      onChange={(eventChange) => {

                        setSelfBookingCep(eventChange.target.value)

                        if (selfBookingError) setSelfBookingError('')

                      }}

                      placeholder="00000-000"

                    />

                  </label>

                  <label className="label">

                    <span>Endereço (opcional)</span>

                    <input

                      type="text"

                      className="input"

                      value={selfBookingEndereco}

                      onChange={(eventChange) => {

                        setSelfBookingEndereco(eventChange.target.value)

                        if (selfBookingError) setSelfBookingError('')

                      }}

                    />

                  </label>

                  <label className="label">

                    <span>Número (opcional)</span>

                    <input

                      type="text"

                      className="input"

                      value={selfBookingNumero}

                      onChange={(eventChange) => {

                        setSelfBookingNumero(eventChange.target.value)

                        if (selfBookingError) setSelfBookingError('')

                      }}

                    />

                  </label>

                  <label className="label">

                    <span>Complemento (opcional)</span>

                    <input

                      type="text"

                      className="input"

                      value={selfBookingComplemento}

                      onChange={(eventChange) => {

                        setSelfBookingComplemento(eventChange.target.value)

                        if (selfBookingError) setSelfBookingError('')

                      }}

                    />

                  </label>

                  <label className="label">

                    <span>Bairro (opcional)</span>

                    <input

                      type="text"

                      className="input"

                      value={selfBookingBairro}

                      onChange={(eventChange) => {

                        setSelfBookingBairro(eventChange.target.value)

                        if (selfBookingError) setSelfBookingError('')

                      }}

                    />

                  </label>

                  <label className="label">

                    <span>Cidade (opcional)</span>

                    <input

                      type="text"

                      className="input"

                      value={selfBookingCidade}

                      onChange={(eventChange) => {

                        setSelfBookingCidade(eventChange.target.value)

                        if (selfBookingError) setSelfBookingError('')

                      }}

                    />

                  </label>

                  <label className="label">

                    <span>Estado (opcional)</span>

                    <input

                      type="text"

                      className="input"

                      value={selfBookingEstado}

                      onChange={(eventChange) => {

                        setSelfBookingEstado(eventChange.target.value.toUpperCase().slice(0, 2))

                        if (selfBookingError) setSelfBookingError('')

                      }}

                      placeholder="SP"

                    />

                  </label>

                </div>

              )}

              {servicesError && (

                <div className="pro-agenda__modal-note pro-agenda__modal-note--warn">

                  {servicesError}

                </div>

              )}

              {selfBookingError && (

                <div className="pro-agenda__modal-note pro-agenda__modal-note--warn">

                  {selfBookingError}

                </div>

              )}

            </div>

            <div className="modal__actions">

              <button

                type="button"

                className="btn btn--primary"

                onClick={handleCreateSelfBooking}

                disabled={selfBookingSaving || servicesLoading || !services.length}

              >

                {selfBookingSaving ? 'Salvando...' : 'Criar agendamento'}

              </button>

              <button type="button" className="btn btn--outline" onClick={handleCloseSelfBooking}>

                Fechar

              </button>

            </div>

          </div>

        </div>

      )}

      {trialModalOpen && (
        <Modal
          title="Teste grátis ativado com sucesso!"
          onClose={onDismissTrialModal}
          actions={[
            <button
              key="entendi"
              type="button"
              className="btn btn--primary"
              onClick={onDismissTrialModal}
            >
              Entendi
            </button>,
          ]}
        >
          <p>
            Seu período de teste já começou. Configure seus serviços e horários para receber agendamentos.
          </p>
        </Modal>
      )}
    </>
  )

}
