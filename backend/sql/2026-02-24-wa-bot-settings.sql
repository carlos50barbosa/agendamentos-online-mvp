-- Migration: tenant settings + outbox para bot WhatsApp
SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS wa_bot_settings (
  tenant_id INT NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  mode ENUM('bot_only','hybrid','human_only') NOT NULL DEFAULT 'hybrid',
  rollout_percent INT NOT NULL DEFAULT 0,
  kill_switch TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_wa_bot_settings_tenant FOREIGN KEY (tenant_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT chk_wa_bot_settings_rollout CHECK (rollout_percent >= 0 AND rollout_percent <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  to_phone VARCHAR(32) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  payload_json LONGTEXT NULL,
  status ENUM('pending','sent','error') NOT NULL DEFAULT 'pending',
  provider_message_id VARCHAR(191) NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  INDEX idx_whatsapp_outbox_tenant_status (tenant_id, status, created_at),
  INDEX idx_whatsapp_outbox_phone_created (to_phone, created_at),
  CONSTRAINT fk_whatsapp_outbox_tenant FOREIGN KEY (tenant_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
