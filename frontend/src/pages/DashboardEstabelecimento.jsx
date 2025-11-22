import React, { useCallback, useEffect, useMemo, useState } from 'react'
import moment from 'moment'
import { Calendar as BigCalendar, momentLocalizer, Views } from 'react-big-calendar'
import { Api } from '../utils/api'
import { IconBell } from '../components/Icons.jsx'
import { getUser, USER_EVENT } from '../utils/auth'

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
    const dt = new Date(datetime)
    const hh = String(dt.getHours()).padStart(2, '0')
    const mm = String(dt.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
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

const DEFAULT_BUSINESS_HOURS = { start: 7, end: 22 }

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

const pad2 = (n) => String(n).padStart(2, '0')
const localKey = (dateish) => {
  const d = new Date(dateish)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}`
}

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

const fillBusinessGrid = ({ currentWeek, slots, stepMinutes = 30, workingSchedule = null }) => {
  const { days } = (function getDays(iso) {
    const ds = DateHelpers.weekDays(iso)
    return { days: ds }
  })(currentWeek)

  const byKey = new Map()
  if (Array.isArray(slots)) {
    slots.forEach((s) => byKey.set(localKey(s.datetime), s))
  }

  const filled = []
  for (const { date } of days) {
    const dayRule = workingSchedule ? workingSchedule[date.getDay()] : null
    if (workingSchedule && (!dayRule || !dayRule.enabled)) continue

    const start = new Date(date)
    const end = new Date(date)

    if (dayRule && dayRule.enabled) {
      const [startHour, startMinute] = dayRule.start.split(':').map(Number)
      const [endHour, endMinute] = dayRule.end.split(':').map(Number)
      start.setHours(startHour, startMinute, 0, 0)
      end.setHours(endHour, endMinute, 0, 0)
    } else {
      start.setHours(DEFAULT_BUSINESS_HOURS.start, 0, 0, 0)
      end.setHours(DEFAULT_BUSINESS_HOURS.end, 0, 0, 0)
    }

    for (let t = start.getTime(); t <= end.getTime(); t += stepMinutes * 60000) {
      const k = localKey(t)
      const existing = byKey.get(k)
      const slotDate = new Date(t)
      const minutesOfDay = slotDate.getHours() * 60 + slotDate.getMinutes()
      const blockedByRule =
        dayRule &&
        Array.isArray(dayRule.blockMinutes) &&
        dayRule.blockMinutes.some(([startMin, endMin]) => minutesOfDay >= startMin && minutesOfDay < endMin)
      const normalizedLabel = existing ? normalizeSlotLabel(existing.label) : ''
      const baseSlot = existing
        ? { ...existing }
        : { datetime: slotDate.toISOString(), label: 'disponivel', status: 'available' }

      if (blockedByRule && normalizedLabel !== 'agendado') {
        baseSlot.label = 'bloqueado'
        baseSlot.status = 'blocked'
      } else if (!baseSlot.status) {
        baseSlot.status = normalizedLabel === 'agendado' ? 'booked' : 'available'
      }

      filled.push(baseSlot)
    }
  }
  return filled
}

const normalizeSlotsList = (data) => {
  const arr = Array.isArray(data) ? data : data?.slots || []
  return arr.map((slot) => {
    const datetime =
      slot.datetime ||
      slot.data ||
      slot.start_time ||
      slot.start ||
      slot.time ||
      slot.hora ||
      slot.date ||
      slot.startDate ||
      slot.startDateTime ||
      slot.slot ||
      slot.at ||
      slot.when ||
      ''
    let label =
      slot.label ||
      slot.status ||
      slot.disponibilidade ||
      slot.disponivel ||
      slot.situacao ||
      slot.nome ||
      slot.tipo ||
      slot.kind ||
      ''
    const raw = String(label || '').toLowerCase()
    label =
      raw.includes('agen') || raw.includes('ocup') || raw.includes('book')
        ? 'agendado'
        : raw.includes('bloq') || raw.includes('block') || raw.includes('indisp') || raw.includes('close')
        ? 'bloqueado'
        : raw.includes('disp') || raw.includes('avail')
        ? 'disponivel'
        : raw.includes('manut')
        ? 'bloqueado'
        : slot.status === 'busy'
        ? 'agendado'
        : slot.status === 'blocked'
        ? 'bloqueado'
        : slot.status === 'available'
        ? 'disponivel'
        : raw.includes('book')
        ? 'agendado'
        : raw.includes('unavail') || raw.includes('block') || raw.includes('bloq')
        ? 'bloqueado'
        : 'disponivel'
    if (['agendado', 'bloqueado'].includes(normalizeSlotLabel(slot.label)) || isAvailableLabel(slot.label)) {
      label = String(slot.label).toLowerCase()
    }
    return { ...slot, datetime, label }
  })
}

export default function DashboardEstabelecimento() {
  const [itens, setItens] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('confirmado')
  const [currentUser, setCurrentUser] = useState(() => getUser())
  const [showCalendar, setShowCalendar] = useState(false)
  const [showProAgenda, setShowProAgenda] = useState(false)
  const establishmentId =
    currentUser && currentUser.tipo === 'estabelecimento' ? currentUser.id : null

  const dayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short',
      }),
    []
  )
  const weekdayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('pt-BR', {
        weekday: 'short',
      }),
    []
  )
  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    []
  )

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
    let mounted = true
    setLoading(true)
    const reqStatus =
      status === 'todos' ? 'todos' : status === 'concluido' ? 'confirmado' : status
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

  const statusMeta = (s) => {
    const v = String(s || '').toLowerCase()
    if (v === 'confirmado') return { cls: 'ok', label: 'confirmado' }
    if (v === 'concluido') return { cls: 'done', label: 'concluído' }
    if (v === 'cancelado') return { cls: 'out', label: 'cancelado' }
    return { cls: 'pending', label: v || 'pendente' }
  }

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
    if (status !== 'concluido') return itens
    return itens.filter((i) => new Date(i.fim || i.inicio).getTime() < Date.now())
  }, [itens, status])

  const calendarData = useMemo(() => {
    const map = new Map()
    for (const item of filtered) {
      const date = new Date(item.inicio)
      const key = date.toISOString().slice(0, 10)
      if (!map.has(key)) map.set(key, { date, items: [] })
      map.get(key).items.push(item)
    }
    return Array.from(map.values())
      .sort((a, b) => a.date - b.date)
      .map((entry) => ({
        key: entry.date.toISOString(),
        label: dayFormatter.format(entry.date),
        weekday: weekdayFormatter.format(entry.date),
        items: entry.items.sort((a, b) => new Date(a.inicio) - new Date(b.inicio)),
      }))
  }, [filtered, dayFormatter, weekdayFormatter])

  return (
    <div className="dashboard-narrow">
      <div className="card">
        <div className="row spread" style={{ marginBottom: 8 }}>
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Agendamentos</h2>
            <div className="notif-bell" title="Notifica??es de agendamentos">
              <IconBell className="notif-bell__icon" aria-hidden="true" />
              <span className="notif-bell__pill"> Recebidos {totals.recebidos} </span>
              <span className="notif-bell__pill notif-bell__pill--cancel">
                Cancelados {totals.cancelados}
              </span>
            </div>
          </div>
          <div
            className="row"
            style={{ gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}
          >
            <button
              type="button"
              className="btn btn--outline"
              style={{ borderColor: "var(--brand)", color: "var(--brand)" }}
              onClick={() => setShowProAgenda((open) => !open)}
            >
              {showProAgenda ? "Ocultar agenda de profissionais" : "Agenda de profissionais"}
            </button>
            <button
              type="button"
              className="btn btn--outline"
              style={{ borderColor: "var(--brand)", color: "var(--brand)" }}
              onClick={() => setShowCalendar((open) => !open)}
            >
              {showCalendar ? "Ocultar calendário" : "Ver calendário"}
            </button>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              title="Status"
            >
              <option value="confirmado">Confirmados</option>
              <option value="concluido">Conclu?dos</option>
              <option value="cancelado">Cancelados</option>
              <option value="todos">Todos</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div
            className="day-skeleton"
            style={{ gridTemplateColumns: '1fr', marginTop: 8 }}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="shimmer pill" />
            ))}
          </div>
        ) : calendarData.length === 0 ? (
          <div className="empty">Nenhum agendamento nesta visão.</div>
        ) : (
          <div className="calendar-grid">
            {calendarData.map((day) => (
              <div className="calendar-day" key={day.key}>
                <header className="calendar-day__header">
                  <span className="calendar-day__weekday">{day.weekday}</span>
                  <strong>{day.label}</strong>
                </header>
                <ul className="calendar-day__list">
                  {day.items.map((item) => {
                    const past =
                      new Date(item.fim || item.inicio).getTime() < Date.now()
                    const effective =
                      String(item.status || '').toLowerCase() === 'confirmado' && past
                        ? 'concluido'
                        : item.status
                    const { cls, label } = statusMeta(effective)
                    return (
                      <li className="calendar-entry" key={item.id}>
                        <span className="calendar-entry__time">
                          {timeFormatter.format(new Date(item.inicio))}
                        </span>
                        <div className="calendar-entry__info">
                          <div className="calendar-entry__service">
                            {item.servico_nome}
                          </div>
                          <div className="calendar-entry__client">
                            {item.cliente_nome}
                          </div>
                        </div>
                        <span className={`badge ${cls}`}>{label}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
      {showCalendar && (
        <div style={{ marginTop: 16 }}>
          <CalendarAvailability establishmentId={establishmentId} />
        </div>
      )}
      {showProAgenda && (
        <div style={{ marginTop: 16 }}>
          <ProfessionalAgendaView items={filtered} />
        </div>
      )}
    </div>
  )
}

function CalendarAvailability({ establishmentId }) {
  const todayIso = DateHelpers.toISODate(new Date())
  const [selectedDate, setSelectedDate] = useState(todayIso)
  const [monthStart, setMonthStart] = useState(DateHelpers.firstOfMonthISO(new Date()))
  const currentWeek = useMemo(() => DateHelpers.weekStartISO(selectedDate || todayIso), [selectedDate, todayIso])
  const [slotState, setSlotState] = useState({ week: '', slots: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [workingSchedule, setWorkingSchedule] = useState(null)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [reloadCounter, setReloadCounter] = useState(0)

  useEffect(() => {
    if (!establishmentId) {
      setWorkingSchedule(null)
      setScheduleLoading(false)
      return
    }
    let cancelled = false
    setScheduleLoading(true)
    ;(async () => {
      try {
        const data = await Api.getEstablishment(establishmentId)
        if (cancelled) return
        const list = Array.isArray(data?.profile?.horarios) ? data.profile.horarios : []
        setWorkingSchedule(buildWorkingSchedule(list))
      } catch {
        if (cancelled) return
        setWorkingSchedule(null)
      } finally {
        if (!cancelled) setScheduleLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [establishmentId])

  useEffect(() => {
    if (!establishmentId) {
      setSlotState({ week: '', slots: [] })
      setError('')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const slotsData = await Api.getSlots(establishmentId, currentWeek, { includeBusy: true })
        if (cancelled) return
        const normalized = normalizeSlotsList(slotsData)
        setSlotState({ week: currentWeek, slots: normalized })
      } catch {
        if (cancelled) return
        setSlotState({ week: currentWeek, slots: [] })
        setError('Não foi possível carregar os horários.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [establishmentId, currentWeek, reloadCounter])

  const handleReload = useCallback(() => {
    setReloadCounter((prev) => prev + 1)
  }, [])

  const filledSlots = useMemo(() => {
    if (slotState.week !== currentWeek) return []
    return fillBusinessGrid({ currentWeek, slots: slotState.slots, stepMinutes: 30, workingSchedule })
  }, [slotState, currentWeek, workingSchedule])

  const groupedSlots = useMemo(() => {
    const map = new Map()
    filledSlots.forEach((slot) => {
      const key = DateHelpers.toISODate(slot.datetime)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(slot)
    })
    map.forEach((entries) => entries.sort((a, b) => new Date(a.datetime) - new Date(b.datetime)))
    return map
  }, [filledSlots])

  const selectedSlots = selectedDate ? groupedSlots.get(selectedDate) || [] : []
  const selectedDayRule = useMemo(
    () => getScheduleRuleForDate(selectedDate, workingSchedule),
    [selectedDate, workingSchedule]
  )
  const isStaleWeek = slotState.week !== currentWeek

  const handlePickDay = (iso) => {
    if (!iso) return
    setSelectedDate(iso)
    setMonthStart((prev) =>
      DateHelpers.isSameMonth(prev, iso) ? prev : DateHelpers.firstOfMonthISO(iso)
    )
  }

  const handleMonthChange = (delta) => {
    setMonthStart(DateHelpers.formatLocalISO(DateHelpers.addMonths(monthStart, delta)))
  }

  if (!establishmentId) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Calendário de disponibilidade</h3>
        <div className="empty">Disponível apenas para contas de estabelecimento.</div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="row spread" style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div>
          <h3 style={{ margin: 0 }}>Calendário de disponibilidade</h3>
          <small className="muted">Visualização de horários igual ao fluxo do cliente.</small>
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          {scheduleLoading && <span className="muted" style={{ fontSize: 12 }}>Atualizando horários…</span>}
          <button type="button" className="btn btn--sm" onClick={handleReload} disabled={loading}>
            {loading ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>
      </div>

      <div className="novo-agendamento__calendar">
        <div className="month card" style={{ padding: 8, marginBottom: 8 }}>
          <div className="row spread" style={{ alignItems: 'center', marginBottom: 6 }}>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <button className="btn btn--sm" type="button" aria-label="Mês anterior" onClick={() => handleMonthChange(-1)}>
                ‹
              </button>
              <strong>
                {new Date(monthStart + 'T00:00:00').toLocaleDateString('pt-BR', {
                  month: 'long',
                  year: 'numeric',
                })}
              </strong>
              <button className="btn btn--sm" type="button" aria-label="Próximo mês" onClick={() => handleMonthChange(1)}>
                ›
              </button>
            </div>
          </div>
          <div className="month__grid">
            {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d, index) => (
              <div key={`${d}-${index}`} className="month__dow muted">
                {d}
              </div>
            ))}
            {DateHelpers.monthGrid(monthStart).map(({ iso, inMonth, date }) => {
              const isToday = DateHelpers.sameYMD(iso, todayIso)
              const isPastDay = iso < todayIso
              const isSelected = selectedDate && DateHelpers.sameYMD(selectedDate, iso)
              const classNameParts = ['month__day']
              if (!inMonth) classNameParts.push('is-dim')
              if (isToday) classNameParts.push('is-today')
              if (isSelected) classNameParts.push('is-selected')
              if (isPastDay) classNameParts.push('is-past')
              return (
                <button
                  key={iso}
                  type="button"
                  className={classNameParts.join(' ')}
                  onClick={isPastDay ? undefined : () => handlePickDay(iso)}
                  title={date.toLocaleDateString('pt-BR')}
                  disabled={isPastDay}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>
        </div>

        {error && (
          <div className="box error" style={{ marginTop: 8 }}>
            {error}
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn btn--sm" onClick={handleReload}>
                Tentar novamente
              </button>
            </div>
          </div>
        )}

        <div className="card" style={{ marginTop: 8 }}>
          <h4 style={{ marginTop: 0, marginBottom: 8 }}>
            {selectedDate
              ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                })
              : 'Selecione uma data'}
          </h4>
          {!selectedDate ? (
            <div className="empty">Escolha uma data no calendário.</div>
          ) : selectedDayRule && !selectedDayRule.enabled ? (
            <div className="empty">Estabelecimento não atende neste dia.</div>
          ) : (
            <div className="slots--grid">
              {loading || isStaleWeek ? (
                Array.from({ length: 8 }).map((_, index) => <div key={index} className="shimmer pill" />)
              ) : selectedSlots.length === 0 ? (
                <div className="empty">Sem horários cadastrados para este dia.</div>
              ) : (
                selectedSlots.map((slot) => <SlotPreview key={slot.datetime} slot={slot} />)
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SlotPreview({ slot }) {
  const statusClass = slotStatusClass(slot.label)
  const isPast = DateHelpers.isPastSlot(slot.datetime)
  const className = [
    'slot-btn',
    'slot-btn--compact',
    statusClass,
    isPast ? 'is-past' : '',
  ]
  return (
    <button
      type="button"
      className={className.join(' ')}
      title={`${DateHelpers.formatTime(slot.datetime)} • ${slot.label || ''}`}
      disabled
    >
      {DateHelpers.formatTime(slot.datetime)}
    </button>
  )
}

const AGENDA_STATUS_THEME = Object.freeze({
  confirmado: { label: 'Confirmado', bg: '#ecfdf3', border: '#bbf7d0', dot: '#16a34a', text: '#0a3b28', badge: 'rgba(22, 163, 74, 0.16)' },
  concluido: { label: 'Concluido', bg: '#eff6ff', border: '#bfdbfe', dot: '#1d4ed8', text: '#102a59', badge: 'rgba(29, 78, 216, 0.14)' },
  cancelado: { label: 'Cancelado', bg: '#fef2f2', border: '#fecaca', dot: '#dc2626', text: '#7f1d1d', badge: 'rgba(220, 38, 38, 0.12)' },
  pendente: { label: 'Pendente', bg: '#fff7ed', border: '#fed7aa', dot: '#f97316', text: '#7c2d12', badge: 'rgba(249, 115, 22, 0.12)' },
  default: { label: 'Agendamento', bg: '#e0f2fe', border: '#bae6fd', dot: '#0284c7', text: '#0c4a6e', badge: 'rgba(2, 132, 199, 0.12)' },
})

const getAgendaTheme = (status) => AGENDA_STATUS_THEME[status] || AGENDA_STATUS_THEME.default
const formatHourRange = (start, end) => {
  if (!start || !end) return ''
  return `${DateHelpers.formatTime(start)} - ${DateHelpers.formatTime(end)}`
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


function ProfessionalAgendaView({ items }) {
  const resources = useMemo(() => {
    const map = new Map()
    ;(items || []).forEach((item) => {
      const id =
        item?.profissional_id ||
        item?.professional_id ||
        item?.profissional ||
        item?.professional ||
        item?.profissional_nome ||
        item?.professional_name ||
        'sem-id'
      const name =
        item?.profissional_nome ||
        item?.profissional ||
        item?.professional_name ||
        item?.professional ||
        'Profissional'
      const avatar = item?.profissional_avatar_url || item?.professional_avatar || null
      if (!map.has(id)) map.set(id, { id, title: name, avatar })
    })
    if (!map.size) map.set('sem-id', { id: 'sem-id', title: 'Profissional', avatar: null })
    return Array.from(map.values()).sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
  }, [items])

  const resourceThemes = useMemo(() => {
    const themes = new Map()
    resources.forEach((res, index) => {
      const palette = RESOURCE_COLORS[index % RESOURCE_COLORS.length]
      themes.set(res.id, palette)
    })
    return themes
  }, [resources])

  const [resourceFilter, setResourceFilter] = useState('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = React.useRef(null)

  const events = useMemo(() => {
    return (items || [])
      .map((item) => {
        const start = new Date(item?.inicio || item?.start || 0)
        let end = new Date(item?.fim || item?.fim_prevista || item?.end || start)
        if (!Number.isFinite(start.getTime())) return null
        if (!Number.isFinite(end.getTime()) || end <= start) {
          end = new Date(start.getTime() + 30 * 60000)
        }
        const resourceId =
          item?.profissional_id ||
          item?.professional_id ||
          item?.profissional ||
          item?.professional ||
          item?.profissional_nome ||
          item?.professional_name ||
          'sem-id'
        const service = item?.servico_nome || item?.service_name || 'Servico'
        const client = item?.cliente_nome || item?.client_name || ''
        const title = client ? `${client} - ${service}` : service
        const status = String(item?.status || '').toLowerCase()
        const baseTheme = resourceThemes.get(resourceId) || RESOURCE_COLORS[0]
        const theme = status === 'cancelado' ? getAgendaTheme(status) : baseTheme
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
          statusLabel: theme.label,
          _theme: theme,
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.resourceId !== b.resourceId) return String(a.resourceId).localeCompare(String(b.resourceId))
        return new Date(a.start) - new Date(b.start)
      })
  }, [items])

  const filteredResources = useMemo(
    () => (resourceFilter === 'all' ? resources : resources.filter((r) => r.id === resourceFilter)),
    [resources, resourceFilter]
  )

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
  const [currentDate, setCurrentDate] = useState(initialDate)
  useEffect(() => {
    setCurrentDate(initialDate)
  }, [initialDate])

  const currentDateIso = useMemo(
    () => DateHelpers.toISODate(currentDate instanceof Date ? currentDate : new Date()),
    [currentDate]
  )

  const eventsForCurrentDate = useMemo(
    () => filteredEvents.filter((ev) => DateHelpers.sameYMD(DateHelpers.toISODate(ev.start), currentDateIso)),
    [filteredEvents, currentDateIso]
  )

  const timeBounds = useMemo(() => {
    if (!eventsForCurrentDate.length) {
      const min = new Date(); min.setHours(7, 0, 0, 0)
      const max = new Date(); max.setHours(20, 0, 0, 0)
      return { min, max, scrollToTime: min }
    }
    const minHour = Math.max(0, Math.min(...eventsForCurrentDate.map((ev) => ev.start.getHours())) - 1)
    const maxHour = Math.min(23, Math.max(...eventsForCurrentDate.map((ev) => ev.end.getHours())) + 2)
    const base = currentDate instanceof Date ? currentDate : new Date()
    const min = new Date(base); min.setHours(minHour, 0, 0, 0)
    const max = new Date(base); max.setHours(maxHour, 0, 0, 0)
    const scrollToTime = new Date(base); scrollToTime.setHours(minHour + 1, 0, 0, 0)
    return { min, max, scrollToTime }
  }, [eventsForCurrentDate, currentDate])

  const eventStyleGetter = useCallback((event) => {
    const theme = event?._theme || getAgendaTheme(event?.status)
    return {
      className: 'pro-agenda__event',
      style: {
        backgroundColor: theme.bg,
        border: `1px solid ${theme.border}`,
        color: theme.text,
        borderRadius: 10,
        padding: '4px 6px',
        boxShadow: '0 8px 14px rgba(15,23,42,0.10)',
        borderLeft: `4px solid ${theme.dot || theme.border}`,
      },
    }
  }, [])

  const formats = useMemo(
    () => ({
      timeGutterFormat: (date, culture, loc) => loc.format(date, 'HH:mm', culture),
      eventTimeRangeFormat: ({ start, end }, culture, loc) =>
        `${loc.format(start, 'HH:mm', culture)} - ${loc.format(end, 'HH:mm', culture)}`,
      dayHeaderFormat: () => '',
    }),
    []
  )

  const ResourceHeader = useCallback(
    ({ resource }) => {
      const theme = resourceThemes.get(resource?.id) || RESOURCE_COLORS[0]
      return (
        <div className="pro-agenda__resource-header">
          <span className="pro-agenda__resource-dot" style={{ backgroundColor: theme.dot || theme.border }} />
          {resource?.avatar ? (
            <img src={resource.avatar} alt={resource.title} className="pro-agenda__avatar" />
          ) : (
            <div className="pro-agenda__avatar pro-agenda__avatar--fallback">
              {(resource?.title || 'PR').slice(0, 2).toUpperCase()}
            </div>
          )}
          <span>{resource?.title || ''}</span>
        </div>
      )
    },
    [resourceThemes]
  )

  const AgendaEvent = useCallback(({ event }) => {
    const theme = event?._theme || getAgendaTheme(event?.status)
    const badgeStyle = { backgroundColor: theme.badge || theme.bg, color: theme.text, borderColor: theme.border }
    return (
      <div className="pro-agenda__event-card">
        <div className="pro-agenda__event-header">
          <div className="pro-agenda__event-title">
            <span className="pro-agenda__status-dot" style={{ backgroundColor: theme.dot }} />
            <strong>{event?.service || event?.title || 'Servico'}</strong>
          </div>
          <span className="pro-agenda__event-status" style={badgeStyle}>
            {event?.statusLabel || theme.label}
          </span>
        </div>
        <div className="pro-agenda__event-meta">
          <span className="pro-agenda__time">{formatHourRange(event?.start, event?.end)}</span>
          {event?.client ? <span className="pro-agenda__client">{event.client}</span> : null}
        </div>
      </div>
    )
  }, [])

  const handlePrevDay = () => setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1))
  const handleNextDay = () => setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))
  const handleToday = () => setCurrentDate(new Date())
  const currentDateLabel = useMemo(
    () =>
      (currentDate instanceof Date ? currentDate : new Date()).toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'short',
      }),
    [currentDate]
  )
  const professionalCount = resources.length
  const dayTotal = eventsForCurrentDate.length
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

  return (
    <div className="pro-agenda">
      <div className="pro-agenda__toolbar">
        <div className="pro-agenda__toolbar-left">
          <button className="btn btn--sm" type="button" onClick={handleToday}>Hoje</button>
          <div className="pro-agenda__toolbar-arrows">
            <button className="btn btn--sm" type="button" aria-label="Dia anterior" onClick={handlePrevDay}>{'<'}</button>
            <button className="btn btn--sm" type="button" aria-label="Proximo dia" onClick={handleNextDay}>{'>'}</button>
          </div>
          <span className="pro-agenda__current-date pro-agenda__current-date--blue">{currentDateLabel}</span>
        </div>
        <div className="pro-agenda__toolbar-right">
          <div className="pro-agenda__filter" ref={filterRef}>
            <button
              type="button"
              className="pro-agenda__filter-btn"
              onClick={() => setFilterOpen((open) => !open)}
              title="Filtrar por profissional"
            >
              {selectedResource?.avatar ? (
                <img src={selectedResource.avatar} alt={selectedResource.title} className="pro-agenda__filter-avatar" />
              ) : (
                <div className="pro-agenda__filter-avatar pro-agenda__filter-avatar--fallback">
                  {(selectedResource?.title || 'Todos').slice(0, 2).toUpperCase()}
                </div>
              )}
              <span>{selectedResource?.title || 'Todos profissionais'}</span>
              <span className="pro-agenda__caret">▾</span>
            </button>
            {filterOpen && (
              <div className="pro-agenda__filter-menu">
                <button
                  type="button"
                  className={`pro-agenda__filter-option ${resourceFilter === 'all' ? 'is-active' : ''}`}
                  onClick={() => handleSelectResource('all')}
                >
                  <div className="pro-agenda__filter-avatar pro-agenda__filter-avatar--fallback">TO</div>
                  <span>Todos profissionais</span>
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

      <BigCalendar
        localizer={localizer}
        events={filteredEvents}
        resources={filteredResources}
        resourceIdAccessor="id"
        resourceTitleAccessor="title"
        startAccessor="start"
        endAccessor="end"
        defaultView={Views.DAY}
        views={[Views.DAY]}
        step={15}
        timeslots={2}
        style={{ height: 720 }}
        eventPropGetter={eventStyleGetter}
        selectable={false}
        toolbar={false}
        formats={formats}
        components={{ header: () => null, resourceHeader: ResourceHeader, event: AgendaEvent }}
        min={timeBounds.min}
        max={timeBounds.max}
        scrollToTime={timeBounds.scrollToTime}
        date={currentDate}
        onNavigate={(date) => setCurrentDate(date instanceof Date ? date : new Date(date))}
      />
    </div>
  )
}
