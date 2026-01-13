-- Migration: add WhatsApp contacts tracking (last inbound)
SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  recipient_id VARCHAR(32) PRIMARY KEY,
  cliente_id INT NULL,
  last_inbound_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_whatsapp_contacts_cliente (cliente_id),
  INDEX idx_whatsapp_contacts_last_inbound (last_inbound_at),
  CONSTRAINT fk_whatsapp_contacts_cliente FOREIGN KEY (cliente_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'whatsapp_contacts' AND COLUMN_NAME = 'cliente_id'
  ),
  'SELECT 0',
  'ALTER TABLE whatsapp_contacts ADD COLUMN cliente_id INT NULL AFTER recipient_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'whatsapp_contacts' AND COLUMN_NAME = 'last_inbound_at'
  ),
  'SELECT 0',
  'ALTER TABLE whatsapp_contacts ADD COLUMN last_inbound_at DATETIME NULL AFTER cliente_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'whatsapp_contacts' AND COLUMN_NAME = 'created_at'
  ),
  'SELECT 0',
  'ALTER TABLE whatsapp_contacts ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER last_inbound_at'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'whatsapp_contacts' AND COLUMN_NAME = 'updated_at'
  ),
  'SELECT 0',
  'ALTER TABLE whatsapp_contacts ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'whatsapp_contacts' AND INDEX_NAME = 'idx_whatsapp_contacts_cliente'
  ),
  'SELECT 0',
  'ALTER TABLE whatsapp_contacts ADD INDEX idx_whatsapp_contacts_cliente (cliente_id)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'whatsapp_contacts' AND INDEX_NAME = 'idx_whatsapp_contacts_last_inbound'
  ),
  'SELECT 0',
  'ALTER TABLE whatsapp_contacts ADD INDEX idx_whatsapp_contacts_last_inbound (last_inbound_at)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
