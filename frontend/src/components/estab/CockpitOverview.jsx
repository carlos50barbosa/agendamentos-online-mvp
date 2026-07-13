import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Api, resolveAssetUrl } from '../../utils/api'
import { normalizeStatus } from '../../config/theme'
import { publicLinkFor } from '../settings/helpers.js'
import useMediaQuery from '../../hooks/useMediaQuery'
import Modal from '../Modal.jsx'
import StatusPill from '../StatusPill.jsx'
import styles from './CockpitOverview.module.css'

/* -----------------------------------------------------------------------------
 * CockpitOverview — visão geral do dia para o painel do estabelecimento.
 * Busca os agendamentos ('todos') de forma independente do filtro da agenda e
 * deriva, com dados REAIS, os indicadores do dia:
 *   - Faturamento (total_centavos, com fallback na soma dos serviços)
 *   - Confirmação no WhatsApp (cliente_confirmou_whatsapp_at)
 *   - Sinais recebidos via Asaas (deposit_paid_at / deposit_centavos)
 *   - Linha do tempo de hoje por profissional + "agora" + próximos + equipe
 * As ações operáveis (remarcar, cancelar) vivem no modal de detalhe (clique no
 * card). O CTA "Novo agendamento" abre o self-booking via onNewAppointment.
 * -------------------------------------------------------------------------- */

// Paleta por profissional (gradiente do avatar + cor sólida para barras).
const MEMBER_PALETTE = [
  { g: 'linear-gradient(140deg,#5049E5,#7A72FF)', c: '#5049E5' },
  { g: 'linear-gradient(140deg,#0EA5A0,#3ED893)', c: '#0F7A40' },
  { g: 'linear-gradient(140deg,#D9488B,#F6A5C0)', c: '#D9488B' },
  { g: 'linear-gradient(140deg,#C2751A,#FBBF4B)', c: '#C2751A' },
  { g: 'linear-gradient(140deg,#2563EB,#60A5FA)', c: '#2563EB' },
  { g: 'linear-gradient(140deg,#7C3AED,#C4B5FD)', c: '#7C3AED' },
]

const pad2 = (n) => String(n).padStart(2, '0')

// Altura de cada "linha" (row) de empilhamento dentro de uma lane da timeline (px).
const ROW_STEP = 46

const parseDate = (value) => {
  if (!value) return null
  const d = new Date(value)
  return Number.isFinite(d?.getTime?.()) ? d : null
}

const isSameLocalDay = (a, b) =>
  a && b &&
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes()

const clampPct = (value) => Math.max(0, Math.min(100, value))

const initials = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const formatBRL = (centavos, { compact = false } = {}) => {
  const value = (Number(centavos) || 0) / 100
  if (compact) {
    return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text)

const getResourceId = (item) =>
  item?.profissional_id ??
  item?.professional_id ??
  item?.profissional ??
  item?.profissional_nome ??
  'sem-id'

const getResourceName = (item) =>
  item?.profissional_nome || item?.profissional || item?.professional_name || 'Profissional'

const getConfirmedAt = (item) =>
  item?.cliente_confirmou_whatsapp_at ||
  item?.cliente_confirmou_whatsapp_em ||
  item?.client_confirmed_whatsapp_at ||
  null

const getClientPhone = (item) =>
  item?.cliente_whatsapp || item?.cliente_telefone || item?.cliente_celular ||
  item?.telefone || item?.whatsapp || ''

const getServiceLabel = (item) => {
  const names = Array.isArray(item?.servicos) ? item.servicos.map((s) => s?.nome).filter(Boolean) : []
  if (names.length) return names.join(' + ')
  return item?.servico_nome || item?.service_name || 'Serviço'
}

const getItemValueCentavos = (item) => {
  const total = Number(item?.total_centavos) || 0
  if (total > 0) return total
  const svc = Array.isArray(item?.servicos)
    ? item.servicos.reduce((sum, s) => sum + (Number(s?.preco_centavos) || 0), 0)
    : 0
  return svc
}

// Mapeia o status normalizado (+confirmação WhatsApp) para a variante visual do bloco.
const apptVariant = (norm, hasWa) => {
  if (norm === 'cancelado') return styles.apptBad
  if (norm === 'concluido') return styles.apptDone
  if (norm === 'aguardando_sinal') return styles.apptWarn
  if (norm === 'pendente') return styles.apptWarn
  if (norm === 'confirmado') return hasWa ? styles.apptOk : styles.apptBrand
  return styles.apptBrand
}

// Por que este agendamento ainda não está resolvido (null = nada a cobrar).
// É o que transforma "2 sem resposta" (número) em "João, 16:00, não confirmou" (trabalho).
const pendenciaDe = (ev) => {
  if (!ev || ev.norm === 'cancelado' || ev.norm === 'concluido') return null
  if (ev.norm === 'aguardando_sinal') return 'sinal não pago'
  if (ev.norm === 'pendente') return 'a confirmar'
  if (!ev.confirmedAt) return 'não confirmou'
  return null
}

// Rótulo curto de status exibido dentro do card da linha do tempo.
const statusShort = (norm, confirmedAt) => {
  if (norm === 'cancelado') return 'Cancelado'
  if (norm === 'concluido') return 'Concluído'
  if (norm === 'aguardando_sinal') return 'Aguardando sinal'
  if (norm === 'pendente') return 'A confirmar'
  if (norm === 'confirmado') return confirmedAt ? 'Confirmado' : 'A confirmar'
  return 'Agendado'
}

const ICONS = {
  wa: <path d="M21 11.5a8.5 8.5 0 0 1-12.7 7.4L3 20l1.2-5.1A8.5 8.5 0 1 1 21 11.5Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M20 6 9 17l-5-5" />,
}

const Icon = ({ path, width = 16, strokeWidth = 1.8 }) => (
  <svg viewBox="0 0 24 24" width={width} height={width} fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
)

// ---- Datas (semana começa na segunda) ----
const WEEKDAY_SHORT = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'] // índice = (getDay()+6)%7
const startOfDayD = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const addDaysD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const startOfWeekMon = (d) => addDaysD(startOfDayD(d), -(((new Date(d).getDay()) + 6) % 7))
const startOfMonthD = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), 1); x.setHours(0, 0, 0, 0); return x }
const ymdKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const weekIndex = (d) => (d.getDay() + 6) % 7 // seg=0 ... dom=6
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || ''

