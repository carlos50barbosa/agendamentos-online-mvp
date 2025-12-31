import React, { useCallback, useEffect, useMemo, useState } from 'react'
import moment from 'moment'
import 'moment/locale/pt-br'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { Calendar as BigCalendar, momentLocalizer, Views } from 'react-big-calendar'
import { Api, resolveAssetUrl } from '../utils/api'
import { getUser, USER_EVENT } from '../utils/auth'

moment.locale('pt-br')
moment.updateLocale('pt-br', {
  week: { dow: 1 },
})
const localizer = momentLocalizer(moment)

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
  if (rest.length === 9) return `(${ddd}) ${rest.slice(0, 6)}-${rest.slice(6)}`
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
      {DateHelpers.formatTime(slot.datetime)}
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
  }, [])

  return (
    <div className="dashboard-narrow dashboard-pro">
      <div className="agenda-panel">
        <div className="agenda-hdr">
          <div className="agenda-hdr-left">
            <div className="agenda-title">
              <h2>Agendamentos</h2>
            </div>
            <div className="agenda-chips">
              <button
                type="button"
                className="agenda-chip agenda-chip--ok"
                aria-label={`Agendamentos recebidos: ${totals.recebidos}`}
              >
                <span className="agenda-chip__value">{totals.recebidos}</span>
                <span className="agenda-chip__label">Recebidos</span>
              </button>
              <button
                type="button"
                className="agenda-chip agenda-chip--danger"
                aria-label={`Agendamentos cancelados: ${totals.cancelados}`}
              >
                <span className="agenda-chip__value">{totals.cancelados}</span>
                <span className="agenda-chip__label">Cancelados</span>
              </button>
            </div>
          </div>
          <div className="agenda-hdr-right">
            <div className="agenda-segmented" role="group" aria-label="Filtrar por status">
              <button
                type="button"
                className={`agenda-segmented__btn ${status === 'todos' ? 'is-active' : ''}`}
                aria-pressed={status === 'todos'}
                onClick={() => setStatus('todos')}
              >
                Todos
              </button>
              <button
                type="button"
                className={`agenda-segmented__btn ${status === 'confirmado' ? 'is-active' : ''}`}
                aria-pressed={status === 'confirmado'}
                onClick={() => setStatus('confirmado')}
              >
                Confirmados
              </button>
              <button
                type="button"
                className={`agenda-segmented__btn ${status === 'concluido' ? 'is-active' : ''}`}
                aria-pressed={status === 'concluido'}
                onClick={() => setStatus('concluido')}
              >
                Concluidos
              </button>
              <button
                type="button"
                className={`agenda-segmented__btn ${status === 'cancelado' ? 'is-active' : ''}`}
                aria-pressed={status === 'cancelado'}
                onClick={() => setStatus('cancelado')}
              >
                Cancelados
              </button>
            </div>
          </div>
        </div>
        <div className="pro-agenda__wrap">
          <ProfessionalAgendaView
            items={filtered}
            professionals={professionals}
            onForceCancel={handleForceCancel}
            onUpdateAppointment={handleUpdateAppointment}
            onAddAppointment={handleAddAppointment}
            establishmentId={establishmentId}
            currentUser={currentUser}
          />
        </div>
      </div>
    </div>
  )

}

