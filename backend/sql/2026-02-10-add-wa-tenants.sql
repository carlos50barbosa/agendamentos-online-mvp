-- Migration: add WhatsApp Cloud API tenant accounts + message logs
SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS wa_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  waba_id VARCHAR(64) NULL,
  phone_number_id VARCHAR(64) NOT NULL,
  display_phone_number VARCHAR(32) NULL,
  business_id VARCHAR(64) NULL,
  access_token_enc TEXT NULL,
  token_last4 VARCHAR(4) NULL,
  status ENUM('connected','disconnected') NOT NULL DEFAULT 'connected',
  connected_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wa_accounts_estabelecimento (estabelecimento_id),
  UNIQUE KEY uk_wa_accounts_phone (phone_number_id),
  INDEX idx_wa_accounts_status (status),
  CONSTRAINT fk_wa_accounts_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS wa_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  direction ENUM('in','out') NOT NULL,
  wa_id VARCHAR(64) NULL,
  wamid VARCHAR(128) NULL,
  phone_number_id VARCHAR(64) NULL,
  payload_json LONGTEXT NULL,
  status VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wa_messages_phone (phone_number_id),
  INDEX idx_wa_messages_estab (estabelecimento_id),
  INDEX idx_wa_messages_wamid (wamid),
  CONSTRAINT fk_wa_messages_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Lookup por phone_number_id
-- SELECT * FROM wa_accounts WHERE phone_number_id='PHONE_ID' LIMIT 1;
-- Desconectar estabelecimento
-- UPDATE wa_accounts SET status='disconnected', access_token_enc=NULL, token_last4=NULL WHERE estabelecimento_id=123;
