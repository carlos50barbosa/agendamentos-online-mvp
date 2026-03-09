-- Migration: motor conversacional WhatsApp (Fase 1/2)
SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS wa_inbound_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  from_phone VARCHAR(32) NOT NULL,
  message_id VARCHAR(191) NOT NULL,
  type VARCHAR(64) NULL,
  payload_json LONGTEXT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'new',
  error TEXT NULL,
  UNIQUE KEY uk_wa_inbound_events_tenant_message (tenant_id, message_id),
  INDEX idx_wa_inbound_events_tenant_phone (tenant_id, from_phone),
  INDEX idx_wa_inbound_events_status (status, received_at),
  CONSTRAINT fk_wa_inbound_events_tenant FOREIGN KEY (tenant_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Compatibilidade com versões antigas que criaram wa_sessions (phone,state) via runtime.
SET @legacy_wa_sessions := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'wa_sessions'
    AND COLUMN_NAME = 'phone'
);
SET @new_wa_sessions := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'wa_sessions'
    AND COLUMN_NAME = 'tenant_id'
);
SET @drop_legacy_sql := IF(@legacy_wa_sessions > 0 AND @new_wa_sessions = 0, 'DROP TABLE wa_sessions', 'SELECT 1');
PREPARE stmt_drop_legacy FROM @drop_legacy_sql;
EXECUTE stmt_drop_legacy;
DEALLOCATE PREPARE stmt_drop_legacy;

CREATE TABLE IF NOT EXISTS wa_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  from_phone VARCHAR(32) NOT NULL,
  state VARCHAR(64) NOT NULL,
  context_json LONGTEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  UNIQUE KEY uk_wa_sessions_tenant_phone (tenant_id, from_phone),
  INDEX idx_wa_sessions_expires (expires_at),
  CONSTRAINT fk_wa_sessions_tenant FOREIGN KEY (tenant_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS wa_conversation_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  from_phone VARCHAR(32) NOT NULL,
  message_id VARCHAR(191) NULL,
  intent VARCHAR(64) NULL,
  prev_state VARCHAR(64) NULL,
  next_state VARCHAR(64) NULL,
  action VARCHAR(64) NULL,
  endpoint_called VARCHAR(255) NULL,
  endpoint_result LONGTEXT NULL,
  reply_type VARCHAR(32) NOT NULL DEFAULT 'text',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wa_conversation_logs_tenant_phone_created (tenant_id, from_phone, created_at),
  CONSTRAINT fk_wa_conversation_logs_tenant FOREIGN KEY (tenant_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
