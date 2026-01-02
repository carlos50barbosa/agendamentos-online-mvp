-- Migration: add WhatsApp wallet (mensagens) + limite por agendamento
SET @db := DATABASE();

-- 1) Contador de mensagens WhatsApp por agendamento (limite: 5)
SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'agendamentos' AND COLUMN_NAME = 'wa_messages_sent'
  ),
  'SELECT 0',
  'ALTER TABLE agendamentos ADD COLUMN wa_messages_sent INT NOT NULL DEFAULT 0 AFTER cliente_confirmou_whatsapp_at'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Wallet de mensagens por estabelecimento (ciclo mensal: por mes corrente)
CREATE TABLE IF NOT EXISTS whatsapp_wallets (
  estabelecimento_id INT NOT NULL PRIMARY KEY,
  cycle_start DATETIME NOT NULL,
  cycle_end   DATETIME NOT NULL,
  included_limit   INT NOT NULL DEFAULT 0,
  included_balance INT NOT NULL DEFAULT 0,
  extra_balance    INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_whatsapp_wallets_cycle (cycle_start, cycle_end),
  CONSTRAINT fk_whatsapp_wallets_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Backward compat: se a tabela ja existia (ambiente antigo), adiciona included_limit
SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'whatsapp_wallets' AND COLUMN_NAME = 'included_limit'
  ),
  'SELECT 0',
  'ALTER TABLE whatsapp_wallets ADD COLUMN included_limit INT NOT NULL DEFAULT 0 AFTER cycle_end'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) Ledger/auditoria (creditos, debitos e bloqueios) para idempotencia e diagnostico
CREATE TABLE IF NOT EXISTS whatsapp_wallet_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  kind ENUM('cycle_reset','topup_credit','debit','blocked') NOT NULL,
  delta INT NOT NULL DEFAULT 0,                 -- +msgs (credit), -1 (debit), 0 (blocked)
  included_delta INT NOT NULL DEFAULT 0,        -- -1 quando consumiu da franquia do plano
  extra_delta    INT NOT NULL DEFAULT 0,        -- +msgs em topup; -1 quando consumiu do extra
  cycle_start DATETIME NULL,
  cycle_end   DATETIME NULL,
  agendamento_id INT NULL,
  subscription_id INT NULL,
  payment_id VARCHAR(80) NULL,                 -- Mercado Pago payment.id
  provider_message_id VARCHAR(191) NULL,       -- Graph API message id (deduz apenas uma vez)
  reason VARCHAR(80) NULL,                     -- ex: insufficient_balance, per_appointment_limit
  metadata LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wa_tx_estab_created (estabelecimento_id, created_at),
  INDEX idx_wa_tx_agendamento (agendamento_id, created_at),
  INDEX idx_wa_tx_payment (payment_id),
  INDEX idx_wa_tx_subscription (subscription_id),
  INDEX idx_wa_tx_provider_msg (provider_message_id),
  UNIQUE KEY uk_wa_tx_provider_msg (provider_message_id),
  UNIQUE KEY uk_wa_tx_kind_payment (kind, payment_id),
  UNIQUE KEY uk_wa_tx_kind_cycle (kind, estabelecimento_id, cycle_start),
  CONSTRAINT fk_wa_tx_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_wa_tx_agendamento FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE SET NULL,
  CONSTRAINT fk_wa_tx_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 4) Index para facilitar idempotencia em webhooks (sem impor UNIQUE em dados antigos)
SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'subscription_events' AND INDEX_NAME = 'idx_subscription_events_event'
  ),
  'SELECT 0',
  'ALTER TABLE subscription_events ADD INDEX idx_subscription_events_event (event_type, gateway_event_id)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
