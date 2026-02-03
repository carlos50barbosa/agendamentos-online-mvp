CREATE TABLE IF NOT EXISTS mercadopago_accounts (
  estabelecimento_id INT NOT NULL PRIMARY KEY,
  mp_user_id VARCHAR(64) NULL,
  access_token_enc TEXT NULL,
  refresh_token_enc TEXT NULL,
  token_last4 VARCHAR(4) NULL,
  expires_at DATETIME NULL,
  status ENUM('connected','revoked','error') NOT NULL DEFAULT 'connected',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mp_accounts_user (mp_user_id),
  INDEX idx_mp_accounts_status (status),
  INDEX idx_mp_accounts_expires (expires_at),
  CONSTRAINT fk_mp_accounts_estab FOREIGN KEY (estabelecimento_id)
    REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
