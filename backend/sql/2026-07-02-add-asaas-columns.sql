-- 2026-07-02: suporte ao Asaas (migração gradual do Mercado Pago).
-- Estratégia: REUSAR as colunas gateway-agnósticas já existentes, setando o
-- gateway/provider = 'asaas'. As linhas do Mercado Pago (gateway='mercadopago')
-- permanecem intactas ao lado durante a transição.
--   * subscriptions.gateway / gateway_subscription_id / gateway_customer_id / external_reference  (reuso)
--   * appointment_payments.provider / provider_payment_id / provider_reference                    (reuso)
-- Aqui só adicionamos o que não existe:
--   1) usuarios.asaas_customer_id  (id do cliente Asaas — conta única da plataforma;
--      serve tanto para o tenant-como-cliente quanto para o cliente final do sinal)
--   2) asaas_webhook_events        (idempotência do webhook único — entrega at least once)
USE agendamentos;

ALTER TABLE usuarios
  ADD COLUMN asaas_customer_id VARCHAR(64) NULL AFTER id;

CREATE TABLE IF NOT EXISTS asaas_webhook_events (
  id VARCHAR(64) NOT NULL PRIMARY KEY,        -- id do evento Asaas (evt_...) — dedupe
  event VARCHAR(64) NOT NULL,                 -- ex.: PAYMENT_RECEIVED, PAYMENT_OVERDUE
  payment_id VARCHAR(64) NULL,                -- id da cobrança (pay_...)
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_asaas_webhook_events_payment (payment_id),
  INDEX idx_asaas_webhook_events_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
