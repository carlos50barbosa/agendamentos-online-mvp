-- Migration: fila de handoff humano para bot WhatsApp
SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS wa_handoff_queue (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  from_phone VARCHAR(32) NOT NULL,
  reason VARCHAR(128) NULL,
  status ENUM('open','assigned','closed') NOT NULL DEFAULT 'open',
  assigned_to VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  INDEX idx_wa_handoff_queue_tenant_status (tenant_id, status, created_at),
  INDEX idx_wa_handoff_queue_tenant_phone (tenant_id, from_phone, created_at),
  CONSTRAINT fk_wa_handoff_queue_tenant FOREIGN KEY (tenant_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
