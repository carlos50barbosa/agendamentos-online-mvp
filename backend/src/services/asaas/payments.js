// backend/src/services/asaas/payments.js
// Operações de pagamento no Asaas (customers, subscriptions, cobranças PIX).
// Exporta uma fábrica `createAsaasPayments(client)` (injetável em testes) e
// funções default ligadas ao client de config.
import { getAsaasClient, AsaasError } from './client.js';

/** Normaliza Date|string para 'YYYY-MM-DD' (formato exigido pelo Asaas). */
export function toDateOnly(value) {
  if (!value) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

function requireField(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new AsaasError(`Campo obrigatório ausente: ${name}`, { code: 'missing_field' });
  }
  return value;
}

export function createAsaasPayments(client = getAsaasClient()) {
  /**
   * Cria (ou registra) um cliente no Asaas.
   * @returns objeto do cliente; use `.id` como asaas_customer_id (cus_...).
   */
  async function createCustomer({ name, cpfCnpj, email, phone, externalReference } = {}) {
    requireField(name, 'name');
    return client.post('/v3/customers', {
      body: {
        name,
        cpfCnpj: cpfCnpj || undefined,
        email: email || undefined,
        phone: phone || undefined,
        mobilePhone: phone || undefined,
        externalReference: externalReference || undefined,
      },
    });
  }

  /**
   * Atualiza um cliente Asaas existente (POST /v3/customers/{id}). Usado para
   * preencher o cpfCnpj em clientes criados antes sem CPF (senão o Asaas recusa
   * cobranças/assinaturas com "necessário preencher o CPF ou CNPJ do cliente").
   */
  async function updateCustomer(id, { name, cpfCnpj, email, phone } = {}) {
    requireField(id, 'id');
    return client.post(`/v3/customers/${encodeURIComponent(String(id))}`, {
      body: {
        name: name || undefined,
        cpfCnpj: cpfCnpj || undefined,
        email: email || undefined,
        phone: phone || undefined,
        mobilePhone: phone || undefined,
      },
    });
  }

  /**
   * Cria uma assinatura recorrente. Dois usos:
   *
   *  - Plano do TENANT (salão paga a plataforma): billingType UNDEFINED = checkout
   *    hospedado, sem split. O cliente paga a fatura de cada ciclo.
   *  - Plano do CLIENTE (cliente paga o salão): billingType CREDIT_CARD + creditCardToken
   *    (débito automático a cada ciclo, sem atrito) + `split` para a carteira do salão.
   *    O Asaas replica o split em TODA cobrança gerada pela assinatura.
   *
   * `split`: [{ walletId, percentualValue }] ou [{ walletId, fixedValue }].
   * `remoteIp` é EXIGIDO pelo Asaas em cobrança de cartão (antifraude) — é o IP do cliente
   * final, não o do servidor: precisa vir da requisição.
   */
  async function createSubscription({
    customerId,
    value,
    cycle = 'MONTHLY',
    nextDueDate,
    billingType = 'UNDEFINED',
    description,
    externalReference,
    callback,
    split,
    creditCardToken,
    creditCard,
    creditCardHolderInfo,
    remoteIp,
  } = {}) {
    requireField(customerId, 'customerId');
    requireField(value, 'value');

    const type = String(billingType || '').trim().toUpperCase();
    // CREDIT_CARD SEM cartão é válido e é o caminho padrão: medido no sandbox, a assinatura
    // nasce ACTIVE e o Asaas gera a 1ª cobrança com `invoiceUrl` — o cliente digita o cartão
    // LÁ, e o Asaas o guarda para os ciclos seguintes. Assim o cartão nunca passa por aqui.
    //
    // (A Fase 1 exigia o cartão neste ponto. Era uma suposição minha, não uma regra do Asaas,
    // e ela bloqueava justamente o fluxo sem PCI.)
    if (creditCard || creditCardToken) {
      // Com cartão, o antifraude do Asaas exige o IP do CLIENTE. Falhar aqui, e não no
      // gateway: o erro dele para cartão é genérico e o diagnóstico sai caro.
      requireField(remoteIp, 'remoteIp');
    }

    return client.post('/v3/subscriptions', {
      body: {
        customer: customerId,
        billingType: type || 'UNDEFINED',
        value: Number(value),
        cycle,
        nextDueDate: toDateOnly(nextDueDate) || toDateOnly(new Date()),
        description: description || undefined,
        externalReference: externalReference || undefined,
        // Redireciona o cliente de volta ao app após pagar (autoRedirect).
        callback: callback || undefined,
        split: Array.isArray(split) && split.length ? split : undefined,
        creditCardToken: creditCardToken || undefined,
        creditCard: creditCard || undefined,
        creditCardHolderInfo: creditCardHolderInfo || undefined,
        remoteIp: remoteIp || undefined,
      },
    });
  }

  /**
   * Tokeniza um cartão. O token substitui os dados do cartão nas cobranças seguintes —
   * é o que permite renovar o plano do cliente todo mês sem pedir o cartão de novo, e sem
   * a plataforma armazenar nada sensível (o cartão nunca é persistido aqui).
   * @returns { creditCardNumber (4 últimos), creditCardBrand, creditCardToken }
   */
  async function tokenizeCreditCard({ customerId, creditCard, creditCardHolderInfo, remoteIp } = {}) {
    requireField(customerId, 'customerId');
    requireField(creditCard, 'creditCard');
    requireField(creditCardHolderInfo, 'creditCardHolderInfo');
    requireField(remoteIp, 'remoteIp');
    const res = await client.post('/v3/creditCard/tokenize', {
      body: {
        customer: customerId,
        creditCard,
        creditCardHolderInfo,
        remoteIp,
      },
    });
    return {
      creditCardNumber: res?.creditCardNumber || null,
      creditCardBrand: res?.creditCardBrand || null,
      creditCardToken: res?.creditCardToken || null,
    };
  }

  /** Consulta uma assinatura (status, valor, próximo vencimento). */
  async function getSubscription(subscriptionId) {
    requireField(subscriptionId, 'subscriptionId');
    return client.get(`/v3/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }

  /**
   * Atualiza uma assinatura (valor, ciclo, vencimento, split...). `updatePendingPayments`
   * propaga a mudança para as cobranças já geradas e ainda não pagas — sem isso, um upgrade
   * de plano só valeria a partir do ciclo seguinte.
   */
  async function updateSubscription(subscriptionId, {
    value,
    cycle,
    nextDueDate,
    billingType,
    description,
    split,
    status,
    updatePendingPayments,
  } = {}) {
    requireField(subscriptionId, 'subscriptionId');
    return client.post(`/v3/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      body: {
        value: value != null ? Number(value) : undefined,
        cycle: cycle || undefined,
        nextDueDate: toDateOnly(nextDueDate) || undefined,
        billingType: billingType || undefined,
        description: description || undefined,
        split: Array.isArray(split) ? split : undefined,
        status: status || undefined,
        updatePendingPayments: updatePendingPayments != null ? Boolean(updatePendingPayments) : undefined,
      },
    });
  }

  /**
   * Remove a assinatura de vez. Diferente de setSubscriptionStatus('INACTIVE'), que só
   * pausa a geração de cobranças: aqui a assinatura deixa de existir no Asaas. Use no
   * cancelamento pedido pelo cliente.
   */
  async function deleteSubscription(subscriptionId) {
    requireField(subscriptionId, 'subscriptionId');
    return client.delete(`/v3/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }

  /**
   * Lista as cobranças de uma assinatura (o id da 1ª cobrança NÃO volta na
   * criação, por isso é necessário buscar aqui). Retorna o array `data`.
   */
  async function getSubscriptionPayments(subscriptionId) {
    requireField(subscriptionId, 'subscriptionId');
    const res = await client.get(`/v3/subscriptions/${encodeURIComponent(subscriptionId)}/payments`);
    return Array.isArray(res?.data) ? res.data : [];
  }

  /**
   * Suspende (INACTIVE, para de gerar cobranças) ou reativa (ACTIVE) a
   * assinatura. Mapeia suspender/reativar tenant.
   */
  async function setSubscriptionStatus(subscriptionId, status) {
    requireField(subscriptionId, 'subscriptionId');
    const normalized = String(status || '').trim().toUpperCase();
    if (normalized !== 'ACTIVE' && normalized !== 'INACTIVE') {
      throw new AsaasError(`Status de assinatura inválido: ${status} (use ACTIVE|INACTIVE)`, { code: 'invalid_status' });
    }
    return client.post(`/v3/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      body: { status: normalized },
    });
  }

  /**
   * Busca um cliente Asaas por CPF/CNPJ (dedupe antes de criar).
   * @returns o 1º cliente encontrado ou null.
   */
  async function getCustomerByCpfCnpj(cpfCnpj) {
    const doc = String(cpfCnpj || '').replace(/\D/g, '');
    if (!doc) return null;
    const res = await client.get('/v3/customers', { query: { cpfCnpj: doc } });
    const list = Array.isArray(res?.data) ? res.data : [];
    return list[0] || null;
  }

  /**
   * Cria uma cobrança avulsa PIX (o sinal do agendamento).
   * `split` (array de { walletId, fixedValue }) repassa o valor ao estabelecimento.
   * Omitido no modelo de conta única sem split.
   */
  async function createPixCharge({ customerId, value, dueDate, description, externalReference, split } = {}) {
    requireField(customerId, 'customerId');
    requireField(value, 'value');
    return client.post('/v3/payments', {
      body: {
        customer: customerId,
        billingType: 'PIX',
        value: Number(value),
        dueDate: toDateOnly(dueDate) || toDateOnly(new Date()),
        description: description || undefined,
        externalReference: externalReference || undefined,
        split: Array.isArray(split) && split.length ? split : undefined,
      },
    });
  }

  /** Retorna o QR PIX de uma cobrança: { encodedImage, payload, expirationDate }. */
  async function getPixQrCode(paymentId) {
    requireField(paymentId, 'paymentId');
    const res = await client.get(`/v3/payments/${encodeURIComponent(paymentId)}/pixQrCode`);
    return {
      encodedImage: res?.encodedImage || null,
      payload: res?.payload || null,
      expirationDate: res?.expirationDate || null,
    };
  }

  /** Consulta uma cobrança (usado na revalidação antes de expirar). */
  async function getPayment(paymentId) {
    requireField(paymentId, 'paymentId');
    return client.get(`/v3/payments/${encodeURIComponent(paymentId)}`);
  }

  /** Remove uma cobrança pendente (evita pagamento tardio após a expiração). */
  async function deletePayment(paymentId) {
    requireField(paymentId, 'paymentId');
    return client.delete(`/v3/payments/${encodeURIComponent(paymentId)}`);
  }

  /**
   * Estorna uma cobrança recebida. Sem `value` = estorno total (também reverte o
   * split automaticamente). Com `value` (reais) = estorno parcial.
   */
  async function refundPayment(paymentId, { value, description } = {}) {
    requireField(paymentId, 'paymentId');
    return client.post(`/v3/payments/${encodeURIComponent(paymentId)}/refund`, {
      body: {
        value: value != null ? Number(value) : undefined,
        description: description || undefined,
      },
    });
  }

  return {
    createCustomer,
    updateCustomer,
    getCustomerByCpfCnpj,
    createSubscription,
    getSubscription,
    updateSubscription,
    deleteSubscription,
    getSubscriptionPayments,
    setSubscriptionStatus,
    tokenizeCreditCard,
    createPixCharge,
    getPixQrCode,
    getPayment,
    deletePayment,
    refundPayment,
  };
}

// Instância default ligada ao client de config.
const defaultPayments = createAsaasPayments();
export const {
  createCustomer,
  updateCustomer,
  getCustomerByCpfCnpj,
  createSubscription,
  getSubscription,
  updateSubscription,
  deleteSubscription,
  getSubscriptionPayments,
  setSubscriptionStatus,
  tokenizeCreditCard,
  createPixCharge,
  getPixQrCode,
  getPayment,
  deletePayment,
  refundPayment,
} = defaultPayments;

export default defaultPayments;