// Normaliza os agendamentos (TODAS as datas) e colapsa duplicatas exatas
// (mesmo cliente + mesmo horário de início), mantendo o de melhor status.
const STATUS_RANK = { confirmado: 3, aguardando_sinal: 2, pendente: 2, concluido: 1, cancelado: 0 }
function normalizeItems(itens) {
  const mapped = (itens || [])
    .map((item) => {
      const start = parseDate(item?.inicio || item?.start)
      if (!start) return null
      let end = parseDate(item?.fim || item?.fim_prevista || item?.end)
      if (!end || end <= start) end = new Date(start.getTime() + 30 * 60000)
      const nowMs = Date.now()
      const isPast = end.getTime() < nowMs
      let norm = normalizeStatus(item?.status, { isPast })
      // "Concluído" só APÓS o término: um agendamento resolvido como concluído (por status
      // cru 'concluido' ou coerção) cujo horário de fim ainda não passou vira confirmado.
      if (norm === 'concluido' && end.getTime() >= nowMs) norm = 'confirmado'
      return {
        id: item?.id, start, end, norm,
        resourceId: getResourceId(item), resourceName: getResourceName(item),
        client: item?.cliente_nome || item?.client_name || 'Cliente',
        service: getServiceLabel(item), confirmedAt: getConfirmedAt(item),
        clientPhone: getClientPhone(item), valueCent: getItemValueCentavos(item),
        depositPaidAt: item?.deposit_paid_at || null, depositCent: Number(item?.deposit_centavos) || 0,
      }
    })
    .filter(Boolean)
  const rankOf = (ev) => STATUS_RANK[ev.norm] ?? 1
  const byKey = new Map()
  for (const ev of mapped) {
    const key = `${String(ev.client || '').trim().toLowerCase()}|${ev.start.getTime()}`
    const cur = byKey.get(key)
    if (!cur || rankOf(ev) > rankOf(cur) || (rankOf(ev) === rankOf(cur) && Number(ev.id) > Number(cur.id))) {
      byKey.set(key, ev)
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.start - b.start)
}

// Grade do mês (6 semanas x 7 dias) com agregados por dia.
function buildMonthGrid(items, refDate, now) {
  const first = startOfMonthD(refDate)
  const gridStart = addDaysD(first, -weekIndex(first))
  const byDay = new Map()
  items.forEach((ev) => {
    const k = ymdKey(ev.start)
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k).push(ev)
  })
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = addDaysD(gridStart, i)
    const dayItems = byDay.get(ymdKey(d)) || []
    const active = dayItems.filter((e) => e.norm !== 'cancelado')
    return {
      key: ymdKey(d), date: d, day: d.getDate(),
      inMonth: d.getMonth() === refDate.getMonth(),
      isToday: isSameLocalDay(d, now),
      activeCount: active.length,
      confirmados: active.filter((e) => e.norm === 'confirmado').length,
      pendentes: active.filter((e) => e.norm === 'pendente' || e.norm === 'aguardando_sinal').length,
      cancelados: dayItems.filter((e) => e.norm === 'cancelado').length,
    }
  })
  return { cells }
}

