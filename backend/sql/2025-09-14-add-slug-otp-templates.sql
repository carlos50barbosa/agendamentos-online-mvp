-- Migration: add slug to usuarios, add otp_codes and estab_messages
USE agendamentos;

-- 1) Slug em usuarios (único, opcional no começo)
ALTER TABLE usuarios
  ADD COLUMN slug VARCHAR(160) NULL AFTER nome,
  ADD UNIQUE KEY uq_usuarios_slug (slug);

-- Backfill inicial simples (evita NULL) para estabelecimentos sem slug
UPDATE usuarios SET slug = CONCAT('estab-', id)
 WHERE tipo='estabelecimento' AND (slug IS NULL OR slug='');

-- 2) OTP codes para verificação pública
CREATE TABLE IF NOT EXISTS otp_codes (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  request_id   VARCHAR(64)   NOT NULL UNIQUE,
  channel      ENUM('email','phone') NOT NULL,
  value        VARCHAR(160)  NOT NULL,
  code_hash    VARCHAR(200)  NOT NULL,
  expires_at   DATETIME      NOT NULL,
  used_at      DATETIME      NULL,
  attempts     INT           NOT NULL DEFAULT 0,
  ip_addr      VARCHAR(64)   NULL,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_channel_value (channel, value),
  INDEX idx_otp_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 3) Templates por estabelecimento
CREATE TABLE IF NOT EXISTS estab_messages (
  estabelecimento_id INT       NOT NULL PRIMARY KEY,
  email_subject      VARCHAR(200) NULL,
  email_html         TEXT         NULL,
  wa_template        TEXT         NULL,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_msg_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

