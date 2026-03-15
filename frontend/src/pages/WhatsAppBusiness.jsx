import React from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import { IconChevronRight, IconPhone } from '../components/Icons.jsx';
import walletStyles from '../components/WhatsAppWalletPanel.module.css';
import useBusinessSettings from '../hooks/useBusinessSettings.js';

const m = walletStyles;

function statusChipClass(tone) {
  if (tone === 'success') return `${m.statusChip} ${m.statusSuccess}`;
  if (tone === 'pending') return `${m.statusChip} ${m.statusPending}`;
  if (tone === 'error') return `${m.statusChip} ${m.statusError}`;
  if (tone === 'neutral') return `${m.statusChip} ${m.statusNeutral}`;
  return m.statusChip;
}

function HistoryItem({ item }) {
  return (
    <li className={m.historyItem}>
      <div className={m.historyMain}>
        <span className={m.historyAmount}>+{item.messagesLabel} msgs</span>
        {item.priceLabel ? <span className={m.historyPrice}>{item.priceLabel}</span> : null}
      </div>
      <div className={m.historyMeta}>
        <span className={m.historyDate}>{item.createdLabel || 'Data indisponivel'}</span>
        {item.statusLabel ? <span className={statusChipClass(item.statusTone)}>{item.statusLabel}</span> : null}
      </div>
    </li>
  );
}

