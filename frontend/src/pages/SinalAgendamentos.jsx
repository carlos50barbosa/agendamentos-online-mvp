import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import useBusinessSettings from '../hooks/useBusinessSettings.js';
import { formatCpfCnpj, formatBRPhone, onlyDigits } from '../utils/masks.js';

const brl = (cents) =>
  (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const COMPANY_TYPES = [
  { value: 'MEI', label: 'Microempreendedor individual (MEI)' },
  { value: 'INDIVIDUAL', label: 'Empresário individual' },
  { value: 'LIMITED', label: 'Sociedade limitada' },
  { value: 'ASSOCIATION', label: 'Associação' },
];

// Rótulo por campo, para a lista de pendências falar a língua do dono e não a do Asaas.
const FIELD_LABELS = {
  name: 'Nome',
  email: 'E-mail',
  cpfCnpj: 'CPF/CNPJ',
  birthDate: 'Data de nascimento',
  companyType: 'Tipo de empresa',
  mobilePhone: 'Celular',
  incomeValue: 'Faturamento mensal',
  postalCode: 'CEP',
  address: 'Rua',
  addressNumber: 'Número',
  province: 'Bairro',
};

export default function SinalAgendamentos() {
  const {
    isEstablishment,
    deposit,
    setDepositEnabled,
    setDepositPercent,
    setDepositWalletId,
    saveDepositSettings,
    subaccount,
    refreshSubaccount,
    setSubaccountField,
    setSubaccountAccepted,
    createSubaccount,
  } = useBusinessSettings({ loadDeposit: true });

  const isAsaas = deposit.provider === 'asaas';
  // Ramifica por `walletSource` (só o servidor o define) e NÃO por `walletId`: este último
  // muda a cada tecla no campo manual, e o card trocaria de estado no meio da digitação.
  const walletConfigured = Boolean(deposit.walletSource);
  const needsOnboarding = isAsaas && deposit.allowed && !walletConfigured;

  // O rascunho só é buscado quando falta carteira: é o único momento em que ele é usado.
  useEffect(() => {
    if (needsOnboarding && !subaccount.loaded && !subaccount.loading) {
      void refreshSubaccount();
    }
  }, [needsOnboarding, subaccount.loaded, subaccount.loading, refreshSubaccount]);

  if (!isEstablishment) {
    return <p className="muted">Disponível apenas para contas de estabelecimento.</p>;
  }

  const form = subaccount.form || {};
  const isCnpj = onlyDigits(form.cpfCnpj || '').length === 14;
  const receiverReady = Boolean(deposit.walletId);
  const field = (name) => (event) => setSubaccountField(name, event.target.value);

  // Taxa e piso vêm do backend (o .env manda), nunca cravados aqui.
  const feeCents = Number(deposit.feeCents || 0);
  const minSignalCents = Number(deposit.minSignalCents || 0) || 500;
  // Exemplos a partir do piso: mostrar só valores que o dono pode de fato cobrar.
  const feeExamples = [minSignalCents, 1000, 2000, 3000, 5000].filter(
    (cents, i, list) => cents >= minSignalCents && list.indexOf(cents) === i,
  );

  return (
    <div className="grid config-page settings-module-page" style={{ gap: 16 }}>
      <section className="card config-page__hero settings-module-hero">
        <div className="settings-module-hero__copy">
          <span className="settings-module-hero__eyebrow">Módulo financeiro</span>
          <h2>Sinal nos agendamentos</h2>
          <p className="muted">
            Defina um percentual de sinal via PIX. O valor cai direto na sua conta de recebimento, via split.
          </p>
        </div>
        <div className="settings-module-hero__meta">
          <div className="settings-module-hero__pill">Asaas + PIX</div>
          <Link className="btn btn--outline btn--sm" to="/configuracoes">
            Voltar para Configurações
          </Link>
        </div>
      </section>

      <div className="settings-module-grid settings-module-grid--split">
        <section className="settings-module-card settings-module-card--status">
          <div>
            <h3>Conta de recebimento</h3>
            <p className="muted">
              {walletConfigured
                ? 'É para esta carteira que o sinal é repassado, sem passar pela plataforma.'
                : 'Abrimos a conta para você. Confirme os dados abaixo — não é preciso se cadastrar no Asaas.'}
            </p>
          </div>

          {!deposit.allowed ? (
            <div className="notice notice--info">
              O sinal (PIX) não está disponível no seu plano atual. <Link to="/planos">Conhecer planos</Link>
            </div>
          ) : null}

          {deposit.loading ? (
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="spinner" aria-hidden="true" />
              <span className="muted">Carregando configurações...</span>
            </div>
          ) : walletConfigured ? (
            <>
              <label className="label settings-module-field">
                <span>Wallet ID</span>
                <input
                  className="input"
                  type="text"
                  value={deposit.walletId}
                  readOnly={deposit.walletSource === 'subconta'}
                  onChange={(event) => setDepositWalletId(event.target.value)}
                  disabled={deposit.saving}
                />
              </label>

              {deposit.walletSource === 'subconta' ? (
                <div className="notice notice--success">
                  Conta criada em seu nome. O Asaas enviou o acesso para o seu e-mail — é por lá que
                  você acompanha o saldo e faz o saque.
                </div>
              ) : deposit.walletVerified ? (
                <div className="notice notice--success">Wallet ID validado — cobranças com split ativas.</div>
              ) : (
                <div className="notice notice--info">Wallet ID salvo. Será validado na primeira cobrança de sinal.</div>
              )}
            </>
          ) : !deposit.allowed ? null : subaccount.loading ? (
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="spinner" aria-hidden="true" />
              <span className="muted">Carregando seus dados...</span>
            </div>
          ) : (
            <>
              {subaccount.missing.length ? (
                <div className="notice notice--info">
                  Falta preencher: {subaccount.missing.map((key) => FIELD_LABELS[key] || key).join(', ')}.
                </div>
              ) : null}

              <div className="settings-module-form__row">
                <label className="label settings-module-field">
                  <span>{isCnpj ? 'Razão social' : 'Nome completo'}</span>
                  <input className="input" type="text" value={form.name || ''} onChange={field('name')} />
                </label>
                <label className="label settings-module-field">
                  <span>E-mail</span>
                  <input className="input" type="email" value={form.email || ''} onChange={field('email')} />
                </label>
              </div>

              <div className="settings-module-form__row">
                <label className="label settings-module-field">
                  <span>CPF/CNPJ</span>
                  <input
                    className="input"
                    type="text"
                    inputMode="numeric"
                    value={formatCpfCnpj(form.cpfCnpj || '')}
                    onChange={(event) => setSubaccountField('cpfCnpj', onlyDigits(event.target.value))}
                  />
                </label>
                {isCnpj ? (
                  <label className="label settings-module-field">
                    <span>Tipo de empresa</span>
                    <select className="input" value={form.companyType || ''} onChange={field('companyType')}>
                      <option value="">Selecione</option>
                      {COMPANY_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="label settings-module-field">
                    <span>Data de nascimento</span>
                    <input className="input" type="date" value={form.birthDate || ''} onChange={field('birthDate')} />
                  </label>
                )}
              </div>

              <div className="settings-module-form__row">
                <label className="label settings-module-field">
                  <span>Celular</span>
                  <input
                    className="input"
                    type="text"
                    inputMode="numeric"
                    value={formatBRPhone(form.mobilePhone || '')}
                    onChange={(event) => setSubaccountField('mobilePhone', onlyDigits(event.target.value))}
                  />
                </label>
                <label className="label settings-module-field">
                  <span>Faturamento mensal (R$)</span>
                  <input
                    className="input"
                    type="text"
                    inputMode="decimal"
                    placeholder="Ex: 8000"
                    value={form.incomeValue || ''}
                    onChange={field('incomeValue')}
                  />
                </label>
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
                O Asaas usa o faturamento para definir seus limites. Informar um valor muito abaixo do
                que você movimenta faz o saldo ficar retido para análise.
              </p>

              <div className="settings-module-form__row">
                <label className="label settings-module-field settings-module-field--sm">
                  <span>CEP</span>
                  <input
                    className="input"
                    type="text"
                    inputMode="numeric"
                    value={form.postalCode || ''}
                    onChange={(event) => setSubaccountField('postalCode', onlyDigits(event.target.value))}
                  />
                </label>
                <label className="label settings-module-field">
                  <span>Rua</span>
                  <input className="input" type="text" value={form.address || ''} onChange={field('address')} />
                </label>
              </div>

              <div className="settings-module-form__row">
                <label className="label settings-module-field settings-module-field--sm">
                  <span>Número</span>
                  <input className="input" type="text" value={form.addressNumber || ''} onChange={field('addressNumber')} />
                </label>
                <label className="label settings-module-field">
                  <span>Bairro</span>
                  <input className="input" type="text" value={form.province || ''} onChange={field('province')} />
                </label>
              </div>

              <label className="row" style={{ gap: 8, alignItems: 'flex-start', marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={subaccount.accepted}
                  onChange={(event) => setSubaccountAccepted(event.target.checked)}
                />
                <span className="muted" style={{ fontSize: 13 }}>
                  Autorizo a Agenda0 a abrir, em meu nome e com os dados acima, uma conta de
                  recebimento no Asaas para receber os sinais dos meus agendamentos.
                </span>
              </label>

              {subaccount.noticeMessage ? (
                <div className={subaccount.noticeType ? `notice notice--${subaccount.noticeType}` : 'notice'}>
                  {subaccount.noticeMessage}
                </div>
              ) : null}

              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => void createSubaccount()}
                  disabled={subaccount.creating || !subaccount.accepted}
                >
                  {subaccount.creating ? <span className="spinner" /> : 'Criar minha conta de recebimento'}
                </button>
              </div>

              {/* Quem já tem conta Asaas não consegue virar subconta: o Asaas recusa um
                  documento já cadastrado. Para esses, colar o Wallet ID é o único caminho. */}
              <details style={{ marginTop: 4 }}>
                <summary className="muted" style={{ fontSize: 13, cursor: 'pointer' }}>
                  Já tenho conta no Asaas
                </summary>
                <label className="label settings-module-field" style={{ marginTop: 8 }}>
                  <span>Wallet ID</span>
                  <input
                    className="input"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    value={deposit.walletId}
                    onChange={(event) => setDepositWalletId(event.target.value)}
                    disabled={deposit.saving}
                  />
                </label>
                <p className="muted" style={{ fontSize: 12 }}>
                  No Asaas: menu do usuário → Integrações → copie o Wallet ID. Salve no botão abaixo.
                </p>
              </details>
            </>
          )}
        </section>

        <aside className="settings-module-card settings-module-card--aside">
          <h3>Como funciona</h3>
          <ul className="settings-module-list">
            <li>O cliente gera o PIX durante o agendamento.</li>
            <li>Assim que o pagamento é confirmado, o atendimento fica garantido.</li>
            <li>
              {deposit.splitEnabled
                ? 'O valor cai na sua conta de recebimento, descontada a taxa abaixo.'
                : 'O repasse automático está temporariamente desativado — combine o acerto com o suporte.'}
            </li>
            <li>O Asaas pode pedir documentos para liberar o saque — o dinheiro continua entrando enquanto isso.</li>
          </ul>

          {/* Transparência da taxa. Sem isto, o dono só descobria o desconto comparando os
              números do extrato na mão — e descobrir isso depois de ativar é pior. */}
          {feeCents > 0 ? (
            <div className="settings-module-fee">
              <h4 style={{ margin: '0 0 4px' }}>Quanto você recebe</h4>
              <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
                De cada sinal recebido é descontada uma taxa de processamento de{' '}
                <strong>{brl(feeCents)}</strong>, independente do valor. O restante é repassado a você.
              </p>
              <table className="settings-module-fee__table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', fontWeight: 600 }}>Sinal</th>
                    <th style={{ textAlign: 'right', fontWeight: 600 }}>Você recebe</th>
                  </tr>
                </thead>
                <tbody>
                  {feeExamples.map((cents) => (
                    <tr key={cents}>
                      <td style={{ padding: '2px 0' }}>{brl(cents)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {brl(cents - feeCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                Como a taxa é fixa, ela pesa mais nos sinais baixos: num sinal de{' '}
                {brl(minSignalCents)} ela é {Math.round((feeCents / minSignalCents) * 100)}% do valor.
                Sinais a partir de {brl(2000)} deixam a taxa abaixo de{' '}
                {Math.ceil((feeCents / 2000) * 100)}%.
              </p>
            </div>
          ) : null}

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
                  {walletConfigured
                    ? 'Para exigir sinal, informe o Wallet ID da sua conta Asaas acima.'
                    : 'Para exigir sinal, crie sua conta de recebimento acima.'}
                </span>
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
            <div className="notice notice--info">O sinal (PIX) não está disponível no seu plano atual.</div>
            <Link className="btn btn--outline btn--sm" to="/planos">
              Conhecer planos
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