export default function CockpitOverview({ establishmentId, currentUser, professionals = [], onNewAppointment, refreshSignal }) {
  const [itens, setItens] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => new Date())
  // A régua da timeline é dimensionada em JS (minWidth inline), então o mobile não
  // dá para resolver só com @media — precisa do mesmo corte de 780px em JS.
  const isMobile = useMediaQuery('(max-width: 780px)')
  // Linha do tempo: visão (dia/semana/mês) e data-âncora (null = hoje).
  const [view, setView] = useState('dia')
  const [anchor, setAnchor] = useState(null)
  const refDate = anchor || now
  // Scroll horizontal da linha do tempo: centraliza no "agora" ao entrar/trocar de visão.
  const tlScrollRef = useRef(null)
  const centeredViewRef = useRef(null)
  // Modal de detalhes do agendamento (ao clicar num card da linha do tempo).
  const [selectedEvent, setSelectedEvent] = useState(null)
  // Feedback do "Copiar link" do card de dia vazio.
  const [linkCopied, setLinkCopied] = useState(false)
  // Gestão dentro do modal: alterar data/hora + cancelar.
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleTime, setRescheduleTime] = useState('')
  const [modalSaving, setModalSaving] = useState(false)
  const [modalError, setModalError] = useState('')

  // Fecha o modal de detalhes com Esc.
  useEffect(() => {
    if (!selectedEvent) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && !modalSaving) setSelectedEvent(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedEvent, modalSaving])

  // Reseta o formulário de gestão ao abrir/fechar/trocar o agendamento.
  useEffect(() => {
    setRescheduleOpen(false)
    setModalError('')
    setModalSaving(false)
  }, [selectedEvent?.id])

  // Remarca (mesma API/validações do painel de baixo) e atualiza o itens local.
  const handleReschedule = async (ev) => {
    if (modalSaving) return
    if (ev.start.getTime() <= Date.now()) { setModalError('Reagendamento indisponível: horário já iniciado.'); return }
    if (!rescheduleDate || !rescheduleTime) { setModalError('Informe data e horário.'); return }
    const localDT = new Date(`${rescheduleDate}T${rescheduleTime}:00`)
    if (!Number.isFinite(localDT.getTime())) { setModalError('Data/hora inválida.'); return }
    if (localDT.getTime() <= Date.now()) { setModalError('Não é possível reagendar no passado.'); return }
    const durationMs = Math.max(30 * 60000, ev.end.getTime() - ev.start.getTime())
    try {
      setModalSaving(true)
      setModalError('')
      const updated = await Api.reagendarAgendamentoEstab(ev.id, { inicio: localDT.toISOString() })
      const nextInicio = updated?.inicio || localDT.toISOString()
      const nextStart = new Date(nextInicio)
      let nextEnd = updated?.fim ? new Date(updated.fim) : null
      if (!nextEnd || !Number.isFinite(nextEnd.getTime())) nextEnd = new Date(nextStart.getTime() + durationMs)
      const nextFim = updated?.fim || nextEnd.toISOString()
      setItens((prev) => prev.map((it) => (String(it.id) === String(ev.id) ? { ...it, inicio: nextInicio, fim: nextFim } : it)))
      setSelectedEvent((prev) => (prev ? { ...prev, start: nextStart, end: nextEnd } : prev))
      setRescheduleOpen(false)
    } catch (err) {
      setModalError(err?.data?.message || err?.message || 'Não foi possível reagendar.')
    } finally {
      setModalSaving(false)
    }
  }

  // Cancela (mesma API do painel de baixo) e atualiza o itens local.
  const handleCancelAppt = async (ev) => {
    if (modalSaving) return
    if (typeof window !== 'undefined' && !window.confirm('Cancelar este agendamento? O cliente será notificado.')) return
    try {
      setModalSaving(true)
      setModalError('')
      await Api.cancelarAgendamentoEstab(ev.id)
      setItens((prev) => prev.map((it) => (String(it.id) === String(ev.id) ? { ...it, status: 'cancelado' } : it)))
      setSelectedEvent((prev) => (prev ? { ...prev, norm: 'cancelado' } : prev))
    } catch (err) {
      setModalError(err?.data?.message || err?.message || 'Não foi possível cancelar.')
    } finally {
      setModalSaving(false)
    }
  }

  // Relógio: atualiza a cada minuto (move o marcador "agora" e reavalia agora/próximos).
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!establishmentId) {
      setItens([])
      setLoading(false)
      return undefined
    }
    let mounted = true
    setLoading(true)
    Api.agendamentosEstabelecimento('todos')
      .then((data) => { if (mounted) setItens(Array.isArray(data) ? data : []) })
      .catch(() => { if (mounted) setItens([]) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [establishmentId, refreshSignal])

  // Cores/nome por profissional (id -> {name, palette, avatar}).
  const memberMeta = useMemo(() => {
    const map = new Map()
    ;(professionals || []).forEach((prof, index) => {
      const id = prof?.id ?? prof?.profissional_id ?? prof?.professional_id
      if (id == null) return
      map.set(String(id), {
        name: prof?.nome || prof?.name || 'Profissional',
        avatar: resolveAssetUrl(prof?.avatar_url || prof?.avatar || '') || null,
        palette: MEMBER_PALETTE[index % MEMBER_PALETTE.length],
      })
    })
    return map
  }, [professionals])

  const paletteFor = (resourceId, fallbackIndex) => {
    const meta = memberMeta.get(String(resourceId))
    if (meta) return meta.palette
    return MEMBER_PALETTE[fallbackIndex % MEMBER_PALETTE.length]
  }

  // Todos os agendamentos normalizados + deduplicados (todas as datas).
  const dedupedAll = useMemo(() => normalizeItems(itens), [itens, now])
  // Agendamentos de HOJE (métricas, "agora", próximos, equipe).
  const todayItems = useMemo(
    () => dedupedAll.filter((ev) => isSameLocalDay(ev.start, now)),
    [dedupedAll, now]
  )

  // Indicadores do dia.
  const metrics = useMemo(() => {
    const active = todayItems.filter((ev) => ev.norm !== 'cancelado')
    const faturamento = active.reduce((sum, ev) => sum + ev.valueCent, 0)
    const waConfirmed = active.filter((ev) => Boolean(ev.confirmedAt)).length
    const waTotal = active.length
    const sinais = todayItems.filter((ev) => Boolean(ev.depositPaidAt))
    const sinaisCent = sinais.reduce((sum, ev) => sum + ev.depositCent, 0)
    const confirmados = todayItems.filter((ev) => ev.norm === 'confirmado').length
    const pendentes = todayItems.filter((ev) => ev.norm === 'pendente' || ev.norm === 'aguardando_sinal').length
    const concluidos = todayItems.filter((ev) => ev.norm === 'concluido').length
    const cancelados = todayItems.filter((ev) => ev.norm === 'cancelado').length
    return {
      faturamento, waConfirmed, waTotal, waPending: Math.max(0, waTotal - waConfirmed),
      sinaisCent, sinaisCount: sinais.length, activeCount: active.length,
      total: todayItems.length, confirmados, pendentes, concluidos, cancelados,
    }
  }, [todayItems])

  // Linha do tempo por visão: dia (lanes = profissionais), semana (lanes = dias),
  // mês (grade do calendário). Usa dedupedAll + refDate (âncora navegável).
  const timeline = useMemo(() => {
    if (view === 'mes') {
      return { mode: 'mes', ...buildMonthGrid(dedupedAll, refDate, now) }
    }

    const weekStart = startOfWeekMon(refDate)
    const items = view === 'semana'
      ? dedupedAll.filter((ev) => ev.start >= weekStart && ev.start < addDaysD(weekStart, 7))
      : dedupedAll.filter((ev) => isSameLocalDay(ev.start, refDate))

    // Lanes por dia (semana) ou por profissional (dia).
    let lanes
    if (view === 'semana') {
      lanes = Array.from({ length: 7 }, (_, i) => {
        const d = addDaysD(weekStart, i)
        return { id: `d${i}`, kind: 'day', date: d, name: `${WEEKDAY_SHORT[i]} ${pad2(d.getDate())}`, isToday: isSameLocalDay(d, now), events: [] }
      })
      items.forEach((ev) => { lanes[weekIndex(ev.start)].events.push(ev) })
    } else {
      const laneMap = new Map()
      memberMeta.forEach((meta, id) => { laneMap.set(id, { id, kind: 'pro', name: meta.name, events: [] }) })
      items.forEach((ev) => {
        const key = String(ev.resourceId)
        if (!laneMap.has(key)) laneMap.set(key, { id: key, kind: 'pro', name: ev.resourceName, events: [] })
        laneMap.get(key).events.push(ev)
      })
      lanes = Array.from(laneMap.values())
        .filter((lane) => lane.events.length > 0)
        .sort((a, b) => {
          const ga = String(a.id) === 'sem-id' ? 1 : 0
          const gb = String(b.id) === 'sem-id' ? 1 : 0
          return ga - gb || a.name.localeCompare(b.name)
        })
    }

    // Janela de horas (comum a dia/semana).
    let lo = 9 * 60
    let hi = 19 * 60
    items.forEach((ev) => {
      const s = minutesOfDay(ev.start)
      const e = s + Math.max(1, Math.round((ev.end - ev.start) / 60000))
      lo = Math.min(lo, s)
      hi = Math.max(hi, e)
    })
    lo = Math.floor(lo / 60) * 60
    hi = Math.ceil(hi / 60) * 60
    if (hi - lo < 6 * 60) hi = lo + 6 * 60
    const span = hi - lo
    const hours = []
    for (let h = lo / 60; h <= hi / 60; h += 1) hours.push(h)

    // Empilhamento por lane (agenda real: sobrepostos vão para linhas distintas).
    const MIN_VISUAL_MIN = 30
    lanes.forEach((lane) => {
      lane.events.sort((a, b) => a.start - b.start)
      const rowsEnd = []
      lane.events.forEach((ev) => {
        const s = minutesOfDay(ev.start)
        const durMin = Math.max(1, Math.round((ev.end - ev.start) / 60000))
        const effEnd = Math.max(s + durMin, s + MIN_VISUAL_MIN)
        let row = rowsEnd.findIndex((end) => end <= s)
        if (row === -1) { row = rowsEnd.length; rowsEnd.push(effEnd) }
        else rowsEnd[row] = effEnd
        ev._row = row
      })
      lane.rowCount = Math.max(1, rowsEnd.length)
    })

    // Linha "AGORA": só quando a visão inclui o dia de hoje.
    const includesToday = view === 'semana'
      ? ymdKey(weekStart) === ymdKey(startOfWeekMon(now))
      : isSameLocalDay(refDate, now)
    const nowM = minutesOfDay(now)
    const nowLeft = includesToday && nowM >= lo && nowM <= hi ? clampPct(((nowM - lo) / span) * 100) : null

    return { mode: view, lo, hi, span, hours, lanes, nowLeft }
  }, [dedupedAll, memberMeta, now, view, refDate])

  // Centraliza a linha do tempo no "agora" ao entrar no cockpit e ao trocar de
  // visão. Não re-centraliza a cada tick do relógio (a cada minuto) para não
  // "puxar" de volta o usuário que rolou manualmente: guarda a última visão já
  // centralizada e só recentraliza quando a visão muda.
  useEffect(() => {
    if (view === 'mes') { centeredViewRef.current = null; return }
    if (timeline.nowLeft == null) return
    const scroller = tlScrollRef.current
    if (!scroller) return
    const nowEl = scroller.querySelector('[data-nowline]')
    if (!nowEl) return
    if (centeredViewRef.current === view) return
    centeredViewRef.current = view
    const scRect = scroller.getBoundingClientRect()
    const nowRect = nowEl.getBoundingClientRect()
    const nowCenter = (nowRect.left - scRect.left) + scroller.scrollLeft
    const target = Math.max(0, nowCenter - scroller.clientWidth / 2)
    scroller.scrollTo({ left: target })
  }, [view, timeline])

  const agora = useMemo(() => {
    const t = now.getTime()
    return todayItems
      .filter((ev) => ev.norm !== 'cancelado' && ev.start.getTime() <= t && ev.end.getTime() > t)
      .slice(-1)[0] || null
  }, [todayItems, now])

  const proximos = useMemo(() => {
    const t = now.getTime()
    return todayItems
      .filter((ev) => ev.norm !== 'cancelado' && ev.start.getTime() > t)
      .slice(0, 4)
  }, [todayItems, now])


  const team = useMemo(() => {
    const counts = new Map()
    todayItems
      .filter((ev) => ev.norm !== 'cancelado')
      .forEach((ev) => {
        const key = String(ev.resourceId)
        const entry = counts.get(key) || { id: key, name: ev.resourceName, count: 0 }
        entry.count += 1
        counts.set(key, entry)
      })
    const list = Array.from(counts.values())
    const max = list.reduce((m, e) => Math.max(m, e.count), 0)
    return list
      .map((e, i) => ({ ...e, palette: paletteFor(e.id, i), ratio: max > 0 ? e.count / max : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayItems, memberMeta])

  const dateLabel = capitalize(
    now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  )
  // O h1 carrega o dado do dia — não uma saudação. Dia vazio é caso de primeira classe:
  // esconde os indicadores zerados e a fila vazia, e oferece a única ação que resolve
  // uma agenda livre (divulgar o link público).
  const vazio = metrics.total === 0
  const headline = vazio
    ? 'Nenhum atendimento hoje'
    : `${metrics.total} ${metrics.total === 1 ? 'atendimento' : 'atendimentos'} hoje`
  const publicLink = publicLinkFor({ slug: currentUser?.slug, id: establishmentId })

  // O card do topo nunca anuncia ausência: entre um atendimento e outro — a maior parte
  // do dia — ele mostra o PRÓXIMO, em vez de gastar a área mais nobre com "nenhum em
  // andamento". Só vira "dia encerrado" quando realmente não há mais nada.
  const emCurso = Boolean(agora)
  const destaque = agora || proximos[0] || null
  const fila = emCurso ? proximos : proximos.slice(1)
  const minutosAte = destaque && !emCurso ? Math.max(0, Math.round((destaque.start - now) / 60000)) : 0
  const kicker = emCurso
    ? 'Acontecendo agora'
    : minutosAte < 60
      ? `Próximo · em ${minutosAte} min`
      : `Próximo · às ${pad2(destaque?.start.getHours())}:${pad2(destaque?.start.getMinutes())}`

  const copyPublicLink = async () => {
    if (!publicLink) return
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
      await navigator.clipboard.writeText(publicLink)
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 2000)
    } catch { /* clipboard exige HTTPS/localhost — falha silenciosa */ }
  }

  // Navegação da linha do tempo (◀ ▶ / Hoje) e rótulo do período.
  const shiftAnchor = (dir) => {
    const base = refDate
    if (view === 'dia') setAnchor(startOfDayD(addDaysD(base, dir)))
    else if (view === 'semana') setAnchor(startOfWeekMon(addDaysD(base, dir * 7)))
    else setAnchor(startOfMonthD(new Date(base.getFullYear(), base.getMonth() + dir, 1)))
  }
  const isTodayView =
    view === 'dia' ? isSameLocalDay(refDate, now)
      : view === 'semana' ? ymdKey(startOfWeekMon(refDate)) === ymdKey(startOfWeekMon(now))
        : refDate.getFullYear() === now.getFullYear() && refDate.getMonth() === now.getMonth()
  const fmtShortDay = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace(/\./g, '')
  const periodLabel =
    view === 'dia'
      ? capitalize(refDate.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, ''))
      : view === 'semana'
        ? `${fmtShortDay(startOfWeekMon(refDate))} – ${fmtShortDay(addDaysD(startOfWeekMon(refDate), 6))}`
        : capitalize(refDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }))

  if (loading) {
    // O esqueleto promete o layout real (título + faixa + painel), não uma torre de blocos.
    return (
      <div className={styles.wrap} aria-busy="true">
        <div className={styles.topbar}>
          <div className={styles.topbarInfo}>
            <div className={styles.skeleton} style={{ width: 'min(260px, 70%)', height: 22 }} />
            <div className={styles.skeleton} style={{ width: 'min(180px, 50%)', height: 13, marginTop: 8 }} />
          </div>
        </div>
        <div className={styles.skeleton} style={{ height: 66, marginBottom: 16 }} />
        <div className={styles.skeleton} style={{ height: 220 }} />
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {/* TOPBAR */}
      <header className={styles.topbar}>
        <div className={styles.topbarInfo}>
          <h1 className={styles.hello}>{headline}</h1>
          <p className={styles.subhello}>
            {dateLabel}
            {metrics.waPending > 0 && <> · <b className={styles.warn}>{metrics.waPending} a confirmar</b></>}
            {metrics.cancelados > 0 && <> · {metrics.cancelados} {metrics.cancelados === 1 ? 'cancelado' : 'cancelados'}</>}
          </p>
        </div>
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.btnGhostTop}
            onClick={() => { if (onNewAppointment) onNewAppointment() }}
          >
            <Icon path={ICONS.plus} width={17} strokeWidth={2.2} />
            Novo agendamento
          </button>
        </div>
      </header>

      {/* Mesmo handler do CTA acima. O CSS garante que só UM dos dois existe em cada
          largura (o corte é único, em 781px): este é o único ponto de entrada de
          "novo agendamento" do /estab — não há fallback em nav nenhuma. */}
      <button
        type="button"
        className={styles.fab}
        aria-label="Novo agendamento"
        title="Novo agendamento"
        onClick={() => { if (onNewAppointment) onNewAppointment() }}
      >
        <Icon path={ICONS.plus} width={24} strokeWidth={2.4} />
      </button>

      {/* INDICADORES — uma faixa, três números. O total do dia mora no h1. */}
      {!vazio && (
        <section className={styles.strip} aria-label="Indicadores do dia">
          <div className={styles.stripItem}>
            <span className={styles.stripLabel}>Faturamento</span>
            <span className={styles.stripVal}>{formatBRL(metrics.faturamento, { compact: true })}</span>
          </div>

          <div className={styles.stripItem}>
            <span className={styles.stripLabel}>Confirmados</span>
            {/* waTotal=0 (todos cancelados) não é "todos confirmaram" — é nada a confirmar. */}
            <span className={styles.stripVal}>
              {metrics.waTotal === 0 ? '—' : `${metrics.waConfirmed}/${metrics.waTotal}`}
            </span>
            {metrics.waTotal > 0 && (
              <span className={styles.stripFoot}>
                {metrics.waPending > 0
                  ? `${metrics.waPending} sem resposta`
                  : 'todos confirmaram'}
              </span>
            )}
          </div>

          <div className={styles.stripItem}>
            <span className={styles.stripLabel}>Sinais</span>
            <span className={styles.stripVal}>{formatBRL(metrics.sinaisCent, { compact: true })}</span>
            {metrics.activeCount > 0 && (
              <span className={styles.stripFoot}>
                {metrics.sinaisCount > 0 ? `${metrics.sinaisCount} de ${metrics.activeCount} pagos` : 'nenhum pago'}
              </span>
            )}
          </div>
        </section>
      )}

      {/* DIA VAZIO — em vez de sete blocos zerados, a ação que resolve uma agenda livre. */}
      {vazio && (
        <section className={styles.emptyCard}>
          <b>Sua agenda está livre</b>
          <p>Divulgue seu link público para receber agendamentos.</p>
          {publicLink && <span className={styles.emptyLink}>{publicLink}</span>}
          <div className={styles.emptyActions}>
            <button type="button" className={styles.btnGhostTop} onClick={copyPublicLink} disabled={!publicLink}>
              {linkCopied ? 'Link copiado!' : 'Copiar link'}
            </button>
            {publicLink && (
              <a className={styles.btnGhostTop} href={publicLink} target="_blank" rel="noreferrer">
                Abrir página
              </a>
            )}
          </div>
        </section>
      )}

      {/* BOARD */}
      <section className={`${styles.board} ${vazio ? styles.boardSolo : ''}`}>
        {/* LINHA DO TEMPO */}
        <div className={styles.panel}>
          <div className={styles.panelHd}>
            <div className={styles.panelHdLeft}>
              <h3>Linha do tempo</h3>
              <div className={styles.tlNav}>
                <button type="button" className={styles.tlNavBtn} onClick={() => shiftAnchor(-1)} aria-label="Período anterior">‹</button>
                <span className={styles.tlPeriod}>{periodLabel}</span>
                <button type="button" className={styles.tlNavBtn} onClick={() => shiftAnchor(1)} aria-label="Próximo período">›</button>
                {!isTodayView && (
                  <button type="button" className={styles.tlToday} onClick={() => setAnchor(null)}>Hoje</button>
                )}
              </div>
            </div>
            <div className={styles.seg} role="group" aria-label="Visão da linha do tempo">
              {[['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={`${styles.segBtn} ${view === v ? styles.segActive : ''}`}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {timeline.mode === 'mes' ? (
            <div className={styles.month}>
              <div className={styles.monthHead}>
                {WEEKDAY_SHORT.map((w) => <span key={w}>{w}</span>)}
              </div>
              <div className={styles.monthGrid}>
                {timeline.cells.map((c) => (
                  <button
                    type="button"
                    key={c.key}
                    className={`${styles.monthCell} ${c.inMonth ? '' : styles.monthCellOut} ${c.isToday ? styles.monthCellToday : ''}`}
                    onClick={() => { setAnchor(startOfDayD(c.date)); setView('dia') }}
                    title={`${c.day} — ${c.activeCount} atendimento(s)`}
                  >
                    <span className={styles.monthDay}>{c.day}</span>
                    {c.activeCount > 0 && (
                      <>
                        <span className={styles.monthCount}>{c.activeCount}</span>
                        <span className={styles.monthDots}>
                          {c.confirmados > 0 && <i style={{ background: '#16A34A' }} />}
                          {c.pendentes > 0 && <i style={{ background: '#D97706' }} />}
                          {c.cancelados > 0 && <i style={{ background: '#DC2626' }} />}
                        </span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : timeline.lanes.every((l) => l.events.length === 0) ? (
            <div className={styles.tlEmpty}>
              Nenhum atendimento {view === 'semana' ? 'nesta semana' : 'neste dia'}.
            </div>
          ) : (
            <div className={styles.tlScroll} ref={tlScrollRef}>
              {/* A régua é dimensionada aqui (não dá para encolher por @media): no celular,
                  96px/hora em vez de 140px — com 132px fixos de rótulo, o dono via ~27% da
                  régua por vez. */}
              <div className={styles.tl} style={{ minWidth: Math.max(isMobile ? 520 : 760, timeline.hours.length * (isMobile ? 96 : 140)) }}>
                <div className={styles.tlHours}>
                  <span className={styles.tlHoursLabel}>
                    {view === 'semana' ? 'Dia' : (isMobile ? 'Prof.' : 'Profissional')}
                  </span>
                  <div className={styles.tlHoursTrack}>
                    {timeline.hours.map((h, i) => {
                      const left = timeline.hours.length > 1 ? (i / (timeline.hours.length - 1)) * 100 : 0
                      const tx = i === 0 ? '0' : i === timeline.hours.length - 1 ? '-100%' : '-50%'
                      return (
                        <span key={h} style={{ left: `${left}%`, transform: `translateX(${tx})` }}>{pad2(h % 24)}</span>
                      )
                    })}
                  </div>
                </div>
                <div className={styles.tlBody}>
                  {timeline.lanes.map((lane, laneIndex) => {
                    const isGeneric = String(lane.id) === 'sem-id'
                    const palette = paletteFor(lane.id, laneIndex)
                    return (
                      <div className={`${styles.lane} ${lane.kind === 'day' && lane.isToday ? styles.laneToday : ''}`} key={lane.id}>
                        <div className={styles.laneWho}>
                          {lane.kind === 'day' ? (
                            <span className={`${styles.laneDayChip} ${lane.isToday ? styles.laneDayChipToday : ''}`}>{lane.name}</span>
                          ) : (
                            <>
                              <span className={styles.laneAv} style={{ background: palette.g }}>
                                {isGeneric ? '•' : initials(lane.name)}
                              </span>
                              <span className={styles.laneName}>
                                {isGeneric ? 'Atendimentos' : (isMobile ? firstName(lane.name) : lane.name)}
                              </span>
                            </>
                          )}
                        </div>
                        <div className={styles.track} style={{ height: lane.rowCount * ROW_STEP }}>
                          {lane.events.map((ev) => {
                            const startM = minutesOfDay(ev.start)
                            const durMin = Math.max(1, Math.round((ev.end - ev.start) / 60000))
                            const left = clampPct(((startM - timeline.lo) / timeline.span) * 100)
                            const width = clampPct((durMin / timeline.span) * 100)
                            const past = ev.end.getTime() < now.getTime() && ev.norm !== 'cancelado'
                            const s = ev.start.getMinutes()
                              ? `${pad2(ev.start.getHours())}:${pad2(ev.start.getMinutes())}`
                              : `${pad2(ev.start.getHours())}h`
                            const e = ev.end.getMinutes()
                              ? `${pad2(ev.end.getHours())}:${pad2(ev.end.getMinutes())}`
                              : `${pad2(ev.end.getHours())}h`
                            // Sempre ancora pela ESQUERDA: o início do card = posição real do
                            // horário na régua (ex.: 11:30 começa no meio do 11 e do 12). A largura
                            // mínima (CSS) cresce para a direita, sem deslocar o início.
                            const pos = { left: `${left}%`, width: `${width}%`, top: ev._row * ROW_STEP }
                            // Card compacto: 1º nome + serviço (dia) ou profissional (semana).
                            // O horário é redundante (a posição na régua já indica) e o
                            // nome completo/horários exatos ficam no tooltip e no modal.
                            const sub = lane.kind === 'day' ? firstName(ev.resourceName) : ev.service
                            return (
                              <button
                                type="button"
                                key={ev.id}
                                className={`${styles.appt} ${apptVariant(ev.norm, Boolean(ev.confirmedAt))} ${past ? styles.isPast : ''}`}
                                style={pos}
                                onClick={() => setSelectedEvent(ev)}
                                title={`${ev.client} · ${ev.service} · ${s}–${e}${lane.kind === 'day' ? ' · ' + ev.resourceName : ''} · ${statusShort(ev.norm, ev.confirmedAt)}`}
                              >
                                <b className={styles.apptClient}>{firstName(ev.client)}</b>
                                <span className={styles.apptSvc}>{sub}</span>
                              </button>
                            )
                          })}
                          {lane.kind === 'day' && lane.isToday && timeline.nowLeft != null && (
                            <div className={styles.nowLineTrack} style={{ left: `${timeline.nowLeft}%` }} data-nowline aria-hidden="true">
                              <span className={styles.nowPill}>agora</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {view === 'dia' && timeline.nowLeft != null && (
                    <div className={styles.nowOverlay} aria-hidden="true">
                      <div className={styles.nowLine} style={{ left: `${timeline.nowLeft}%` }} data-nowline>
                        <span className={styles.nowPill}>agora</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* COLUNA DIREITA — no dia vazio ela não existe: só repetiria "não há nada". */}
        {!vazio && (
        <div>
          {destaque ? (
            <div className={styles.nowCard}>
              <div className={styles.nowKicker}>{emCurso && <span className={styles.liveDot} />}{kicker}</div>
              <div className={styles.nowBody}>
                <span className={styles.nowAv}>{initials(destaque.client)}</span>
                <div className={styles.nowMain}>
                  <div className={styles.nowTitle}>{destaque.client}</div>
                  <div className={styles.nowSub}>{destaque.service} · com {destaque.resourceName}</div>
                </div>
                <div className={styles.nowTime}>
                  <b>{pad2(destaque.start.getHours())}:{pad2(destaque.start.getMinutes())}</b>
                  <small>até {pad2(destaque.end.getHours())}:{pad2(destaque.end.getMinutes())}</small>
                </div>
              </div>
              <div className={styles.nowMeta}>
                {destaque.confirmedAt && (
                  <span className={styles.chip}><Icon path={ICONS.wa} width={13} strokeWidth={2} />Confirmado no WhatsApp</span>
                )}
                {destaque.depositPaidAt && destaque.depositCent > 0 && (
                  <span className={styles.chip}>Sinal {formatBRL(destaque.depositCent)} pago</span>
                )}
                {/* A ausência do chip verde não é sinal suficiente: se há pendência, ela é dita. */}
                {pendenciaDe(destaque) && (
                  <span className={`${styles.chip} ${styles.chipWarn}`}>{pendenciaDe(destaque)}</span>
                )}
              </div>
              <div className={styles.nowBtns}>
                <button type="button" className={`${styles.btnLine} ${styles.btnSolid}`} onClick={() => setSelectedEvent(destaque)}>
                  <Icon path={ICONS.check} width={15} strokeWidth={2.2} />Detalhes
                </button>
                {destaque.clientPhone && (
                  <a
                    className={`${styles.btnLine} ${styles.btnGhost}`}
                    href={`https://wa.me/${String(destaque.clientPhone).replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon path={ICONS.wa} width={15} strokeWidth={2} />Mensagem
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className={styles.nowEmpty}>
              <b>Dia encerrado</b>
              {metrics.concluidos > 0
                ? `${metrics.concluidos} ${metrics.concluidos === 1 ? 'atendimento concluído' : 'atendimentos concluídos'} hoje.`
                : 'Nada mais na agenda de hoje.'}
            </div>
          )}

          {/* A FILA É A LISTA DE PENDÊNCIAS. Um bloco "Pendências" separado repetiria,
              a 100px de distância, os mesmos nomes que já estão aqui. Então a pendência
              vira o motivo em âmbar + o [Cobrar] no lugar do selo, na própria linha. */}
          <div className={styles.upnext}>
            <h3>Próximos na fila</h3>
            {fila.length === 0 ? (
              <div className={styles.qEmpty}>Sem próximos atendimentos hoje.</div>
            ) : (
              fila.map((ev, i) => {
                const palette = paletteFor(ev.resourceId, i)
                const motivo = pendenciaDe(ev)
                const waDigits = String(ev.clientPhone || '').replace(/\D/g, '')
                return (
                  <div className={styles.qrow} key={ev.id}>
                    {/* Clicável: abre o MESMO modal (detalhe/remarcar/cancelar) do card da
                        linha do tempo. Antes, cancelar um agendamento no celular exigia
                        rolar a régua na horizontal e acertar um bloco. */}
                    <button type="button" className={styles.qmainBtn} onClick={() => setSelectedEvent(ev)}>
                      <span className={styles.qtime}>{pad2(ev.start.getHours())}:{pad2(ev.start.getMinutes())}</span>
                      <span className={styles.qav} style={{ background: palette.g }}>{initials(ev.client)}</span>
                      <span className={styles.qmain}>
                        <b>{ev.client}</b>
                        {/* Motivo primeiro: se a linha for cortada, some o menos importante. */}
                        <span>
                          {motivo && <em className={styles.qWhy}>{motivo} · </em>}
                          {ev.service} · {ev.resourceName}
                        </span>
                      </span>
                    </button>
                    {motivo && waDigits ? (
                      <a
                        className={styles.btnCobrar}
                        href={`https://wa.me/${waDigits}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Cobrar ${ev.client} no WhatsApp`}
                      >
                        <Icon path={ICONS.wa} width={13} strokeWidth={2} />Cobrar
                      </a>
                    ) : (
                      <StatusPill status={ev.norm} size="sm" showIcon={false} className={styles.qpill} />
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
        )}
      </section>

      {/* EQUIPE */}
      {team.length > 0 && (
        <section className={styles.team}>
          <div className={styles.teamHd}>
            <h3>Equipe hoje</h3>
            <small>atendimentos por profissional</small>
          </div>
          <div className={styles.teamGrid}>
            {team.map((member) => (
              <div className={styles.member} key={member.id}>
                <span className={styles.memberAv} style={{ background: member.palette.g }}>
                  {initials(member.name)}
                </span>
                <div className={styles.memberInfo}>
                  <b>{member.name}</b>
                  <div className={styles.memberBar}>
                    <i style={{ width: `${Math.round(member.ratio * 100)}%`, background: member.palette.c }} />
                  </div>
                </div>
                <span className={styles.mCount}>
                  {member.count}
                  <small>{member.count === 1 ? 'atend.' : 'atend.'}</small>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Modal de detalhes do agendamento (clique no card da linha do tempo). */}
      {selectedEvent && (() => {
        // Re-deriva do dedupedAll (que recalcula a cada minuto) para o status não
        // ficar congelado se o atendimento terminar com o modal aberto.
        const ev = (selectedEvent.id != null && dedupedAll.find((e) => e.id === selectedEvent.id)) || selectedEvent
        const startTxt = ev.start.getMinutes()
          ? `${pad2(ev.start.getHours())}:${pad2(ev.start.getMinutes())}`
          : `${pad2(ev.start.getHours())}h`
        const endTxt = ev.end.getMinutes()
          ? `${pad2(ev.end.getHours())}:${pad2(ev.end.getMinutes())}`
          : `${pad2(ev.end.getHours())}h`
        const dataTxt = capitalize(ev.start.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }))
        const waDigits = String(ev.clientPhone || '').replace(/\D/g, '')
        const hasStarted = ev.start.getTime() <= Date.now()
        const canModify = ev.norm !== 'cancelado' && ev.norm !== 'concluido' && !hasStarted
        const openReschedule = () => {
          const d = ev.start
          setRescheduleDate(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`)
          setRescheduleTime(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`)
          setModalError('')
          setRescheduleOpen(true)
        }
        return (
          <Modal
            title={ev.client}
            closeButton
            onClose={() => { if (!modalSaving) setSelectedEvent(null) }}
            disableOutsideClick={modalSaving}
            actions={
              waDigits ? (
                <a
                  className={`${styles.modalBtn} ${styles.modalBtnWa}`}
                  href={`https://wa.me/${waDigits}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon path={ICONS.wa} width={15} strokeWidth={2} />Mensagem
                </a>
              ) : null
            }
          >
            <div className={styles.modalDetail}>
              <div className={styles.modalTop}>
                <span className={`${styles.modalBadge} ${apptVariant(ev.norm, Boolean(ev.confirmedAt))}`}>
                  {statusShort(ev.norm, ev.confirmedAt)}
                </span>
                {ev.confirmedAt && (
                  <span className={styles.modalWa}>
                    <Icon path={ICONS.wa} width={13} strokeWidth={2} />Confirmado no WhatsApp
                  </span>
                )}
              </div>
              <dl className={styles.modalRows}>
                <div><dt>Serviço</dt><dd>{ev.service}</dd></div>
                <div><dt>Profissional</dt><dd>{ev.resourceName}</dd></div>
                <div><dt>Data</dt><dd>{dataTxt}</dd></div>
                <div><dt>Horário</dt><dd>{startTxt} – {endTxt}</dd></div>
                <div><dt>Valor</dt><dd>{ev.valueCent > 0 ? formatBRL(ev.valueCent) : 'Não informado'}</dd></div>
                {ev.depositPaidAt && ev.depositCent > 0 && (
                  <div><dt>Sinal · Asaas</dt><dd>{formatBRL(ev.depositCent)} pago</dd></div>
                )}
              </dl>

              {rescheduleOpen ? (
                <div className={styles.modalManage}>
                  <div className={styles.modalFields}>
                    <label className={styles.modalField}>
                      <span>Nova data</span>
                      <input
                        type="date"
                        value={rescheduleDate}
                        onChange={(e) => { setRescheduleDate(e.target.value); setModalError('') }}
                      />
                    </label>
                    <label className={styles.modalField}>
                      <span>Novo horário</span>
                      <input
                        type="time"
                        value={rescheduleTime}
                        onChange={(e) => { setRescheduleTime(e.target.value); setModalError('') }}
                      />
                    </label>
                  </div>
                  {modalError && <div role="alert" className={styles.modalErr}>{modalError}</div>}
                  <div className={styles.modalManageBtns}>
                    <button
                      type="button"
                      className={`${styles.modalBtn} ${styles.modalBtnGhost}`}
                      onClick={() => { setRescheduleOpen(false); setModalError('') }}
                      disabled={modalSaving}
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      className={`${styles.modalBtn} ${styles.modalBtnBrand}`}
                      onClick={() => handleReschedule(ev)}
                      disabled={modalSaving}
                    >
                      {modalSaving ? 'Salvando…' : 'Salvar'}
                    </button>
                  </div>
                </div>
              ) : canModify ? (
                <div className={styles.modalManage}>
                  {modalError && <div role="alert" className={styles.modalErr}>{modalError}</div>}
                  <div className={styles.modalManageBtns}>
                    <button
                      type="button"
                      className={`${styles.modalBtn} ${styles.modalBtnDanger}`}
                      onClick={() => handleCancelAppt(ev)}
                      disabled={modalSaving}
                    >
                      {modalSaving ? 'Processando…' : 'Cancelar agendamento'}
                    </button>
                    <button
                      type="button"
                      className={`${styles.modalBtn} ${styles.modalBtnBrand}`}
                      onClick={openReschedule}
                      disabled={modalSaving}
                    >
                      Alterar data/hora
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}
