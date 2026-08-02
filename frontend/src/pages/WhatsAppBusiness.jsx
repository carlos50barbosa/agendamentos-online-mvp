import React from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import { IconChevronRight, IconPhone } from '../components/Icons.jsx';
import walletStyles from '../components/WhatsAppWalletPanel.module.css';
import WhatsAppEmbeddedSignup from '../components/estab/WhatsAppEmbeddedSignup.jsx';
import useBusinessSettings from '../hooks/useBusinessSettings.js';

const m = walletStyles;

function statusChipClass(tone) {
  if (tone === 'success') return `${m.statusChip} ${m.statusSuccess}`;
  if (tone === 'pending') return `${m.statusChip} ${m.statusPending}`;
  if (tone === 'error') return `${m.statusChip} ${m.statusError}`;
  if (tone === 'neutral') return `${m.statusChip} ${m.statusNeutral}`;
  return m.statusChip;
}

// O dono não pensa em "confirm_cli"; pensa em "confirmação".
const TEMPLATE_LABELS = {
  confirm_cli: 'Confirmação de agendamento',
  reminder_cli: 'Lembrete',
  cancel_cli: 'Cancelamento',
  reschedule_cli: 'Remarcação',
};

const TEMPLATE_STATUS_LABELS = {
  APPROVED: 'liberado',
  PENDING: 'em análise',
  REJECTED: 'recusado',
  PAUSED: 'pausado',
  DISABLED: 'desativado',
};