function formatConnectionDate(value) {
  if (!value) return 'Nao disponivel';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Nao disponivel';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function WhatsAppBusiness() {
  const {
    isEstablishment,
    whatsappConnectEnabled,
    planInfo,
    billing,
    whatsapp,
    whatsappConnected,
    walletSummary,
    packages,
    recommendedPackageKey,
    recentTopupHistory,
    visibleTopupHistory,
    filteredTopupHistory,
    historyExpanded,
    setHistoryExpanded,
    historyRange,
    setHistoryRange,
    historyStatus,
    setHistoryStatus,
    hasHistoryDates,
    hasHistoryStatuses,
    hasMoreHistory,
    historyLoadingMore,
    loadMoreHistory,
    helpOpen,
    setHelpOpen,
    beginWhatsAppManualConnect,
    updateWhatsAppManualField,
    validateWhatsAppManualConnection,
    saveWhatsAppManualConnection,
    cancelWhatsAppManualEdit,
    disconnectWhatsApp,
    topupLoadingKey,
    topupError,
    openWhatsappTopup,
    pixModal,
    pixNotice,
    pixCopyNotice,
    pixCode,
    pixStatus,
    copyPixCode,
    refreshPixStatus,
    closePixModal,
    formatCurrencyFromCents,
  } = useBusinessSettings({ loadWhatsApp: true });

  if (!isEstablishment) {
    return <p className="muted">Disponivel apenas para contas de estabelecimento.</p>;
  }

  const account = whatsapp.account || null;
  const phoneLabel = account?.display_phone_number || 'Numero indisponivel';
  const verifiedNameLabel = account?.verified_name || 'Nao informado';
  const planLabel = String(planInfo.plan || 'starter').toUpperCase();
  const historyPanelId = 'whatsapp-business-history';
  const pixPack = pixModal.data?.pack || null;
  const pixPackPrice = formatCurrencyFromCents(pixPack?.price_cents);
  const pixAmount =
    typeof pixModal.data?.amount_cents === 'number'
      ? formatCurrencyFromCents(pixModal.data.amount_cents)
      : '';
  const accountStatus = String(account?.status || (whatsappConnected ? 'connected' : 'not_connected')).toLowerCase();
  const statusTone =
    accountStatus === 'connected'
      ? 'success'
      : accountStatus === 'error'
        ? 'error'
        : accountStatus === 'connecting' || accountStatus === 'validating'
          ? 'pending'
          : 'neutral';
  const statusLabelMap = {
    connected: 'Conectado',
    connecting: 'Conectando',
    validating: 'Validando',
    disconnected: 'Desconectado',
    error: 'Erro',
    not_connected: 'Nao conectado',
  };
  const statusLabel = statusLabelMap[accountStatus] || 'Nao conectado';
  const connectedAtLabel = formatConnectionDate(account?.connected_at);
  const lastSyncLabel = formatConnectionDate(account?.last_sync_at);
  const lastValidatedLabel = formatConnectionDate(account?.token_last_validated_at);
  const isEditing = Boolean(whatsapp.editing) || !account;
  const manualPreview = whatsapp.preview || null;
  const canSaveConnection = Boolean(whatsapp.validated && manualPreview && !whatsapp.saveLoading);
  const manualSteps = [
    'Acesse o Meta for Developers / WhatsApp Cloud API.',
    'Gere ou copie um access token com permissao para o numero.',
    'Copie o WABA ID e o Phone Number ID do numero que sera usado.',
    'Cole os dados abaixo, valide a conexao e salve.',
  ];

  return (
    <div className="grid config-page settings-module-page" style={{ gap: 16 }}>
      <section className="card config-page__hero settings-module-hero">
        <div className="settings-module-hero__copy">
          <span className="settings-module-hero__eyebrow">Modulo dedicado</span>
          <h2>WhatsApp Business</h2>
          <p className="muted">
            {whatsappConnectEnabled
              ? 'Gerencie a conexao do WhatsApp Business do estabelecimento, acompanhe a franquia do plano e recarregue creditos extras via PIX.'
              : 'Em breve voce podera conectar o seu proprio numero do WhatsApp Business diretamente ao Agendamentos Online por meio da integracao oficial da Meta.'}
          </p>
        </div>
        <div className="settings-module-hero__meta">
          <div className="settings-module-hero__pill">Plano {planLabel}</div>
          <Link className="btn btn--outline btn--sm" to="/configuracoes">
            Voltar para Configuracoes
          </Link>
        </div>
      </section>

      {whatsappConnectEnabled ? (
      <section className="settings-module-card settings-module-card--status">
        <div>
          <h3>Conexao manual com Meta</h3>
          <p className="muted">
            Informe manualmente o token e os IDs da sua conta Meta. O backend valida na Graph API antes de salvar e, se nao houver conta valida, o sistema continua no fallback global configurado.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            alignItems: 'start',
          }}
        >
          <div className="box" style={{ padding: 18, display: 'grid', gap: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Status da integracao</div>
                <strong style={{ display: 'block', fontSize: 20 }}>{statusLabel}</strong>
              </div>
              <span className={statusChipClass(statusTone)}>{statusLabel}</span>
            </div>

            <div className="settings-module-status-grid">
              <div className="settings-module-kpi">
                <span className="settings-module-kpi__label">Numero conectado</span>
                <strong>{whatsappConnected ? phoneLabel : 'Nao conectado'}</strong>
                <span className="muted">{whatsappConnected ? verifiedNameLabel : 'Sem conta propria ativa para este tenant.'}</span>
              </div>
              <div className="settings-module-kpi">
                <span className="settings-module-kpi__label">Franquia atual</span>
                <strong>
                  {walletSummary.available
                    ? `${walletSummary.includedLimit.toLocaleString('pt-BR')} msgs/mes`
                    : 'Indisponivel'}
                </strong>
                <span className="muted">Mes de referencia: {walletSummary.monthLabel}</span>
              </div>
              <div className="settings-module-kpi">
                <span className="settings-module-kpi__label">Saldo total</span>
                <strong>{walletSummary.totalBalance.toLocaleString('pt-BR')}</strong>
                <span className="muted">Estimativa de {walletSummary.appointmentsEstimate.toFixed(1)} agendamentos</span>
              </div>
            </div>

            {whatsapp.loading ? (
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="spinner" aria-hidden="true" />
                <span className="muted">Carregando status do WhatsApp...</span>
              </div>
            ) : null}
            {!whatsapp.loading && whatsappConnected ? (
              <div className="notice notice--success">Conectado ao numero {phoneLabel}. Os envios deste tenant usam a conta propria antes do fallback global.</div>
            ) : null}
            {!whatsapp.loading && !whatsappConnected ? (
              <div className="notice notice--warn">Nenhuma conta propria conectada. Enquanto isso, o sistema pode continuar usando o numero global do .env.</div>
            ) : null}
            {whatsapp.error ? <div className="notice notice--error">{whatsapp.error}</div> : null}
            {whatsapp.notice ? <div className="notice notice--success">{whatsapp.notice}</div> : null}

            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <div>
                <div className="muted" style={{ fontSize: 12 }}>WABA ID</div>
                <strong>{account?.waba_id || 'Nao disponivel'}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>phone_number_id</div>
                <strong>{account?.phone_number_id || 'Nao disponivel'}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Business Account ID</div>
                <strong>{account?.business_account_id || 'Nao disponivel'}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Ultima validacao do token</div>
                <strong>{lastValidatedLabel}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Conectado em</div>
                <strong>{connectedAtLabel}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Ultima sincronizacao</div>
                <strong>{lastSyncLabel}</strong>
              </div>
            </div>

            {account?.last_error ? (
              <div className="notice notice--warn">
                Ultimo erro registrado: {account.last_error}
              </div>
            ) : null}

            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn--outline"
                onClick={beginWhatsAppManualConnect}
              >
                {whatsappConnected ? 'Reconectar / editar' : 'Preencher dados'}
              </button>
              {whatsappConnected ? (
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={() => void disconnectWhatsApp()}
                  disabled={whatsapp.disconnectLoading}
                >
                  {whatsapp.disconnectLoading ? <span className="spinner" /> : 'Desconectar conta'}
                </button>
              ) : null}
            </div>
          </div>

          <aside className="box" style={{ padding: 18, display: 'grid', gap: 14 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Como conectar</div>
              <h4 style={{ margin: '6px 0 0' }}>Passo a passo manual</h4>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {manualSteps.map((step, index) => (
                <div key={step} className="box" style={{ padding: 12, display: 'grid', gap: 4 }}>
                  <strong>{index + 1}. {step}</strong>
                </div>
              ))}
            </div>
            <div className="notice notice--warn" style={{ margin: 0 }}>
              Os dados sao usados apenas para integrar o numero do estabelecimento ao sistema. O token e armazenado com seguranca no backend.
            </div>
            <div className="notice notice--success" style={{ margin: 0 }}>
              Se a conta do tenant nao estiver valida, o sistema continua podendo usar o numero padrao global quando essa politica estiver ativa.
            </div>
          </aside>
        </div>

        <div className="box" style={{ padding: 18, marginTop: 16, display: 'grid', gap: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <h4 style={{ margin: 0 }}>Formulario manual</h4>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Preencha os dados da Meta, valide a conexao e so depois salve para este estabelecimento.
              </p>
            </div>
            <span className={statusChipClass(isEditing ? 'pending' : statusTone)}>
              {isEditing ? 'Edicao ativa' : statusLabel}
            </span>
          </div>

          {isEditing ? (
            <>
              <div
                style={{
                  display: 'grid',
                  gap: 12,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                }}
              >
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Business Manager / Business Account ID</span>
                  <input
                    className="input"
                    value={whatsapp.form.business_account_id}
                    onChange={(event) => updateWhatsAppManualField('business_account_id', event.target.value)}
                    placeholder="Opcional"
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>WABA ID</span>
                  <input
                    className="input"
                    value={whatsapp.form.waba_id}
                    onChange={(event) => updateWhatsAppManualField('waba_id', event.target.value)}
                    placeholder="Obrigatorio"
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Phone Number ID</span>
                  <input
                    className="input"
                    value={whatsapp.form.phone_number_id}
                    onChange={(event) => updateWhatsAppManualField('phone_number_id', event.target.value)}
                    placeholder="Obrigatorio"
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Nome descritivo da conta</span>
                  <input
                    className="input"
                    value={whatsapp.form.descriptive_name}
                    onChange={(event) => updateWhatsAppManualField('descriptive_name', event.target.value)}
                    placeholder="Ex.: Recepcao principal"
                  />
                </label>
              </div>

              <label style={{ display: 'grid', gap: 6 }}>
                <span>Access Token</span>
                <textarea
                  className="input"
                  rows={4}
                  value={whatsapp.form.access_token}
                  onChange={(event) => updateWhatsAppManualField('access_token', event.target.value)}
                  placeholder="Cole aqui o token gerado na Meta"
                />
              </label>

              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void validateWhatsAppManualConnection()}
                  disabled={whatsapp.validationLoading}
                >
                  {whatsapp.validationLoading ? <span className="spinner" /> : 'Validar conexao'}
                </button>
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={() => void saveWhatsAppManualConnection()}
                  disabled={!canSaveConnection}
                >
                  {whatsapp.saveLoading ? <span className="spinner" /> : 'Salvar conexao'}
                </button>
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={cancelWhatsAppManualEdit}
                  disabled={whatsapp.validationLoading || whatsapp.saveLoading}
                >
                  Cancelar edicao
                </button>
              </div>
            </>
          ) : (
            <div className="notice notice--warn" style={{ margin: 0 }}>
              Clique em "Reconectar / editar" para atualizar token ou trocar os IDs da conta Meta deste estabelecimento.
            </div>
          )}

          {manualPreview ? (
            <div className="box" style={{ padding: 16, display: 'grid', gap: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong>Resumo validado pela Meta</strong>
                <span className={statusChipClass('pending')}>Validado</span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gap: 12,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                }}
              >
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Numero validado</div>
                  <strong>{manualPreview.display_phone_number || 'Nao informado'}</strong>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Nome verificado</div>
                  <strong>{manualPreview.verified_name || 'Nao informado'}</strong>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>WABA ID</div>
                  <strong>{manualPreview.waba_id || 'Nao informado'}</strong>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Phone Number ID</div>
                  <strong>{manualPreview.phone_number_id || 'Nao informado'}</strong>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Business Account ID</div>
                  <strong>{manualPreview.business_account_id || 'Nao informado'}</strong>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Token validado em</div>
                  <strong>{formatConnectionDate(manualPreview.token_last_validated_at)}</strong>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
      ) : (
      <section className="settings-module-card settings-module-card--status">
        <div
          style={{
            display: 'grid',
            gap: 18,
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            alignItems: 'stretch',
          }}
        >
          <div
            className="box"
            style={{
              padding: 24,
              display: 'grid',
              gap: 18,
              background:
                'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(6,78,59,0.06) 45%, rgba(255,255,255,0.96) 100%)',
              border: '1px solid rgba(16,185,129,0.16)',
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div className="row" style={{ gap: 14, alignItems: 'center' }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 18,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'linear-gradient(135deg, #10b981 0%, #0f766e 100%)',
                    color: '#fff',
                    boxShadow: '0 18px 40px rgba(15,118,110,0.18)',
                  }}
                >
                  <IconPhone style={{ width: 24, height: 24 }} />
                </div>
                <div>
                  <span className={statusChipClass('pending')}>Em breve</span>
                  <h3 style={{ margin: '8px 0 4px' }}>Integracao com WhatsApp Business</h3>
                  <p className="muted" style={{ margin: 0 }}>
                    Em breve voce podera conectar o seu proprio numero do WhatsApp Business diretamente ao Agendamentos Online por meio da integracao oficial da Meta.
                  </p>
                </div>
              </div>
              <button type="button" className="btn btn--primary" disabled style={{ opacity: 0.7, cursor: 'not-allowed' }}>
                Conectar com Meta
              </button>
            </div>

            <div className="notice notice--success" style={{ margin: 0 }}>
              Estamos preparando a integracao oficial com a Meta para que voce possa conectar seu WhatsApp Business com mais seguranca, simplicidade e estabilidade.
            </div>

            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              }}
            >
              {[
                'Confirmacoes automaticas de agendamento',
                'Lembretes automaticos para clientes',
                'Mensagens enviadas com o numero do seu estabelecimento',
                'Gestao centralizada da comunicacao no painel',
              ].map((item) => (
                <div key={item} className="box" style={{ padding: 14 }}>
                  <strong style={{ display: 'block', marginBottom: 4 }}>{item}</strong>
                  <span className="muted" style={{ fontSize: 13 }}>
                    Recurso premium em fase final de liberacao.
                  </span>
                </div>
              ))}
            </div>

            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--primary" disabled style={{ opacity: 0.7, cursor: 'not-allowed' }}>
                Disponivel em breve
              </button>
              <button type="button" className="btn btn--outline" disabled style={{ opacity: 0.65, cursor: 'not-allowed' }}>
                Integracao oficial da Meta
              </button>
            </div>
          </div>

          <aside className="box" style={{ padding: 22, display: 'grid', gap: 14 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Status</div>
              <h4 style={{ margin: '6px 0 0' }}>Em breve</h4>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Estamos finalizando a liberacao dessa funcionalidade para oferecer uma experiencia mais simples, segura e oficial para o seu estabelecimento.
            </p>
            <div className="box" style={{ padding: 14 }}>
              <strong style={{ display: 'block', marginBottom: 6 }}>O que estara disponivel quando liberar</strong>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
                <li>Ativacao direta por esta tela.</li>
                <li>Onboarding oficial da Meta.</li>
                <li>Experiencia mais estavel para o estabelecimento.</li>
              </ul>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Assim que a funcionalidade estiver disponivel, voce podera ativar a conexao diretamente por esta tela.
            </p>
          </aside>
        </div>
      </section>
      )}

      <section className="box config-page__wallet-box settings-module-wallet-shell">
        <div className="config-page__wallet-box-head settings-module-wallet-head">
          <div>
            <h4>Mensagens / Creditos</h4>
            <p>Acompanhe o limite mensal e recarregue pacotes extras via PIX quando necessario.</p>
          </div>
          {walletSummary.planBadge ? <span className="settings-module-wallet-badge">{walletSummary.planBadge}</span> : null}
        </div>

        <div className={m.whatsLayout}>
          <div className={m.mainCol}>
            <div className={m.walletPanel}>
              <div className={m.panelMain}>
                <div className={m.panelHeader}>
                  <div className={m.titleGroup}>
                    <h4 className={m.title}>WhatsApp (mensagens)</h4>
                    {walletSummary.planBadge ? <span className={m.badge}>{walletSummary.planBadge}</span> : null}
                  </div>
                  <div className={m.subtitle}>{walletSummary.monthLabel}</div>
                </div>

                {billing.loading ? (
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <span className="spinner" aria-hidden="true" />
                    <span className="muted">Carregando creditos do WhatsApp...</span>
                  </div>
                ) : null}

                {billing.error ? <div className="notice notice--error">{billing.error}</div> : null}

                {walletSummary.available ? (
                  <>
                    <div className={m.statGrid}>
                      <div className={m.statCard}>
                        <div className={m.statHeader}>
                          <div className={m.statLabel}>Incluido no plano</div>
                          {walletSummary.remainingLabel ? <div className={m.statRemaining}>{walletSummary.remainingLabel}</div> : null}
                        </div>
                        <div className={m.progress} aria-hidden="true">
                          <div className={m.progressFill} style={{ width: `${walletSummary.usagePercent}%` }} />
                        </div>
                        <div className={m.progressMeta}>
                          <span className={m.progressLabel}>{walletSummary.includedUsageLabel}</span>
                          <span className={m.progressPercent}>{Math.round(walletSummary.usagePercent)}%</span>
                        </div>
                      </div>

                      <div className={m.statCard}>
                        <div className={m.statLabel}>Creditos extras</div>
                        <div className={m.statValue}>{walletSummary.extraBalance.toLocaleString('pt-BR')}</div>
                        <div className={m.statHint}>Creditos comprados via PIX</div>
                      </div>

                      <div className={`${m.statCard} ${m.statHighlight}`}>
                        <div className={m.statLabel}>Total disponivel</div>
                        <div className={m.statValue}>{walletSummary.totalBalance.toLocaleString('pt-BR')}</div>
                        <div className={m.statHint}>
                          ~ {walletSummary.appointmentsEstimate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} agend. (5 msg = 1)
                        </div>
                      </div>
                    </div>

                    {walletSummary.totalBalance < 1 ? (
                      <div className={`notice notice--warn ${m.inlineNotice}`}>
                        WhatsApp pausado; e-mail e painel continuam ativos.
                      </div>
                    ) : null}
                  </>
                ) : !billing.loading ? (
                  <p className="muted" style={{ marginTop: 0 }}>Saldo indisponivel.</p>
                ) : null}

                <div className={m.section}>
                  <div className={m.sectionHeader}>
                    <span className={m.sectionTitle}>Pacotes extras (PIX)</span>
                    <span className={m.sectionHint}>Recarga imediata via PIX</span>
                  </div>
                  <div className={m.packageList}>
                    {packages.length ? packages.map((pack) => {
                      const priceLabel = formatCurrencyFromCents(pack.price_cents);
                      const oldPriceLabel = formatCurrencyFromCents(pack.old_price_cents);
                      const pricePerMessage =
                        pack.price_cents && pack.messages
                          ? (Number(pack.price_cents) / 100 / Number(pack.messages)).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })
                          : '';
                      const isRecommended = recommendedPackageKey === pack.key;
                      const description = pack.description || pack.label || 'Recarga imediata via PIX';
                      const isLoading = topupLoadingKey === pack.key;

                      return (
                        <div key={pack.key} className={`${m.packageRow} ${isRecommended ? m.packageRowHighlight : ''}`}>
                          <div className={m.packageInfo}>
                            <div className={m.packageTop}>
                              <div className={m.packageTitle}>
                                <span className={m.packageAmount}>+{pack.messages} msgs</span>
                                {isRecommended ? <span className={m.packageBadge}>Melhor custo</span> : null}
                              </div>
                              <span className={m.packagePrices}>
                                {oldPriceLabel ? <span className={m.oldPrice}>{oldPriceLabel}</span> : null}
                                <span className={m.priceLabel}>{priceLabel || 'Sob consulta'}</span>
                              </span>
                            </div>
                            <div className={m.packageMeta}>
                              <span className={m.packageDescription}>{description}</span>
                              {pricePerMessage ? <span className={m.priceHint}>~ {pricePerMessage}/msg</span> : null}
                            </div>
                          </div>
                          <div className={m.packageAction}>
                            <button
                              type="button"
                              className={`btn ${isRecommended ? 'btn--primary' : 'btn--outline'} ${m.actionButton}`}
                              onClick={() => void openWhatsappTopup(pack)}
                              disabled={isLoading}
                            >
                              {isLoading ? <span className="spinner" /> : 'Recarregar'}
                            </button>
                          </div>
                        </div>
                      );
                    }) : (
                      <div className={m.emptyRow}>Nenhum pacote disponivel no momento.</div>
                    )}
                  </div>
                  {topupError ? <div className={`notice notice--error ${m.inlineNotice}`}>{topupError}</div> : null}
                </div>

                <div className={m.section}>
                  <div className={m.sectionHeader}>
                    <div className={m.historyHeading}>
                      <span className={m.sectionTitle}>Historico de recargas</span>
                      <span className={m.historySubtext}>Mostrando as ultimas {Math.min(recentTopupHistory.length, 5)}</span>
                    </div>
                  </div>

                  {recentTopupHistory.length ? (
                    <ul className={m.historyList}>
                      {recentTopupHistory.map((item) => <HistoryItem key={item.key} item={item} />)}
                    </ul>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>Sem recargas recentes.</p>
                  )}

                  {filteredTopupHistory.length > recentTopupHistory.length ? (
                    <div className={m.historyActions}>
                      <button
                        type="button"
                        className={`btn btn--sm btn--outline ${m.historyToggle}`}
                        onClick={() => setHistoryExpanded((current) => !current)}
                        aria-expanded={historyExpanded}
                        aria-controls={historyPanelId}
                      >
                        {historyExpanded ? 'Ocultar historico completo' : 'Ver historico completo'}
                      </button>
                    </div>
                  ) : null}

                  {historyExpanded ? (
                    <div id={historyPanelId} className={m.historyPanel}>
                      {(hasHistoryDates || hasHistoryStatuses) ? (
                        <div className={m.historyFilters}>
                          {hasHistoryDates ? (
                            <label className={m.historyFilter}>
                              <span>Periodo</span>
                              <select value={historyRange} onChange={(event) => setHistoryRange(event.target.value)}>
                                <option value="all">Tudo</option>
                                <option value="30">Ultimos 30 dias</option>
                                <option value="90">Ultimos 90 dias</option>
                                <option value="year">Este ano</option>
                              </select>
                            </label>
                          ) : null}
                          {hasHistoryStatuses ? (
                            <label className={m.historyFilter}>
                              <span>Status</span>
                              <select value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)}>
                                <option value="all">Todos</option>
                                <option value="pending">Pendentes</option>
                                <option value="paid">Confirmados</option>
                                <option value="failed">Falhos</option>
                              </select>
                            </label>
                          ) : null}
                        </div>
                      ) : null}

                      {visibleTopupHistory.length ? (
                        <ul className={m.historyList}>
                          {visibleTopupHistory.map((item) => <HistoryItem key={item.key} item={item} />)}
                        </ul>
                      ) : (
                        <p className="muted" style={{ margin: 0 }}>Nenhum registro no periodo.</p>
                      )}

                      {hasMoreHistory ? (
                        <button
                          type="button"
                          className={`btn btn--sm btn--outline ${m.historyLoadMore}`}
                          onClick={loadMoreHistory}
                          disabled={historyLoadingMore}
                        >
                          {historyLoadingMore ? <span className="spinner" /> : 'Carregar mais'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <aside className={m.asideCol}>
            <div className={`plan-card__features ${m.planColLeft}`}>
              <span className="plan-card__features-title">Resumo do modulo</span>
              <ul>
                {walletSummary.planSummaryItems.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>

            <div className={`${m.helpCard} ${helpOpen ? m.helpCardOpen : ''}`}>
              <button
                type="button"
                className={m.helpToggle}
                onClick={() => setHelpOpen((current) => !current)}
                aria-expanded={helpOpen}
                aria-controls="whatsapp-business-help"
              >
                <span className={m.helpTitle}>Ajuda rapida</span>
                <IconChevronRight className={m.helpIcon} aria-hidden="true" />
              </button>
              <div id="whatsapp-business-help" className={`${m.helpBody} ${helpOpen ? m.helpBodyOpen : ''}`}>
                <ul className={m.helpList}>
                  <li>Use o numero oficial do estabelecimento para confirmacoes e lembretes.</li>
                  <li>Quando a franquia termina, os envios seguem por e-mail e painel.</li>
                  <li>Pacotes extras caem automaticamente apos a confirmacao do PIX.</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {pixModal.open ? (
        <Modal
          title="Pagamento via PIX"
          onClose={closePixModal}
          actions={[
            pixModal.data?.ticket_url ? (
              <a key="open" className="btn btn--primary" href={pixModal.data.ticket_url} target="_blank" rel="noreferrer">
                Abrir no app do banco
              </a>
            ) : null,
            <button key="close" type="button" className="btn btn--outline" onClick={closePixModal}>
              Fechar
            </button>,
          ].filter(Boolean)}
        >
          <div className="pix-checkout">
            {pixStatus.label ? (
              <div className={`pix-checkout__status${pixStatus.tone ? ` pix-checkout__status--${pixStatus.tone}` : ''}`}>
                <div className="pix-checkout__status-main">
                  <span className="pix-checkout__status-icon" aria-hidden="true">{pixStatus.icon}</span>
                  <span>{pixStatus.label}</span>
                </div>
                {pixModal.data?.status ? (
                  <span className="pix-checkout__status-code">Status: {String(pixModal.data.status).toUpperCase()}</span>
                ) : null}
              </div>
            ) : null}

            <div className={`box pix-checkout__topup-status${pixStatus.tone === 'success' ? ' is-success' : ' is-pending'}`}>
              {pixStatus.tone === 'success' ? (
                <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                  <span className="pix-checkout__topup-icon" aria-hidden="true">OK</span>
                  <strong>Pagamento confirmado</strong>
                </div>
              ) : (
                <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                  <span className="spinner" aria-hidden="true" />
                  <span>Aguardando confirmacao do pagamento...</span>
                </div>
              )}
              {pixNotice ? <p className="muted" style={{ margin: 0 }}>{pixNotice}</p> : null}
              {pixStatus.tone !== 'success' ? (
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn btn--sm btn--outline" onClick={() => void refreshPixStatus({ silent: false })}>
                    Atualizar agora
                  </button>
                </div>
              ) : null}
            </div>

            {pixPack ? (
              <div className="pix-checkout__pack muted">
                Pacote: +{pixPack.messages || '-'} msgs{pixPackPrice ? ` (${pixPackPrice})` : ''}
              </div>
            ) : null}

            {pixAmount ? <div className="pix-checkout__amount">Valor a pagar: {pixAmount}</div> : null}

            {pixModal.data?.qr_code_base64 ? (
              <img
                src={`data:image/png;base64,${pixModal.data.qr_code_base64}`}
                alt="QR Code PIX"
                className="pix-checkout__qr"
              />
            ) : (
              <p className="muted pix-checkout__hint">Abra o link acima para visualizar o QR Code.</p>
            )}

            {pixCode ? (
              <div className="pix-checkout__code">
                <label htmlFor="pix-code">Chave copia e cola</label>
                <textarea id="pix-code" readOnly value={pixCode} rows={3} className="input" />
                <div className="pix-checkout__code-actions">
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => void copyPixCode()}>
                    Copiar codigo
                  </button>
                </div>
                {pixCopyNotice ? <p className="muted pix-checkout__note">{pixCopyNotice}</p> : null}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
