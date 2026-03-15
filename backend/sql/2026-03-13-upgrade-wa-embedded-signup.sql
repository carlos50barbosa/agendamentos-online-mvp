-- Migration: evolve wa_accounts for Meta Embedded Signup / Facebook Login for Business

CREATE TABLE IF NOT EXISTS wa_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'meta_cloud',
  waba_id VARCHAR(64) NULL,
  phone_number_id VARCHAR(64) NULL,
  display_phone_number VARCHAR(32) NULL,
  verified_name VARCHAR(255) NULL,
  business_id VARCHAR(64) NULL,
  access_token_enc TEXT NULL,
  token_last4 VARCHAR(4) NULL,
  status ENUM('connected','disconnected','error','connecting') NOT NULL DEFAULT 'disconnected',
  connected_at DATETIME NULL,
  disconnected_at DATETIME NULL,
  token_last_validated_at DATETIME NULL,
  last_sync_at DATETIME NULL,
  last_error VARCHAR(255) NULL,
  metadata_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wa_accounts_estabelecimento (estabelecimento_id),
  UNIQUE KEY uk_wa_accounts_phone (phone_number_id),
  INDEX idx_wa_accounts_status (status),
  INDEX idx_wa_accounts_provider (provider),
  INDEX idx_wa_accounts_last_sync (last_sync_at),
  CONSTRAINT fk_wa_accounts_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE wa_accounts
  MODIFY COLUMN phone_number_id VARCHAR(64) NULL,
  MODIFY COLUMN status ENUM('connected','disconnected','error','connecting') NOT NULL DEFAULT 'disconnected';

ALTER TABLE wa_accounts ADD COLUMN IF NOT EXISTS provider VARCHAR(32) NOT NULL DEFAULT 'meta_cloud' AFTER estabelecimento_id;
ALTER TABLE wa_accounts ADD COLUMN IF NOT EXISTS verified_name VARCHAR(255) NULL AFTER display_phone_number;
ALTER TABLE wa_accounts ADD COLUMN IF NOT EXISTS disconnected_at DATETIME NULL AFTER connected_at;
ALTER TABLE wa_accounts ADD COLUMN IF NOT EXISTS token_last_validated_at DATETIME NULL AFTER disconnected_at;
ALTER TABLE wa_accounts ADD COLUMN IF NOT EXISTS last_sync_at DATETIME NULL AFTER token_last_validated_at;
ALTER TABLE wa_accounts ADD COLUMN IF NOT EXISTS last_error VARCHAR(255) NULL AFTER last_sync_at;
ALTER TABLE wa_accounts ADD COLUMN IF NOT EXISTS metadata_json LONGTEXT NULL AFTER last_error;
ALTER TABLE wa_accounts ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER metadata_json;

UPDATE wa_accounts
   SET provider='meta_cloud'
 WHERE provider IS NULL OR provider='';

UPDATE wa_accounts
   SET last_sync_at=COALESCE(last_sync_at, connected_at, updated_at, NOW())
 WHERE last_sync_at IS NULL;

UPDATE wa_accounts
   SET created_at=COALESCE(created_at, connected_at, updated_at, NOW())
 WHERE created_at IS NULL;
