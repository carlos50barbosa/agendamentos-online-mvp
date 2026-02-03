-- 2026-02-12: sinal (adiantamento) para agendamentos
USE agendamentos;

CREATE TABLE IF NOT EXISTS establishment_settings (
  estabelecimento_id INT NOT NULL PRIMARY KEY,
  deposit_enabled TINYINT(1) NOT NULL DEFAULT 0,
  deposit_percent INT NULL,
  deposit_hold_minutes INT NOT NULL DEFAULT 15,
  CONSTRAINT fk_establishment_settings_estab FOREIGN KEY (estabelecimento_id)
    REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS appointment_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  agendamento_id INT NOT NULL,
  estabelecimento_id INT NOT NULL,
  type ENUM('deposit') NOT NULL,
  status ENUM('pending','paid','expired','canceled','refunded','failed') NOT NULL DEFAULT 'pending',
  amount_centavos INT NOT NULL,
  percent INT NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'mercadopago',
  provider_payment_id VARCHAR(64) NULL,
  provider_reference VARCHAR(64) NULL,
  expires_at DATETIME NOT NULL,
  paid_at DATETIME NULL,
  raw_payload LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_appointment_payments_agendamento (agendamento_id),
  INDEX idx_appointment_payments_provider (provider, provider_payment_id),
  INDEX idx_appointment_payments_status_expires (status, expires_at),
  CONSTRAINT fk_appointment_payments_agendamento FOREIGN KEY (agendamento_id)
    REFERENCES agendamentos(id) ON DELETE CASCADE,
  CONSTRAINT fk_appointment_payments_estabelecimento FOREIGN KEY (estabelecimento_id)
    REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE agendamentos
  MODIFY COLUMN status ENUM('confirmado','pendente','pendente_pagamento','cancelado','concluido') NOT NULL DEFAULT 'confirmado',
  ADD COLUMN total_centavos INT NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN deposit_required TINYINT(1) NOT NULL DEFAULT 0 AFTER total_centavos,
  ADD COLUMN deposit_percent INT NULL AFTER deposit_required,
  ADD COLUMN deposit_centavos INT NULL AFTER deposit_percent,
  ADD COLUMN deposit_expires_at DATETIME NULL AFTER deposit_centavos,
  ADD COLUMN deposit_paid_at DATETIME NULL AFTER deposit_expires_at;