const AGENDA_STATUS_THEME = Object.freeze({
  confirmado_wa: {
    label: 'Confirmado (WhatsApp)',
    bg: '#dcfce7',
    border: '#86efac',
    dot: '#16a34a',
    text: '#064e3b',
    badge: 'rgba(22,163,74,0.14)',
  },
  confirmado: {
    label: 'Confirmado',
    bg: '#e5e7eb',
    border: '#d1d5db',
    dot: '#6b7280',
    text: '#374151',
    badge: 'rgba(107,114,128,0.16)',
  },
  concluido: {
    label: 'Concluido',
    bg: '#e0f2fe',
    border: '#bfdbfe',
    dot: '#2563eb',
    text: '#0f172a',
    badge: 'rgba(37,99,235,0.12)',
  },
  cancelado: {
    label: 'Cancelado',
    bg: '#fee2e2',
    border: '#fecdd3',
    dot: '#dc2626',
    text: '#7f1d1d',
    badge: 'rgba(220,38,38,0.14)',
  },
  pendente: {
    label: 'Pendente',
    bg: '#FFE699',
    border: '#E5C65A',
    dot: '#B08900',
    text: '#3B2F00',
    badge: 'rgba(176,137,0,0.18)',
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
}) {
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
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = React.useRef(null)
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
        const service = item?.servico_nome || item?.service_name || 'Servico'
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
        ? 'pro-agenda__badge pro-agenda__badge--muted'
        : isConfirmed
          ? 'pro-agenda__badge'
          : 'pro-agenda__badge pro-agenda__badge--muted'
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

  const selectedResource = useMemo(
    () => (resourceFilter === 'all' ? null : resources.find((r) => r.id === resourceFilter)),
    [resourceFilter, resources]
  )

  const filteredEvents = useMemo(
    () => (resourceFilter === 'all' ? events : events.filter((ev) => ev.resourceId === resourceFilter)),
    [events, resourceFilter]
  )

  const initialDate = useMemo(
    () => (filteredEvents.length && filteredEvents[0]?.start instanceof Date ? filteredEvents[0].start : new Date()),
    [filteredEvents]
  )
  const [currentDate, setCurrentDate] = useState(() => initialDate)

  const weekStartIso = useMemo(() => DateHelpers.weekStartISO(currentDate), [currentDate])
  const weekDays = useMemo(() => DateHelpers.weekDays(weekStartIso), [weekStartIso])
  const weekStartDate = useMemo(() => DateHelpers.parseLocal(weekStartIso), [weekStartIso])
  const weekEndDate = useMemo(() => DateHelpers.addDays(weekStartDate, 7), [weekStartDate])

  const weekLabel = useMemo(() => DateHelpers.formatWeekLabel(weekStartIso), [weekStartIso])

  const nextAppointment = useMemo(() => {
    const now = Date.now()
    return (filteredEvents || [])
      .filter((ev) => {
        const status = String(ev?.status || '').toLowerCase()
        if (status === 'cancelado') return false
        const start = ev?.start instanceof Date ? ev.start : new Date(ev?.start)
        const startMs = start?.getTime?.()
        return Number.isFinite(startMs) && startMs >= now
      })
      .sort((a, b) => a.start - b.start)[0] || null
  }, [filteredEvents])

  const nextAppointmentInfo = useMemo(() => {
    if (!nextAppointment) {
      return { label: 'Sem agendamentos', title: 'Sem agendamentos futuros' }
    }
    const start = nextAppointment.start instanceof Date
      ? nextAppointment.start
      : new Date(nextAppointment.start)
    if (!Number.isFinite(start?.getTime?.())) {
      return { label: 'Sem agendamentos', title: 'Sem agendamentos futuros' }
    }
    const dateLabel = formatDateShort(start)
    const timeLabel = formatTime24h(start)
    const whenLabel = [dateLabel, timeLabel].filter(Boolean).join(' ')
    const serviceLabel = nextAppointment.service || nextAppointment.title || 'Servico'
    const clientLabel = nextAppointment.client ? ` - ${nextAppointment.client}` : ''
    const labelParts = []
    if (whenLabel) labelParts.push(whenLabel)
    if (serviceLabel) labelParts.push(serviceLabel)
    const label = labelParts.join(' - ') || 'Sem agendamentos'
    return { label, title: `${label}${clientLabel}`.trim() }
  }, [nextAppointment])

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
    Api.getSlots(establishmentId, selfBookingWeekStart, { includeBusy: true })
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
  }, [selfBookingOpen, establishmentId, selfBookingWeekStart])


  const breakBackgroundEvents = useMemo(() => {
    if (!workingSchedule) return []
    const events = []
    weekDays.forEach(({ date }) => {
      const rule = workingSchedule[date.getDay()]
      if (!rule || !rule.enabled || !Array.isArray(rule.blockMinutes)) return
      rule.blockMinutes.forEach(([startMin, endMin], idx) => {
        const start = new Date(date)
        const end = new Date(date)
        start.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0)
        end.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0)
        if (end <= start) return
        events.push({
          id: `break-${DateHelpers.toISODate(date)}-${idx}`,
          title: 'Pausa',
          start,
          end,
          type: 'break',
        })
      })
    })
    return events
  }, [workingSchedule, weekDays])

  const timeBounds = useMemo(() => {
    const baseDate = currentDate instanceof Date ? currentDate : new Date()
    const baseDay = new Date(baseDate)
    baseDay.setHours(0, 0, 0, 0)
    const dayRule = getScheduleRuleForDate(baseDay, workingSchedule)
    let minMinutes = DEFAULT_BUSINESS_HOURS.start * 60
    let maxMinutes = DEFAULT_BUSINESS_HOURS.end * 60

    if (dayRule && dayRule.enabled && dayRule.start && dayRule.end) {
      const [ruleStartHour, ruleStartMinute] = dayRule.start.split(':').map(Number)
      const [ruleEndHour, ruleEndMinute] = dayRule.end.split(':').map(Number)
      if (
        Number.isFinite(ruleStartHour) &&
        Number.isFinite(ruleStartMinute) &&
        Number.isFinite(ruleEndHour) &&
        Number.isFinite(ruleEndMinute)
      ) {
        minMinutes = ruleStartHour * 60 + ruleStartMinute
        maxMinutes = ruleEndHour * 60 + ruleEndMinute
      }
    }

    let eventMin = null
    let eventMax = null
    const weekStart = weekStartDate ? new Date(weekStartDate) : null
    const weekEnd = weekEndDate ? new Date(weekEndDate) : null
    if (weekStart) weekStart.setHours(0, 0, 0, 0)
    if (weekEnd) weekEnd.setHours(0, 0, 0, 0)

    ;(filteredEvents || []).forEach((ev) => {
      const start = ev?.start instanceof Date ? ev.start : new Date(ev?.start)
      const end = ev?.end instanceof Date ? ev.end : new Date(ev?.end)
      if (!Number.isFinite(start?.getTime?.()) || !Number.isFinite(end?.getTime?.())) return
      if (weekStart && end < weekStart) return
      if (weekEnd && start >= weekEnd) return
      const startMinutes = start.getHours() * 60 + start.getMinutes()
      const endMinutes = end.getHours() * 60 + end.getMinutes()
      if (eventMin == null || startMinutes < eventMin) eventMin = startMinutes
      if (eventMax == null || endMinutes > eventMax) eventMax = endMinutes
    })

    if (eventMin != null) minMinutes = Math.min(minMinutes, eventMin)
    if (eventMax != null) maxMinutes = Math.max(maxMinutes, eventMax)

    const stepMinutes = CALENDAR_STEP_MINUTES
    const roundDownToStep = (value) => Math.floor(value / stepMinutes) * stepMinutes
    const roundUpToStep = (value) => Math.ceil(value / stepMinutes) * stepMinutes

    minMinutes = roundDownToStep(minMinutes)
    maxMinutes = roundUpToStep(maxMinutes + stepMinutes)

    minMinutes = Math.max(0, minMinutes)
    maxMinutes = Math.min(24 * 60, maxMinutes)

    if (maxMinutes <= minMinutes) {
      minMinutes = DEFAULT_BUSINESS_HOURS.start * 60
      maxMinutes = DEFAULT_BUSINESS_HOURS.end * 60
    }

    const min = new Date(baseDay)
    const max = new Date(baseDay)
    min.setHours(Math.floor(minMinutes / 60), minMinutes % 60, 0, 0)
    if (maxMinutes >= 24 * 60) {
      max.setHours(23, 59, 0, 0)
    } else {
      max.setHours(Math.floor(maxMinutes / 60), maxMinutes % 60, 0, 0)
    }
    return { min, max, scrollToTime: min }
  }, [currentDate, filteredEvents, weekEndDate, weekStartDate, workingSchedule])

  const eventStyleGetter = useCallback((event) => {
    const theme = event?._theme || getAgendaTheme(event?.status)
    const status = String(event?.status || '').toLowerCase()
    const isCancelled = status === 'cancelado'
    const isConfirmed = Boolean(event?.confirmedAt) || status === 'confirmado_wa'
    const statusClass = isCancelled ? 'is-cancelled' : isConfirmed ? 'is-confirmed' : 'is-pending'
    return {
      className: `pro-agenda__event ${statusClass}`,
      style: {
        '--event-bg': theme.bg,
        '--event-border': theme.border,
        '--event-dot': theme.dot || theme.border,
        '--event-text': theme.text,
      },
    }
  }, [])

  const backgroundEventPropGetter = useCallback((event) => {
    if (event?.type !== 'break') return {}
    return { className: 'pro-agenda__break' }
  }, [])

  const formats = useMemo(
    () => ({
      timeGutterFormat: (date) => formatTime24h(date),
      eventTimeRangeFormat: ({ start, end }) => formatHourRange(start, end),
      dayFormat: (date) => {
        const dt = date instanceof Date ? date : new Date(date)
        const label = WEEKDAY_SHORT_LABELS[dt.getDay()] || ''
        const day = String(dt.getDate()).padStart(2, '0')
        const month = String(dt.getMonth() + 1).padStart(2, '0')
        return `${label} ${day}/${month}`
      },
    }),
    []
  )

  const AgendaEvent = ({ event }) => {
    const theme = event?._theme || getAgendaTheme(event?.status)
    const serviceLabel = event?.service || event?.title || 'Servico'
    const clientLabel = event?.client ? ` - ${event.client}` : ''
    const handleOpenDetails = () => setSelectedEvent(event)
    const handleKeyDown = (eventKey) => {
      if (eventKey.key === 'Enter' || eventKey.key === ' ') {
        eventKey.preventDefault()
        handleOpenDetails()
      }
    }

    return (
      <div
        className="pro-agenda__event-card"
        role="button"
        tabIndex={0}
        onClick={handleOpenDetails}
        onKeyDown={handleKeyDown}
      >
        <div className="pro-agenda__event-top">
          <span className="pro-agenda__event-bar" style={{ backgroundColor: theme.dot }} />
          <div className="pro-agenda__event-lines">
            <div className="pro-agenda__event-title" title={`${serviceLabel}${clientLabel}`}>
              {serviceLabel}{clientLabel}
            </div>
            <div className="pro-agenda__event-sub">{formatHourRange(event?.start, event?.end)}</div>
          </div>
        </div>
      </div>
    )
  }

  const handlePrevWeek = () =>
    setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7))
  const handleNextWeek = () =>
    setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7))
  const handleToday = () => setCurrentDate(new Date())
  const handleSelectResource = (id) => {
    setResourceFilter(id)
    setFilterOpen(false)
  }

  useEffect(() => {
    if (!filterOpen) return
    const handleClickOutside = (event) => {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [filterOpen])

  const selectedEventResource = selectedEvent ? resourceLookup.get(selectedEvent.resourceId) : null
  const selectedEventStatus = selectedEvent ? getStatusPresentation(selectedEvent) : null
  const selectedEventTitle = selectedEvent
    ? `${selectedEvent.service || selectedEvent.title || 'Servico'}${selectedEvent.client ? ` - ${selectedEvent.client}` : ''}`
    : ''
  const selectedEventDate = selectedEvent ? DateHelpers.formatDateFull(selectedEvent.start) : ''
  const selectedEventTime = selectedEvent ? formatHourRange(selectedEvent.start, selectedEvent.end) : ''
  const selectedEventStartMs = selectedEvent
    ? selectedEvent.start instanceof Date
      ? selectedEvent.start.getTime()
      : new Date(selectedEvent.start).getTime()
    : NaN
  const selectedEventHasStarted = Number.isFinite(selectedEventStartMs) && selectedEventStartMs <= Date.now()
  const modalTitleId = selectedEvent?.id ? `agenda-modal-title-${selectedEvent.id}` : 'agenda-modal-title'
  const selfBookingTitleId = 'agenda-self-booking-title'
  const whatsappLink = selectedEvent ? buildWhatsappLink(selectedEvent) : null
  const whatsappLabel = whatsappLink ? 'WhatsApp' : 'Telefone não informado'
  const canReschedule =
    Boolean(selectedEvent) &&
    !selectedEventStatus?.isCancelled &&
    !selectedEventStatus?.isDone
  const rescheduleDisabled = rescheduleSaving || selectedEventHasStarted || !canReschedule

  const handleCloseDetails = () => setSelectedEvent(null)
  const handleWhatsapp = () => {
    if (!whatsappLink) return
    window.open(whatsappLink, '_blank', 'noopener,noreferrer')
  }
  const handleToggleReschedule = () => {
    if (rescheduleDisabled) return
    setRescheduleOpen((open) => !open)
    setRescheduleError('')
  }
  const handleRescheduleSelected = async () => {
    if (!selectedEvent || rescheduleSaving || !canReschedule) return
    if (selectedEventHasStarted) {
      setRescheduleError('Reagendamento indisponível: horário já iniciado.')
      return
    }
    if (!rescheduleDate || !rescheduleTime) {
      setRescheduleError('Informe data e horário.')
      return
    }
    const localDateTime = new Date(`${rescheduleDate}T${rescheduleTime}:00`)
    if (!Number.isFinite(localDateTime.getTime())) {
      setRescheduleError('Data/hora inválida.')
      return
    }
    if (localDateTime.getTime() <= Date.now()) {
      setRescheduleError('Não é possível reagendar no passado.')
      return
    }
    const payload = { inicio: localDateTime.toISOString() }
    const prevStart = selectedEvent.start instanceof Date
      ? selectedEvent.start
      : new Date(selectedEvent.start)
    const prevEnd = selectedEvent.end instanceof Date
      ? selectedEvent.end
      : new Date(selectedEvent.end)
    const durationMs = Number.isFinite(prevEnd.getTime()) && Number.isFinite(prevStart.getTime())
      ? prevEnd.getTime() - prevStart.getTime()
      : 0
    try {
      setRescheduleSaving(true)
      setRescheduleError('')
      const updated = await Api.reagendarAgendamentoEstab(selectedEvent.id, payload)
      const nextInicioRaw = updated?.inicio || payload.inicio
      const nextFimRaw = updated?.fim || null
      const nextStartDate = new Date(nextInicioRaw)
      let nextEndDate = nextFimRaw ? new Date(nextFimRaw) : null
      if (!nextEndDate || !Number.isFinite(nextEndDate.getTime())) {
        if (Number.isFinite(durationMs) && durationMs > 0 && Number.isFinite(nextStartDate.getTime())) {
          nextEndDate = new Date(nextStartDate.getTime() + durationMs)
        } else {
          nextEndDate = prevEnd
        }
      }
      const prevEndIso = Number.isFinite(prevEnd.getTime()) ? prevEnd.toISOString() : null
      const nextEndIso =
        nextFimRaw ||
        (nextEndDate && Number.isFinite(nextEndDate.getTime()) ? nextEndDate.toISOString() : null) ||
        prevEndIso
      if (onUpdateAppointment) {
        onUpdateAppointment(selectedEvent.id, {
          inicio: nextInicioRaw,
          fim: nextEndIso || payload.inicio,
        })
      }
      setSelectedEvent((prev) =>
        prev ? { ...prev, start: nextStartDate, end: nextEndDate } : prev
      )
      if (Number.isFinite(nextStartDate.getTime())) {
        setRescheduleDate(DateHelpers.formatLocalISO(nextStartDate))
        setRescheduleTime(formatTime24h(nextStartDate))
      }
      setRescheduleOpen(false)
    } catch (err) {
      const msg = err?.data?.message || err?.message || 'Não foi possível reagendar.'
      setRescheduleError(msg)
    } finally {
      setRescheduleSaving(false)
    }
  }
  const handleCancelSelected = async () => {
    if (!selectedEvent || !onForceCancel || cancelling) return
    if (selectedEventHasStarted) return
    if (selectedEventStatus?.isCancelled) return
    const confirmed = window.confirm('Cancelar este agendamento? O cliente sera notificado.')
    if (!confirmed) return
    try {
      setCancelling(true)
      await onForceCancel(selectedEvent.id)
      setSelectedEvent((prev) => (prev ? { ...prev, status: 'cancelado' } : prev))
    } catch (err) {
      const msg = err?.data?.message || err?.message || 'Não foi possível cancelar.'
      window.alert(msg)
    } finally {
      setCancelling(false)
    }
  }

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
      setSelfBookingError('Informe nome, email e telefone.')
      return
    }
    if (!isValidEmail(email)) {
      setSelfBookingError('Informe um email válido.')
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
      servico_id: servicoIdNum,
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
        'Servico'
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
        servico_id: servicoIdNum,
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
    <div className="pro-agenda">
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
      <div className="pro-agenda__toolbar">
        <div className="pro-agenda__toolbar-row pro-agenda__toolbar-row--top">
          <div className="pro-agenda__kpis">
            <div className="pro-agenda__kpi">
              <span>Proximo agendamento</span>
              <b title={nextAppointmentInfo.title}>{nextAppointmentInfo.label}</b>
            </div>
            <div className="pro-agenda__filter" ref={filterRef}>
              <button
                type="button"
                className="pro-agenda__filter-btn"
                onClick={() => setFilterOpen((open) => !open)}
                title="Filtrar por profissional"
                aria-expanded={filterOpen}
                aria-label="Selecionar profissional"
                aria-haspopup="listbox"
              >
                {selectedResource?.avatar ? (
                  <img src={selectedResource.avatar} alt={selectedResource.title} className="pro-agenda__filter-avatar" />
                ) : (
                  <div
                    className={`pro-agenda__filter-avatar pro-agenda__filter-avatar--fallback${resourceFilter === 'all' ? ' pro-agenda__filter-avatar--all' : ''}`}
                  >
                    {(selectedResource?.title || 'Todos').slice(0, 2).toUpperCase()}
                  </div>
                )}
                <span className={resourceFilter === 'all' ? 'pro-agenda__filter-text--all' : undefined}>
                  {selectedResource?.title || 'Todos profissionais'}
                </span>
                <span className="pro-agenda__caret" aria-hidden="true">v</span>
              </button>
              {filterOpen && (
                <div className="pro-agenda__filter-menu">
                  <button
                    type="button"
                    className={`pro-agenda__filter-option ${resourceFilter === 'all' ? 'is-active' : ''}`}
                    onClick={() => handleSelectResource('all')}
                  >
                    <div className="pro-agenda__filter-avatar pro-agenda__filter-avatar--fallback pro-agenda__filter-avatar--all">TO</div>
                    <span className="pro-agenda__filter-text--all">Todos profissionais</span>
                  </button>
                  {resources.map((res) => (
                    <button
                      key={res.id}
                      type="button"
                      className={`pro-agenda__filter-option ${resourceFilter === res.id ? 'is-active' : ''}`}
                      onClick={() => handleSelectResource(res.id)}
                    >
                      {res.avatar ? (
                        <img src={res.avatar} alt={res.title} className="pro-agenda__filter-avatar" />
                      ) : (
                        <div className="pro-agenda__filter-avatar pro-agenda__filter-avatar--fallback">
                          {(res.title || 'PR').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span>{res.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="pro-agenda__toolbar-row pro-agenda__toolbar-row--bottom">
          <div className="pro-agenda__nav">
            <button
              className="pro-agenda__mini"
              type="button"
              aria-label="Semana anterior"
              onClick={handlePrevWeek}
            >
              {'<'}
            </button>
            <button className="pro-agenda__btn" type="button" onClick={handleToday}>
              Hoje
            </button>
            <button
              className="pro-agenda__mini"
              type="button"
              aria-label="Proxima semana"
              onClick={handleNextWeek}
            >
              {'>'}
            </button>
          </div>
          <div className="pro-agenda__date-pill">{weekLabel}</div>
          <button
            type="button"
            className="pro-agenda__add"
            onClick={handleOpenSelfBooking}
            title="Novo agendamento"
            aria-label="Novo agendamento"
          >
            +
          </button>
        </div>
      </div>

      <div className="pro-agenda__calendar">
        <BigCalendar
          localizer={localizer}
          culture="pt-br"
          events={filteredEvents}
          backgroundEvents={breakBackgroundEvents}
          startAccessor="start"
          endAccessor="end"
          defaultView={Views.WEEK}
          views={[Views.WEEK]}
          step={CALENDAR_STEP_MINUTES}
          timeslots={1}
          style={{ height: 720 }}
          eventPropGetter={eventStyleGetter}
          backgroundEventPropGetter={backgroundEventPropGetter}
          selectable={false}
          toolbar={false}
          formats={formats}
          dayLayoutAlgorithm="no-overlap"
          components={{
            event: AgendaEvent,
            timeGutterHeader: () => <span className="pro-agenda__gutter-head">Hora</span>,
          }}
          min={timeBounds.min}
          max={timeBounds.max}
          scrollToTime={timeBounds.scrollToTime}
          date={currentDate}
          onNavigate={(date) => setCurrentDate(date instanceof Date ? date : new Date(date))}
        />
      </div>
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
                        aria-label="Proximo mes"
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
                    <div className="empty">Escolha uma data no calendario acima.</div>
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
                  <span>Email</span>
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
      {selectedEvent && (
        <div className="modal-backdrop" role="presentation" onClick={handleCloseDetails}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            onClick={(eventClick) => eventClick.stopPropagation()}
          >
            <div className="modal__header">
              <h3 className="modal__title" id={modalTitleId}>Detalhes do agendamento</h3>
              <button type="button" className="modal__close" onClick={handleCloseDetails} aria-label="Fechar">
                ×
              </button>
            </div>
            <div className="modal__body">
              <div className="pro-agenda__modal-title">{selectedEventTitle}</div>
              {selectedEventStatus && (
                <div className="pro-agenda__modal-status">
                  <span className={selectedEventStatus.badgeClass} aria-label={selectedEventStatus.label}>
                    {selectedEventStatus.label}
                  </span>
                </div>
              )}
              <div className="pro-agenda__modal-grid">
                <div>
                  <div className="pro-agenda__modal-label">Data</div>
                  <div className="pro-agenda__modal-value">{selectedEventDate}</div>
                </div>
                <div>
                  <div className="pro-agenda__modal-label">Horário</div>
                  <div className="pro-agenda__modal-value">{selectedEventTime}</div>
                </div>
                <div>
                  <div className="pro-agenda__modal-label">Profissional</div>
                  <div className="pro-agenda__modal-value">{selectedEventResource?.title || 'Profissional'}</div>
                </div>
                <div>
                  <div className="pro-agenda__modal-label">Cliente</div>
                  <div className="pro-agenda__modal-value">{selectedEvent?.client || 'Não informado'}</div>
                </div>
                <div>
                  <div className="pro-agenda__modal-label">Serviço</div>
                  <div className="pro-agenda__modal-value">{selectedEvent?.service || 'Serviço'}</div>
                </div>
              </div>
              {canReschedule && (
                <div className="pro-agenda__modal-reschedule">
                  <div className="pro-agenda__modal-reschedule-head">
                    <button
                      type="button"
                      className="btn btn--outline btn--sm"
                      onClick={handleToggleReschedule}
                      disabled={rescheduleDisabled}
                    >
                      {rescheduleOpen ? 'Cancelar alteração' : 'Alterar data/hora'}
                    </button>
                  </div>
                  {rescheduleOpen && (
                    <div className="pro-agenda__modal-reschedule-grid">
                      <label className="label">
                        <span>Nova data</span>
                        <input
                          type="date"
                          className="input"
                          value={rescheduleDate}
                          onChange={(eventChange) => {
                            setRescheduleDate(eventChange.target.value)
                            if (rescheduleError) setRescheduleError('')
                          }}
                        />
                      </label>
                      <label className="label">
                        <span>Novo horário</span>
                        <input
                          type="time"
                          className="input"
                          value={rescheduleTime}
                          onChange={(eventChange) => {
                            setRescheduleTime(eventChange.target.value)
                            if (rescheduleError) setRescheduleError('')
                          }}
                        />
                      </label>
                    </div>
                  )}
                  {rescheduleError && (
                    <div className="pro-agenda__modal-note pro-agenda__modal-note--warn">
                      {rescheduleError}
                    </div>
                  )}
                </div>
              )}
              {selectedEventHasStarted && !selectedEventStatus?.isCancelled && (
                <div className="pro-agenda__modal-note">
                  Cancelamento indisponível: horário já iniciado.
                </div>
              )}
            </div>
            <div className="modal__actions pro-agenda__modal-actions">
              {rescheduleOpen && (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={handleRescheduleSelected}
                  disabled={rescheduleSaving}
                >
                  {rescheduleSaving ? 'Salvando...' : 'Salvar'}
                </button>
              )}
              {!selectedEventStatus?.isCancelled && (
                <button
                  type="button"
                  className="btn pro-agenda__modal-cancel btn--sm"
                  onClick={handleCancelSelected}
                  disabled={cancelling || selectedEventHasStarted}
                >
                  {cancelling ? 'Cancelando...' : 'Cancelar agendamento'}
                </button>
              )}
              <button
                type="button"
                className="btn pro-agenda__modal-whatsapp btn--sm"
                onClick={handleWhatsapp}
                disabled={!whatsappLink}
                title={whatsappLabel}
                aria-label={whatsappLabel}
              >
                WhatsApp
              </button>
              <button type="button" className="btn btn--outline btn--sm" onClick={handleCloseDetails}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

}
