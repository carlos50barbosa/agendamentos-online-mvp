import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Api } from '../utils/api.js'
import { getUser } from '../utils/auth.js'

function formatCurrencyFromCents(value) {
  return (Number(value || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function parseCurrencyToCents(value) {
  const raw = String(value || '').trim().replace(/\./g, '').replace(',', '.')
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < 0) return null
  return Math.round(amount * 100)
}

function planToForm(plan = null) {
  return {
    id: plan?.id || null,
    nome: plan?.nome || '',
    descricao: plan?.descricao || '',
    preco: plan ? String((Number(plan.preco_centavos || 0) / 100).toFixed(2)).replace('.', ',') : '',
    desconto_percentual_extras:
      plan?.desconto_percentual_extras == null ? '' : String(plan.desconto_percentual_extras),
    max_assinantes: plan?.max_assinantes == null ? '' : String(plan.max_assinantes),
    status: plan?.status || 'inactive',
    items: Array.isArray(plan?.items) && plan.items.length
      ? plan.items.map((item, index) => ({
          servico_id: String(item.servico_id || ''),
          quantidade_por_ciclo: String(item.quantidade_por_ciclo || '1'),
          ordem: String(item.ordem || index + 1),
        }))
      : [{ servico_id: '', quantidade_por_ciclo: '1', ordem: '1' }],
  }
}

export default function LoyaltyPlansEstabelecimento() {
  const user = getUser()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mpBusy, setMpBusy] = useState(false)
  const [notice, setNotice] = useState({ type: '', message: '' })
  const [plans, setPlans] = useState([])
  const [services, setServices] = useState([])
  const [subscribers, setSubscribers] = useState([])
  const [mpAccount, setMpAccount] = useState(null)
  const [form, setForm] = useState(() => planToForm())

  const serviceOptions = useMemo(
    () => (Array.isArray(services) ? services.map((service) => ({
      id: String(service.id),
      nome: service.nome || 'Serviço',
      preco_centavos: Number(service.preco_centavos || 0),
    })) : []),
    [services]
  )

  const loadData = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    try {
      const [plansResponse, servicesResponse, subscribersResponse, mpAccountResponse] = await Promise.all([
        Api.loyaltyPlansList({ include_archived: true }),
        Api.listServices(user.id),
        Api.loyaltySubscribers(),
        Api.marketplaceMpAccount(),
      ])
      setPlans(Array.isArray(plansResponse?.plans) ? plansResponse.plans : [])
      setServices(Array.isArray(servicesResponse) ? servicesResponse : [])
      setSubscribers(Array.isArray(subscribersResponse?.subscribers) ? subscribersResponse.subscribers : [])
      setMpAccount(mpAccountResponse?.account || null)
    } catch (error) {
      setNotice({
        type: 'error',
        message: error?.data?.message || error?.message || 'Não foi possível carregar os planos de fidelidade.',
      })
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  const mpConnected = mpAccount?.connected === true || mpAccount?.status === 'connected'

  const handleMpConnect = useCallback(async () => {
    setMpBusy(true)
    setNotice({ type: '', message: '' })
    try {
      const response = await Api.marketplaceMpConnectStart({
        capability: 'loyalty',
        return_to: '/fidelidade',
      })
      if (response?.url) {
        window.location.assign(response.url)
        return
      }
      throw new Error('Não foi possível iniciar a conexão com o Mercado Pago.')
    } catch (error) {
      setNotice({
        type: 'error',
        message: error?.data?.message || error?.message || 'Não foi possível iniciar a conexão com o Mercado Pago.',
      })
    } finally {
      setMpBusy(false)
    }
  }, [])

  const handleMpDisconnect = useCallback(async () => {
    setMpBusy(true)
    setNotice({ type: '', message: '' })
    try {
      await Api.marketplaceMpDisconnect()
      setNotice({ type: 'success', message: 'Conta Mercado Pago desconectada.' })
      await loadData()
    } catch (error) {
      setNotice({
        type: 'error',
        message: error?.data?.message || error?.message || 'Não foi possível desconectar a conta Mercado Pago.',
      })
    } finally {
      setMpBusy(false)
    }
  }, [loadData])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleFieldChange = useCallback((field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
  }, [])

  const handleItemChange = useCallback((index, field, value) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: value } : item
      )),
    }))
  }, [])

  const handleAddItem = useCallback(() => {
    setForm((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          servico_id: '',
          quantidade_por_ciclo: '1',
          ordem: String(current.items.length + 1),
        },
      ],
    }))
  }, [])

  const handleRemoveItem = useCallback((index) => {
    setForm((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({
        ...item,
        ordem: String(itemIndex + 1),
      })),
    }))
  }, [])

  const resetForm = useCallback(() => {
    setForm(planToForm())
  }, [])

  const handleEdit = useCallback((plan) => {
    setForm(planToForm(plan))
    setNotice({ type: '', message: '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const buildPayload = useCallback(() => {
    const precoCentavos = parseCurrencyToCents(form.preco)
    if (!form.nome.trim() || precoCentavos == null) {
      throw new Error('Informe nome e valor mensal do plano.')
    }
    const items = form.items
      .map((item, index) => ({
        servico_id: Number(item.servico_id || 0),
        quantidade_por_ciclo: Number(item.quantidade_por_ciclo || 0),
        ordem: Number(item.ordem || index + 1),
      }))
      .filter((item) => item.servico_id > 0 && item.quantidade_por_ciclo > 0)
    if (!items.length) {
      throw new Error('Adicione ao menos um serviço ao plano.')
    }
    return {
      nome: form.nome.trim(),
      descricao: form.descricao.trim(),
      preco_centavos: precoCentavos,
      status: form.status || 'inactive',
      desconto_percentual_extras: form.desconto_percentual_extras === '' ? null : Number(form.desconto_percentual_extras),
      max_assinantes: form.max_assinantes === '' ? null : Number(form.max_assinantes),
      items,
    }
  }, [form])

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault()
    setSaving(true)
    setNotice({ type: '', message: '' })
    try {
      const payload = buildPayload()
      if (form.id) {
        await Api.loyaltyPlanUpdate(form.id, payload)
        setNotice({ type: 'success', message: 'Plano atualizado.' })
      } else {
        await Api.loyaltyPlanCreate(payload)
        setNotice({ type: 'success', message: 'Plano criado.' })
      }
      resetForm()
      await loadData()
    } catch (error) {
      setNotice({
        type: 'error',
        message: error?.data?.message || error?.message || 'Não foi possível salvar o plano.',
      })
    } finally {
      setSaving(false)
    }
  }, [buildPayload, form.id, loadData, resetForm])

  const handleStatus = useCallback(async (planId, status) => {
    try {
      await Api.loyaltyPlanUpdateStatus(planId, status)
      await loadData()
    } catch (error) {
      setNotice({
        type: 'error',
        message: error?.data?.message || error?.message || 'Não foi possível atualizar o status do plano.',
      })
    }
  }, [loadData])

  const handleArchive = useCallback(async (planId) => {
    try {
      await Api.loyaltyPlanDelete(planId)
      await loadData()
    } catch (error) {
      setNotice({
        type: 'error',
        message: error?.data?.message || error?.message || 'Não foi possível arquivar o plano.',
      })
    }
  }, [loadData])

  return (
    <div className="page loyalty-page">
      <div className="loyalty-page__hero">
        <div>
          <p className="loyalty-page__eyebrow">Modulo Fidelidade</p>
          <h1 className="loyalty-page__title">Planos mensais do estabelecimento</h1>
          <p className="loyalty-page__subtitle">
            Crie planos, vincule serviços inclusos e acompanhe uso, assinantes e receita recorrente estimada.
          </p>
        </div>
      </div>

      {notice.message ? (
        <div className={`loyalty-alert loyalty-alert--${notice.type || 'info'}`}>{notice.message}</div>
      ) : null}

      <section className="card loyalty-card" style={{ marginBottom: 24 }}>
        <div className="loyalty-card__header">
          <div>
            <h2>Conta Mercado Pago do estabelecimento</h2>
            <p>
              A fidelidade mensal usa a conta conectada do estabelecimento. O dinheiro não passa pela conta da plataforma.
            </p>
          </div>
          <span className={`loyalty-status loyalty-status--${mpConnected ? 'active' : 'inactive'}`}>
            {mpConnected ? 'Conectada' : 'Desconectada'}
          </span>
        </div>
        <div className="loyalty-current__meta">
          <span>{mpAccount?.mp_user_id ? `mp_user_id: ${mpAccount.mp_user_id}` : 'Nenhuma conta seller conectada.'}</span>
          <span>{mpAccount?.token_expires_at ? `Expira em: ${new Date(mpAccount.token_expires_at).toLocaleString('pt-BR')}` : 'Token sem expiracao informada.'}</span>
        </div>
        {!mpConnected ? (
          <div className="loyalty-alert loyalty-alert--warn" style={{ marginTop: 16 }}>
            Este estabelecimento ainda não conectou uma conta Mercado Pago. Sem essa conexão, a fidelidade mensal não pode ser vendida.
          </div>
        ) : null}
        <div className="loyalty-form__actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn--primary" onClick={handleMpConnect} disabled={mpBusy}>
            {mpBusy ? 'Conectando...' : (mpConnected ? 'Reconectar Mercado Pago' : 'Conectar Mercado Pago')}
          </button>
          {mpConnected ? (
            <button type="button" className="btn btn--outline" onClick={handleMpDisconnect} disabled={mpBusy}>
              Desconectar
            </button>
          ) : null}
        </div>
      </section>

      <div className="loyalty-grid loyalty-grid--two">
        <section className="card loyalty-card">
          <div className="loyalty-card__header">
            <div>
              <h2>{form.id ? 'Editar plano' : 'Novo plano'}</h2>
              <p>Configure nome, valor, serviços incluídos e desconto extra.</p>
            </div>
            {form.id ? (
              <button type="button" className="btn btn--outline" onClick={resetForm}>Novo plano</button>
            ) : null}
          </div>

          <form className="loyalty-form" onSubmit={handleSubmit}>
            <div className="loyalty-form__grid">
              <label>
                <span>Nome</span>
                <input className="input" value={form.nome} onChange={(event) => handleFieldChange('nome', event.target.value)} />
              </label>
              <label>
                <span>Valor mensal</span>
                <input className="input" placeholder="79,90" value={form.preco} onChange={(event) => handleFieldChange('preco', event.target.value)} />
              </label>
              <label>
                <span>Desconto em extras (%)</span>
                <input className="input" value={form.desconto_percentual_extras} onChange={(event) => handleFieldChange('desconto_percentual_extras', event.target.value)} />
              </label>
              <label>
                <span>Máximo de assinantes</span>
                <input className="input" value={form.max_assinantes} onChange={(event) => handleFieldChange('max_assinantes', event.target.value)} />
              </label>
            </div>

            <label>
              <span>Descrição</span>
              <textarea className="input loyalty-form__textarea" value={form.descricao} onChange={(event) => handleFieldChange('descricao', event.target.value)} />
            </label>

            <div className="loyalty-form__items">
              <div className="loyalty-form__items-header">
                <strong>Benefícios por ciclo</strong>
                <button type="button" className="btn btn--outline btn--sm" onClick={handleAddItem}>Adicionar serviço</button>
              </div>
              {form.items.map((item, index) => (
                <div className="loyalty-form__item-row" key={`plan-item-${index}`}>
                  <label>
                    <span>Serviço</span>
                    <select className="input" value={item.servico_id} onChange={(event) => handleItemChange(index, 'servico_id', event.target.value)}>
                      <option value="">Selecione</option>
                      {serviceOptions.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.nome} · {formatCurrencyFromCents(service.preco_centavos)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Qtd/ciclo</span>
                    <input className="input" value={item.quantidade_por_ciclo} onChange={(event) => handleItemChange(index, 'quantidade_por_ciclo', event.target.value)} />
                  </label>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleRemoveItem(index)} disabled={form.items.length <= 1}>
                    Remover
                  </button>
                </div>
              ))}
            </div>

            <div className="loyalty-form__actions">
              <button type="submit" className="btn btn--primary" disabled={saving}>
                {saving ? 'Salvando...' : form.id ? 'Salvar alterações' : 'Criar plano'}
              </button>
            </div>
          </form>
        </section>

        <section className="card loyalty-card">
          <div className="loyalty-card__header">
            <div>
              <h2>Assinantes</h2>
              <p>Resumo rapido de ativos, cancelados e inadimplentes.</p>
            </div>
          </div>
          <div className="loyalty-subscriber-list">
            {subscribers.length ? subscribers.slice(0, 8).map((subscriber) => (
              <div className="loyalty-subscriber" key={subscriber.id}>
                <div>
                  <strong>{subscriber.cliente_nome}</strong>
                  <p>{subscriber.plan_name}</p>
                </div>
                <span className={`loyalty-status loyalty-status--${String(subscriber.status || '').toLowerCase()}`}>{subscriber.status}</span>
              </div>
            )) : (
              <p className="loyalty-empty">{loading ? 'Carregando assinantes...' : 'Nenhum assinante ainda.'}</p>
            )}
          </div>
        </section>
      </div>

      <section className="loyalty-plan-list">
        <div className="loyalty-plan-list__header">
          <h2>Planos cadastrados</h2>
          <p>{loading ? 'Carregando planos...' : `${plans.length} planos encontrados`}</p>
        </div>

        <div className="loyalty-grid">
          {plans.map((plan) => (
            <article className="card loyalty-card loyalty-plan-card" key={plan.id}>
              <div className="loyalty-plan-card__top">
                <div>
                  <span className={`loyalty-status loyalty-status--${plan.status}`}>{plan.status}</span>
                  <h3>{plan.nome}</h3>
                  <p>{plan.descricao || 'Sem descricao.'}</p>
                </div>
                <strong>{formatCurrencyFromCents(plan.preco_centavos)}</strong>
              </div>

              <div className="loyalty-plan-card__metrics">
                <span>Ativos: {plan.metrics?.active_subscribers || 0}</span>
                <span>Receita estimada: {formatCurrencyFromCents(plan.metrics?.estimated_monthly_revenue_cents || 0)}</span>
                <span>Benefícios consumidos: {plan.metrics?.consumed_benefits || 0}</span>
              </div>

              <div className="loyalty-plan-card__items">
                {(plan.items || []).map((item) => (
                  <div key={item.id} className="loyalty-plan-card__item">
                    <span>{item.servico?.nome || `Serviço #${item.servico_id}`}</span>
                    <strong>{item.quantidade_por_ciclo} por ciclo</strong>
                  </div>
                ))}
              </div>

              <div className="loyalty-plan-card__actions">
                <button type="button" className="btn btn--outline btn--sm" onClick={() => handleEdit(plan)}>Editar</button>
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={() => handleStatus(plan.id, plan.status === 'active' ? 'inactive' : 'active')}
                >
                  {plan.status === 'active' ? 'Inativar' : 'Ativar'}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleArchive(plan.id)}>Arquivar</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