function formatConnectionDate(value) {
  if (!value) return 'Não disponível';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Não disponível';
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
    refreshWhatsAppConnection,
    walletSummary,
    helpOpen,
    setHelpOpen,
    beginWhatsAppManualConnect,
    updateWhatsAppManualField,
    validateWhatsAppManualConnection,
    saveWhatsAppManualConnection,
    cancelWhatsAppManualEdit,
    disconnectWhatsApp,
  } = useBusinessSettings({ loadWhatsApp: true });

  if (!isEstablishment) {
    return <p className="muted">Disponível apenas para contas de estabelecimento.</p>;
  }

  const account = whatsapp.account || null;
  const phoneLabel = account?.display_phone_number || 'Número indisponível';
  const verifiedNameLabel = account?.verified_name || 'Não informado';
  const planLabel = String(planInfo.plan || 'starter').toUpperCase();
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
    not_connected: 'Não conectado',
  };
  const statusLabel = statusLabelMap[accountStatus] || 'Não conectado';
  const connectedAtLabel = formatConnectionDate(account?.connected_at);
  const lastSyncLabel = formatConnectionDate(account?.last_sync_at);
  const lastValidatedLabel = formatConnectionDate(account?.token_last_validated_at);
  const templatesInfo = whatsapp.templates || null;
  const isEditing = Boolean(whatsapp.editing) || !account;
  const manualPreview = whatsapp.preview || null;
  const canSaveConnection = Boolean(whatsapp.validated && manualPreview && !whatsapp.saveLoading);
  const manualSteps = [
    'Acesse o Meta for Developers / WhatsApp Cloud API.',
    'Gere ou copie um access token com permissão para o número.',
    'Copie o WABA ID e o Phone Number ID do número que será usado.',
    'Cole os dados abaixo, valide a conexão e salve.',
  ];

  return (
    <div className="grid config-page settings-module-page" style={{ gap: 16 }}>
      <section className="card config-page__hero settings-module-hero">
        <div className="settings-module-hero__copy">
          <span className="settings-module-hero__eyebrow">Módulo dedicado</span>
          <h2>WhatsApp Business</h2>
          <p className="muted">
            {whatsappConnectEnabled
              ? 'Gerencie a conexão do WhatsApp Business do estabelecimento e acompanhe a franquia do plano.'
              : 'Em breve você poderá conectar o seu próprio número do WhatsApp Business diretamente ao Agendamentos Online por meio da integração oficial da Meta.'}
          </p>
        </div>
        <div className="settings-module-hero__meta">
          <div className="settings-module-hero__pill">Plano {planLabel}</div>
          <Link className="btn btn--outline btn--sm" to="/configuracoes">
            Voltar para Configurações
          </Link>
        </div>
      </section>

      {/* Some sozinho quando o servidor responde available:false (sem config_id na Meta) — então
          o painel continua exatamente como está hoje até a configuração existir. */}
      {whatsappConnectEnabled && !whatsappConnected ? (
        <WhatsAppEmbeddedSignup
          onConnected={refreshWhatsAppConnection}
          disabled={whatsapp.loading}
        />
      ) : null}

      {whatsappConnectEnabled ? (
      <section className="settings-module-card settings-module-card--status">
        <div>
          <h3>Conexão manual com Meta</h3>
          <p className="muted">
            Informe manualmente o token e os IDs da sua conta Meta. O backend valida na Graph API antes de salvar e, se não houver conta válida, o sistema continua no fallback global configurado.
          </p>
        </div>

        {/* min(320px, 100%) e não 320px puro: em 375px de tela a largura útil
            dentro do card fica ~305px, abaixo do mínimo, e a coluna estourava.
            O overflow-x: hidden global escondia o estouro em vez de rolar, então
            o conteúdo cortado ficava inalcançável e sem sintoma visível. */}
        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))',
            alignItems: 'start',
          }}
        >
          <div className="box" style={{ padding: 18, display: 'grid', gap: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Status da integração</div>
                <strong style={{ display: 'block', fontSize: 20 }}>{statusLabel}</strong>
              </div>
              <span className={statusChipClass(statusTone)}>{statusLabel}</span>
            </div>

            <div className="settings-module-status-grid">
              <div className="settings-module-kpi">
                <span className="settings-module-kpi__label">Número conectado</span>
                <strong>{whatsappConnected ? phoneLabel : 'Não conectado'}</strong>
                <span className="muted">{whatsappConnected ? verifiedNameLabel : 'Sem conta própria ativa para este tenant.'}</span>
              </div>
              <div className="settings-module-kpi">
                <span className="settings-module-kpi__label">Franquia atual</span>
                <strong>
                  {walletSummary.available
                    ? `${walletSummary.includedLimit.toLocaleString('pt-BR')} msgs/mes`
                    : 'Indisponível'}
                </strong>
                <span className="muted">Mês de referência: {walletSummary.monthLabel}</span>
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
              <div className="notice notice--success">Conectado ao número {phoneLabel}. Os envios deste tenant usam a conta própria antes do fallback global.</div>
            ) : null}

            {/* Conectado não é o mesmo que pronto: os modelos precisam ser aprovados pela Meta, e
                até lá o aviso daquele tipo sai por e-mail. Sem dizer isso aqui, o dono vê
                "Conectado" e conclui que o produto está falhando. */}
            {!whatsapp.loading && templatesInfo && !templatesInfo.ready ? (
              <div className={templatesInfo.recusados ? 'notice notice--error' : 'notice notice--warn'}>
                <strong>
                  {templatesInfo.recusados
                    ? 'Alguns modelos de mensagem foram recusados pela Meta'
                    : 'Seus modelos de mensagem estão em análise na Meta'}
                </strong>
                <div style={{ marginTop: 4 }}>
                  {templatesInfo.aprovados} de {templatesInfo.total} liberados. Enquanto isso, os
                  avisos que dependem dos modelos pendentes saem por e-mail — nenhum agendamento
                  deixa de ser confirmado.
                </div>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {templatesInfo.detalhes.map((t) => (
                    <li key={t.kind}>
                      {TEMPLATE_LABELS[t.kind] || t.kind}: <strong>{TEMPLATE_STATUS_LABELS[t.status] || t.status}</strong>
                      {t.motivo ? ` — ${t.motivo}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!whatsapp.loading && !whatsappConnected ? (
              <div className="notice notice--warn">Nenhuma conta própria conectada. Enquanto isso, o sistema pode continuar usando o número global do `.env`.</div>
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
                <strong>{account?.waba_id || 'Não disponível'}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>phone_number_id</div>
                <strong>{account?.phone_number_id || 'Não disponível'}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Business Account ID</div>
                <strong>{account?.business_account_id || 'Não disponível'}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Última validação do token</div>
                <strong>{lastValidatedLabel}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Conectado em</div>
                <strong>{connectedAtLabel}</strong>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Última sincronização</div>
                <strong>{lastSyncLabel}</strong>
              </div>
            </div>

            {account?.last_error ? (
              <div className="notice notice--warn">
                Último erro registrado: {account.last_error}
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
              Os dados são usados apenas para integrar o número do estabelecimento ao sistema. O token é armazenado com segurança no backend.
            </div>
            <div className="notice notice--success" style={{ margin: 0 }}>
              Se a conta do tenant não estiver válida, o sistema continua podendo usar o número padrão global quando essa política estiver ativa.
            </div>
          </aside>
        </div>

        <div className="box" style={{ padding: 18, marginTop: 16, display: 'grid', gap: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <h4 style={{ margin: 0 }}>Formulário manual</h4>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Preencha os dados da Meta, valide a conexão e só depois salve para este estabelecimento.
              </p>
            </div>
            <span className={statusChipClass(isEditing ? 'pending' : statusTone)}>
              {isEditing ? 'Edição ativa' : statusLabel}
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
                    placeholder="Obrigatório"
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Phone Number ID</span>
                  <input
                    className="input"
                    value={whatsapp.form.phone_number_id}
                    onChange={(event) => updateWhatsAppManualField('phone_number_id', event.target.value)}
                    placeholder="Obrigatório"
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span>Nome descritivo da conta</span>
                  <input
                    className="input"
                    value={whatsapp.form.descriptive_name}
                    onChange={(event) => updateWhatsAppManualField('descriptive_name', event.target.value)}
                    placeholder="Ex.: Recepção principal"
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
                  {whatsapp.validationLoading ? <span className="spinner" /> : 'Validar conexão'}
                </button>
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={() => void saveWhatsAppManualConnection()}
                  disabled={!canSaveConnection}
                >
                  {whatsapp.saveLoading ? <span className="spinner" /> : 'Salvar conexão'}
                </button>
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={cancelWhatsAppManualEdit}
                  disabled={whatsapp.validationLoading || whatsapp.saveLoading}
                >
                  Cancelar edição
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
                  <div className="muted" style={{ fontSize: 12 }}>Número validado</div>
                  <strong>{manualPreview.display_phone_number || 'Não informado'}</strong>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Nome verificado</div>
                  <strong>{manualPreview.verified_name || 'Não informado'}</strong>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>WABA ID</div>
                  <strong>{manualPreview.waba_id || 'Não informado'}</strong>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Phone Number ID</div>
                  <strong>{manualPreview.phone_number_id || 'Não informado'}</strong>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Business Account ID</div>
                  <strong>{manualPreview.business_account_id || 'Não informado'}</strong>
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
                  <h3 style={{ margin: '8px 0 4px' }}>Integração com WhatsApp Business</h3>
                  <p className="muted" style={{ margin: 0 }}>
                    Em breve você poderá conectar o seu próprio número do WhatsApp Business diretamente ao Agendamentos Online por meio da integração oficial da Meta.
                  </p>
                </div>
              </div>
              <button type="button" className="btn btn--primary" disabled style={{ opacity: 0.7, cursor: 'not-allowed' }}>
                Conectar com Meta
              </button>
            </div>

            <div className="notice notice--success" style={{ margin: 0 }}>
              Estamos preparando a integração oficial com a Meta para que você possa conectar seu WhatsApp Business com mais segurança, simplicidade e estabilidade.
            </div>

            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              }}
            >
              {[
                'Confirmações automáticas de agendamento',
                'Lembretes automáticos para clientes',
                'Mensagens enviadas com o número do seu estabelecimento',
                'Gestão centralizada da comunicação no painel',
              ].map((item) => (
                <div key={item} className="box" style={{ padding: 14 }}>
                  <strong style={{ display: 'block', marginBottom: 4 }}>{item}</strong>
                  <span className="muted" style={{ fontSize: 13 }}>
                    Recurso premium em fase final de liberação.
                  </span>
                </div>
              ))}
            </div>

            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--primary" disabled style={{ opacity: 0.7, cursor: 'not-allowed' }}>
                Disponível em breve
              </button>
              <button type="button" className="btn btn--outline" disabled style={{ opacity: 0.65, cursor: 'not-allowed' }}>
                Integração oficial da Meta
              </button>
            </div>
          </div>

          <aside className="box" style={{ padding: 22, display: 'grid', gap: 14 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Status</div>
              <h4 style={{ margin: '6px 0 0' }}>Em breve</h4>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Estamos finalizando a liberação dessa funcionalidade para oferecer uma experiência mais simples, segura e oficial para o seu estabelecimento.
            </p>
            <div className="box" style={{ padding: 14 }}>
              <strong style={{ display: 'block', marginBottom: 6 }}>O que estará disponível quando liberar</strong>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
                <li>Ativação direta por esta tela.</li>
                <li>Onboarding oficial da Meta.</li>
                <li>Experiência mais estável para o estabelecimento.</li>
              </ul>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Assim que a funcionalidade estiver disponível, você poderá ativar a conexão diretamente por esta tela.
            </p>
          </aside>
        </div>
      </section>
      )}

      <section className="box config-page__wallet-box settings-module-wallet-shell">
        <div className="config-page__wallet-box-head settings-module-wallet-head">
          <div>
            <h4>Mensagens / Créditos</h4>
            <p>Acompanhe o limite mensal de mensagens incluído no seu plano.</p>
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
                    <span className="muted">Carregando créditos do WhatsApp...</span>
                  </div>
                ) : null}

                {billing.error ? <div className="notice notice--error">{billing.error}</div> : null}

                {walletSummary.available ? (
                  <>
                    <div className={m.statGrid}>
                      <div className={m.statCard}>
                        <div className={m.statHeader}>
                          <div className={m.statLabel}>Incluído no plano</div>
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
                        <div className={m.statLabel}>Saldo adicional</div>
                        <div className={m.statValue}>{walletSummary.extraBalance.toLocaleString('pt-BR')}</div>
                        <div className={m.statHint}>Créditos concedidos fora da franquia</div>
                      </div>

                      <div className={`${m.statCard} ${m.statHighlight}`}>
                        <div className={m.statLabel}>Total disponível</div>
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
                  <p className="muted" style={{ marginTop: 0 }}>Saldo indisponível.</p>
                ) : null}

              </div>
            </div>
          </div>

          <aside className={m.asideCol}>
            <div className={`plan-card__features ${m.planColLeft}`}>
              <span className="plan-card__features-title">Resumo do módulo</span>
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
                <span className={m.helpTitle}>Ajuda rápida</span>
                <IconChevronRight className={m.helpIcon} aria-hidden="true" />
              </button>
              <div id="whatsapp-business-help" className={`${m.helpBody} ${helpOpen ? m.helpBodyOpen : ''}`}>
                <ul className={m.helpList}>
                  <li>Use o número oficial do estabelecimento para confirmações e lembretes.</li>
                  <li>Quando a franquia termina, os envios seguem por e-mail e painel.</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </section>

    </div>
  );
}
