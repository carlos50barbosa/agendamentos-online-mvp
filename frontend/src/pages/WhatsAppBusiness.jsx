import React from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import { IconChevronRight } from '../components/Icons.jsx';
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

export default function WhatsAppBusiness() {
  const {
    isEstablishment,
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
    startWhatsAppConnect,
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
  const planLabel = String(planInfo.plan || 'starter').toUpperCase();
  const historyPanelId = 'whatsapp-business-history';
  const pixPack = pixModal.data?.pack || null;
  const pixPackPrice = formatCurrencyFromCents(pixPack?.price_cents);
  const pixAmount =
    typeof pixModal.data?.amount_cents === 'number'
      ? formatCurrencyFromCents(pixModal.data.amount_cents)
      : '';

  return (
    <div className="grid config-page settings-module-page" style={{ gap: 16 }}>
      <section className="card config-page__hero settings-module-hero">
        <div className="settings-module-hero__copy">
          <span className="settings-module-hero__eyebrow">Modulo dedicado</span>
          <h2>WhatsApp Business</h2>
          <p className="muted">
            Gerencie a conexao oficial do WhatsApp, acompanhe a franquia do plano e recarregue creditos extras via PIX.
          </p>
        </div>
        <div className="settings-module-hero__meta">
          <div className="settings-module-hero__pill">Plano {planLabel}</div>
          <Link className="btn btn--outline btn--sm" to="/configuracoes">
            Voltar para Configuracoes
          </Link>
        </div>
      </section>

      <section className="settings-module-card settings-module-card--status">
        <div>
          <h3>Status da conexao</h3>
          <p className="muted">
            Conecte o numero do estabelecimento para enviar mensagens com o proprio WhatsApp Business.
          </p>
        </div>
        <div className="settings-module-status-grid">
          <div className="settings-module-kpi">
            <span className="settings-module-kpi__label">Canal</span>
            <strong>{whatsappConnected ? 'Conectado' : 'Desconectado'}</strong>
            <span className="muted">{whatsappConnected ? phoneLabel : 'Ative o canal para liberar os envios.'}</span>
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
          <div className="notice notice--success">Conectado ao numero {phoneLabel}.</div>
        ) : null}
        {!whatsapp.loading && !whatsappConnected ? (
          <div className="notice notice--warn">WhatsApp nao conectado. Conecte seu numero para ativar os envios.</div>
        ) : null}
        {account?.phone_number_id ? (
          <span className="muted" style={{ fontSize: 12 }}>phone_number_id: {account.phone_number_id}</span>
        ) : null}
        {whatsapp.error ? <div className="notice notice--error">{whatsapp.error}</div> : null}
        {whatsapp.notice ? <div className="notice notice--success">{whatsapp.notice}</div> : null}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void startWhatsAppConnect()}
            disabled={whatsapp.connectLoading}
          >
            {whatsapp.connectLoading ? <span className="spinner" /> : 'Conectar WhatsApp Business'}
          </button>
          {whatsappConnected ? (
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => void disconnectWhatsApp()}
              disabled={whatsapp.disconnectLoading}
            >
              {whatsapp.disconnectLoading ? <span className="spinner" /> : 'Desconectar'}
            </button>
          ) : null}
        </div>
      </section>

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
