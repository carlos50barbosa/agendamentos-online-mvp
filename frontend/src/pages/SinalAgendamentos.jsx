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
    setDepositWalletId,
    saveDepositSettings,
  } = useBusinessSettings({ loadMercadoPago: true, loadDeposit: true });

  if (!isEstablishment) {
    return <p className="muted">Disponível apenas para contas de estabelecimento.</p>;
  }

  const isAsaas = deposit.provider === 'asaas';
  const account = mercadoPago.account || null;
  const tokenSuffix = account?.token_last4 ? `Final ${account.token_last4}` : 'Conta ainda não autorizada';
  const statusLabel = mercadoPagoConnected ? 'Conectado' : 'Desconectado';
  // Pronto para receber = Wallet ID informado (Asaas) ou conta MP conectada (legado).
  const receiverReady = isAsaas ? Boolean(deposit.walletId) : mercadoPagoConnected;

  return (
    <div className="grid config-page settings-module-page" style={{ gap: 16 }}>
      <section className="card config-page__hero settings-module-hero">
        <div className="settings-module-hero__copy">
          <span className="settings-module-hero__eyebrow">Módulo financeiro</span>
          <h2>Sinal nos agendamentos</h2>
          <p className="muted">
            {isAsaas
              ? 'Informe o Wallet ID da sua conta Asaas e defina um percentual de sinal via PIX. O valor cai direto na sua conta, via split.'
              : 'Conecte sua conta Mercado Pago e defina um percentual de sinal via PIX para confirmar novos agendamentos.'}
          </p>
        </div>
        <div className="settings-module-hero__meta">
          <div className="settings-module-hero__pill">{isAsaas ? 'Asaas + PIX' : 'Mercado Pago + PIX'}</div>
          <Link className="btn btn--outline btn--sm" to="/configuracoes">
            Voltar para Configurações
          </Link>
        </div>
      </section>

      <div className="settings-module-grid settings-module-grid--split">
        {isAsaas ? (
          <section className="settings-module-card settings-module-card--status">
            <div>
              <h3>Conta Asaas</h3>
              <p className="muted">
                Informe o Wallet ID da sua conta Asaas. O sinal é repassado direto para ela via split, sem passar pela plataforma.
              </p>
            </div>

            {!deposit.allowed ? (
              <div className="notice notice--info">
                Disponível apenas para planos Pro e Premium. <Link to="/planos">Conhecer planos</Link>
              </div>
            ) : null}

            <label className="label settings-module-field">
              <span>Wallet ID</span>
              <input
                className="input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="00000000-0000-0000-0000-000000000000"
                value={deposit.walletId}
                onChange={(event) => setDepositWalletId(event.target.value)}
                disabled={!deposit.allowed || deposit.saving}
              />
            </label>
            <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
              Abra sua conta Asaas → menu do usuário → Integrações → copie o Wallet ID. Salve para aplicar.
            </p>

            {deposit.loading ? (
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="spinner" aria-hidden="true" />
                <span className="muted">Carregando configurações...</span>
              </div>
            ) : deposit.walletId ? (
              deposit.walletVerified ? (
                <div className="notice notice--success">Wallet ID validado — cobranças com split ativas.</div>
              ) : (
                <div className="notice notice--info">Wallet ID salvo. Será validado na primeira cobrança de sinal.</div>
              )
            ) : (
              <div className="notice notice--warn">Sem o Wallet ID, o sinal não pode ser cobrado.</div>
            )}
          </section>
        ) : (
          <section className="settings-module-card settings-module-card--status">
            <div>
              <h3>Mercado Pago</h3>
              <p className="muted">
                Conecte sua conta para receber os pagamentos do sinal direto no estabelecimento.
              </p>
            </div>

            {!deposit.allowed ? (
              <div className="notice notice--info">
                Conexão disponível apenas para planos Pro e Premium. <Link to="/planos">Conhecer planos</Link>
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
                <span className="muted">Ativação válida apenas para planos elegíveis.</span>
              </div>
              <div className="settings-module-kpi">
                <span className="settings-module-kpi__label">Checkout</span>
                <strong>PIX imediato</strong>
                <span className="muted">O cliente paga no fluxo do agendamento e a confirmação é automática.</span>
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
              <div className="notice notice--warn">Mercado Pago não conectado. Sem essa conexão o sinal não pode ser cobrado.</div>
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
                {mercadoPago.connectLoading ? <span className="spinner" /> : deposit.allowed ? 'Conectar Mercado Pago' : 'Disponível em Pro/Premium'}
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
        )}

        <aside className="settings-module-card settings-module-card--aside">
          <h3>Como funciona</h3>
          <ul className="settings-module-list">
            <li>O cliente gera o PIX durante o agendamento.</li>
            <li>Assim que o pagamento é confirmado, o atendimento fica garantido.</li>
            {isAsaas ? (
              <li>O valor cai direto na sua conta Asaas (via split). Sem Wallet ID, o sinal fica indisponível.</li>
            ) : (
              <li>Sem conta Mercado Pago conectada, o sinal fica indisponível.</li>
            )}
          </ul>
          <div className="settings-module-aside__footer">
            <Link className="btn btn--ghost btn--sm" to="/planos">
              Ver planos elegíveis
            </Link>
          </div>
        </aside>
      </div>

      <section className="settings-module-card settings-module-card--form">
        <div className="settings-module-form__header">
          <div>
            <h3>Configuração do sinal</h3>
            <p className="muted" style={{ marginBottom: 0 }}>
              Exija um percentual via PIX para confirmar novos agendamentos. O pagamento expira em {deposit.holdMinutes} min.
            </p>
          </div>
          <div className="settings-module-hero__pill settings-module-hero__pill--soft">
            {deposit.allowed ? 'Elegível no plano atual' : 'Recurso bloqueado no plano'}
          </div>
        </div>

        {deposit.loading ? (
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="spinner" aria-hidden="true" />
            <span className="muted">Carregando configurações do sinal...</span>
          </div>
        ) : deposit.allowed ? (
          <div className="settings-module-form__grid">
            {deposit.enabled && !receiverReady ? (
              <div className="notice notice--warn settings-module-inline-notice">
                <span>
                  {isAsaas
                    ? 'Para exigir sinal, informe o Wallet ID da sua conta Asaas acima.'
                    : 'Para exigir sinal, conecte sua conta Mercado Pago.'}
                </span>
                {!isAsaas ? (
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
                ) : null}
              </div>
            ) : null}

            <label className="switch switch--status settings-module-switch">
              <input
                type="checkbox"
                checked={deposit.enabled}
                onChange={(event) => setDepositEnabled(event.target.checked)}
                disabled={deposit.saving}
              />
              <span>{deposit.enabled ? 'Ativado' : 'Desativado'}</span>
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
              <span className="muted">Mínimo de 5% e máximo de 90%.</span>
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
            <div className="notice notice--info">Recurso disponível apenas para planos Pro e Premium.</div>
            <Link className="btn btn--outline btn--sm" to="/planos">
              Conhecer planos
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
