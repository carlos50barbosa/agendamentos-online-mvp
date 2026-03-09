import React from 'react';
import { Link } from 'react-router-dom';
import useBusinessSettings from '../hooks/useBusinessSettings.js';

export default function SinalAgendamentos() {
  const {
    isEstablishment,
    mercadoPago,
    mercadoPagoConnected,
    deposit,
    startMercadoPagoConnect,
    disconnectMercadoPago,
    setDepositEnabled,
    setDepositPercent,
    saveDepositSettings,
  } = useBusinessSettings({ loadMercadoPago: true, loadDeposit: true });

  if (!isEstablishment) {
    return <p className="muted">Disponivel apenas para contas de estabelecimento.</p>;
  }

  const account = mercadoPago.account || null;
  const tokenSuffix = account?.token_last4 ? `Final ${account.token_last4}` : 'Conta ainda nao autorizada';
  const statusLabel = mercadoPagoConnected ? 'Conectado' : 'Desconectado';

  return (
    <div className="grid config-page settings-module-page" style={{ gap: 16 }}>
      <section className="card config-page__hero settings-module-hero">
        <div className="settings-module-hero__copy">
          <span className="settings-module-hero__eyebrow">Modulo financeiro</span>
          <h2>Sinal nos agendamentos</h2>
          <p className="muted">
            Conecte sua conta Mercado Pago e defina um percentual de sinal via PIX para confirmar novos agendamentos.
          </p>
        </div>
        <div className="settings-module-hero__meta">
          <div className="settings-module-hero__pill">Mercado Pago + PIX</div>
          <Link className="btn btn--outline btn--sm" to="/configuracoes">
            Voltar para Configuracoes
          </Link>
        </div>
      </section>

      <div className="settings-module-grid settings-module-grid--split">
        <section className="settings-module-card settings-module-card--status">
          <div>
            <h3>Mercado Pago</h3>
            <p className="muted">
              Conecte sua conta para receber os pagamentos do sinal direto no estabelecimento.
            </p>
          </div>

          {!deposit.allowed ? (
            <div className="notice notice--info">
              Conexao disponivel apenas para planos Pro e Premium. <Link to="/planos">Conhecer planos</Link>
            </div>
          ) : null}

          <div className="settings-module-status-grid">
            <div className="settings-module-kpi">
              <span className="settings-module-kpi__label">Status</span>
              <strong>{statusLabel}</strong>
              <span className="muted">{mercadoPagoConnected ? tokenSuffix : 'Conecte a conta para receber sinais via PIX.'}</span>
            </div>
            <div className="settings-module-kpi">
              <span className="settings-module-kpi__label">Recebimento</span>
              <strong>{deposit.allowed ? 'Liberado' : 'Bloqueado no plano'}</strong>
              <span className="muted">Ativacao valida apenas para planos elegiveis.</span>
            </div>
            <div className="settings-module-kpi">
              <span className="settings-module-kpi__label">Checkout</span>
              <strong>PIX imediato</strong>
              <span className="muted">O cliente paga no fluxo do agendamento e a confirmacao e automatica.</span>
            </div>
          </div>

          {mercadoPago.loading ? (
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="spinner" aria-hidden="true" />
              <span className="muted">Carregando status do Mercado Pago...</span>
            </div>
          ) : null}

          {!mercadoPago.loading && mercadoPagoConnected ? (
            <div className="notice notice--success">Conta Mercado Pago conectada com sucesso.</div>
          ) : null}
          {!mercadoPago.loading && !mercadoPagoConnected ? (
            <div className="notice notice--warn">Mercado Pago nao conectado. Sem essa conexao o sinal nao pode ser cobrado.</div>
          ) : null}
          {account?.mp_user_id ? (
            <span className="muted" style={{ fontSize: 12 }}>mp_user_id: {account.mp_user_id}</span>
          ) : null}
          {mercadoPago.error ? <div className="notice notice--error">{mercadoPago.error}</div> : null}
          {mercadoPago.notice ? <div className="notice notice--success">{mercadoPago.notice}</div> : null}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void startMercadoPagoConnect()}
              disabled={mercadoPago.connectLoading || !deposit.allowed}
            >
              {mercadoPago.connectLoading ? <span className="spinner" /> : deposit.allowed ? 'Conectar Mercado Pago' : 'Disponivel em Pro/Premium'}
            </button>
            {mercadoPagoConnected ? (
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => void disconnectMercadoPago()}
                disabled={mercadoPago.disconnectLoading}
              >
                {mercadoPago.disconnectLoading ? <span className="spinner" /> : 'Desconectar'}
              </button>
            ) : null}
          </div>
        </section>

        <aside className="settings-module-card settings-module-card--aside">
          <h3>Como funciona</h3>
          <ul className="settings-module-list">
            <li>O cliente gera o PIX durante o agendamento.</li>
            <li>Assim que o pagamento confirma, o atendimento fica garantido.</li>
            <li>Sem conta Mercado Pago conectada, o sinal fica indisponivel.</li>
          </ul>
          <div className="settings-module-aside__footer">
            <Link className="btn btn--ghost btn--sm" to="/planos">
              Ver planos elegiveis
            </Link>
          </div>
        </aside>
      </div>

      <section className="settings-module-card settings-module-card--form">
        <div className="settings-module-form__header">
          <div>
            <h3>Configuracao do sinal</h3>
            <p className="muted" style={{ marginBottom: 0 }}>
              Exija um percentual via PIX para confirmar novos agendamentos. O pagamento expira em {deposit.holdMinutes} min.
            </p>
          </div>
          <div className="settings-module-hero__pill settings-module-hero__pill--soft">
            {deposit.allowed ? 'Elegivel no plano atual' : 'Recurso bloqueado no plano'}
          </div>
        </div>

        {deposit.loading ? (
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="spinner" aria-hidden="true" />
            <span className="muted">Carregando configuracoes do sinal...</span>
          </div>
        ) : deposit.allowed ? (
          <div className="settings-module-form__grid">
            {deposit.enabled && !mercadoPagoConnected ? (
              <div className="notice notice--warn settings-module-inline-notice">
                <span>Para exigir sinal, conecte sua conta Mercado Pago.</span>
                <div>
                  <button
                    type="button"
                    className="btn btn--outline btn--sm"
                    onClick={() => void startMercadoPagoConnect()}
                    disabled={mercadoPago.connectLoading}
                  >
                    {mercadoPago.connectLoading ? <span className="spinner" /> : 'Conectar Mercado Pago'}
                  </button>
                </div>
              </div>
            ) : null}

            <label className="switch settings-module-switch">
              <input
                type="checkbox"
                checked={deposit.enabled}
                onChange={(event) => setDepositEnabled(event.target.checked)}
                disabled={deposit.saving}
              />
              <span>Ativar sinal nos agendamentos</span>
            </label>

            <div className="settings-module-form__row">
              <label className="label settings-module-field settings-module-field--sm">
                <span>Percentual (%)</span>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  placeholder="Ex: 30"
                  value={deposit.percent}
                  onChange={(event) => setDepositPercent(event.target.value)}
                  disabled={!deposit.enabled || deposit.saving}
                />
              </label>
              <span className="muted">Minimo 5% e maximo 90%.</span>
            </div>

            {deposit.noticeMessage ? (
              <div className={deposit.noticeType ? `notice notice--${deposit.noticeType}` : 'notice'}>
                {deposit.noticeMessage}
              </div>
            ) : null}

            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => void saveDepositSettings()}
                disabled={deposit.saving}
              >
                {deposit.saving ? <span className="spinner" /> : 'Salvar sinal'}
              </button>
            </div>
          </div>
        ) : (
          <div className="settings-module-empty-state">
            <div className="notice notice--info">Recurso disponivel apenas para planos Pro e Premium.</div>
            <Link className="btn btn--outline btn--sm" to="/planos">
              Conhecer planos
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
