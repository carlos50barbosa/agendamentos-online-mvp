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

  /** Cria uma assinatura recorrente (plano do tenant). */
  async function createSubscription({
    customerId,
    value,
    cycle = 'MONTHLY',
    nextDueDate,
    billingType = 'UNDEFINED',
    description,
    externalReference,
  } = {}) {
    requireField(customerId, 'customerId');
    requireField(value, 'value');
    return client.post('/v3/subscriptions', {
      body: {
        customer: customerId,
        billingType,
        value: Number(value),
        cycle,
        nextDueDate: toDateOnly(nextDueDate) || toDateOnly(new Date()),
        description: description || undefined,
        externalReference: externalReference || undefined,
      },
    });
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
   * Cria uma cobrança avulsa PIX (o sinal do agendamento).
   * `split` é opcional (evolução futura: subconta/split por estabelecimento);
   * no modelo atual (conta única da plataforma) fica indefinido.
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

  return {
    createCustomer,
    createSubscription,
    getSubscriptionPayments,
    setSubscriptionStatus,
    createPixCharge,
    getPixQrCode,
  };
}

// Instância default ligada ao client de config.
const defaultPayments = createAsaasPayments();
export const {
  createCustomer,
  createSubscription,
  getSubscriptionPayments,
  setSubscriptionStatus,
  createPixCharge,
  getPixQrCode,
} = defaultPayments;

export default defaultPayments;
