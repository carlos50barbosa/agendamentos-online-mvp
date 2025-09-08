-- ===============================================
-- ESQUEMA COMPLETO (criação do zero)
-- ===============================================

-- Criar DB
CREATE DATABASE IF NOT EXISTS agendamentos
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;

USE agendamentos;

-- Usuários (clientes e estabelecimentos)
CREATE TABLE IF NOT EXISTS usuarios (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  nome         VARCHAR(120)          NOT NULL,
  email        VARCHAR(160)          NOT NULL UNIQUE,
  telefone     VARCHAR(20)           NULL,         -- (NOVO) usado para WhatsApp
  senha_hash   VARCHAR(200)          NOT NULL,
  tipo         ENUM('cliente','estabelecimento') NOT NULL,
  criado_em    TIMESTAMP             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_usuarios_tipo (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Tokens de redefinição de senha (invalidação pós-uso)
CREATE TABLE IF NOT EXISTS password_resets (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT              NOT NULL,
  jti          VARCHAR(64)      NOT NULL UNIQUE,
  expires_at   DATETIME         NOT NULL,
  used_at      DATETIME         NULL,
  created_at   TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pwdreset_user FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_pwdreset_user (user_id),
  INDEX idx_pwdreset_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Serviços (somente estabelecimento)
CREATE TABLE IF NOT EXISTS servicos (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT              NOT NULL,
  nome               VARCHAR(120)     NOT NULL,
  duracao_min        INT              NOT NULL,
  preco_centavos     INT              DEFAULT 0,
  ativo              TINYINT(1)       DEFAULT 1,
  CONSTRAINT fk_serv_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_servicos_estab_ativo (estabelecimento_id, ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Agendamentos
CREATE TABLE IF NOT EXISTS agendamentos (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id         INT          NOT NULL,
  estabelecimento_id INT          NOT NULL,
  servico_id         INT          NOT NULL,
  inicio             DATETIME     NOT NULL,
  fim                DATETIME     NOT NULL,
  status             ENUM('confirmado','cancelado') NOT NULL DEFAULT 'confirmado',
  -- (NOVO) opcional: armazenar IDs dos jobs de lembrete do WhatsApp (1 dia / 15 min)
  wa_job_1d_id       VARCHAR(120) NULL,
  wa_job_15m_id      VARCHAR(120) NULL,
  criado_em          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_ag_cli   FOREIGN KEY (cliente_id)         REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_ag_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_ag_srv   FOREIGN KEY (servico_id)         REFERENCES servicos(id) ON DELETE CASCADE,

  -- índices úteis para consultas
  INDEX idx_ag_estab_inicio (estabelecimento_id, inicio),
  INDEX idx_ag_cliente_inicio (cliente_id, inicio),
  INDEX idx_ag_estab_status_inicio (estabelecimento_id, status, inicio),
  INDEX idx_ag_cliente_status_inicio (cliente_id, status, inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Bloqueios de horários (slots indisponíveis)
CREATE TABLE IF NOT EXISTS bloqueios (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT          NOT NULL,
  inicio             DATETIME     NOT NULL,
  fim                DATETIME     NOT NULL,
  CONSTRAINT fk_blk_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_blk_estab_inicio (estabelecimento_id, inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
