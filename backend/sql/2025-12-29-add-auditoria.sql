-- Migration: add auditoria table
USE agendamentos;

CREATE TABLE IF NOT EXISTS auditoria (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  protocolo VARCHAR(50) NOT NULL,
  acao VARCHAR(30) NOT NULL,
  alvo_email VARCHAR(255),
  executado_por VARCHAR(100),
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
