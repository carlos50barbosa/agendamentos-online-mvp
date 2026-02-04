-- 2026-02-04: garantir tabela appointment_payments (sinal)
USE agendamentos;

CREATE TABLE IF NOT EXISTS appointment_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  agendamento_id INT NOT NULL,
  estabelecimento_id INT NOT NULL,
  type ENUM('deposit') NOT NULL,
  status ENUM('pending','paid','failed','expired','canceled','refunded') NOT NULL DEFAULT 'pending',
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
