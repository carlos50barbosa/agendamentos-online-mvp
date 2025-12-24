-- ===============================================
-- ESQUEMA COMPLETO (criacao do zero)
-- ===============================================

-- Criar DB
CREATE DATABASE IF NOT EXISTS agendamentos
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;

USE agendamentos;

-- Usuarios (clientes e estabelecimentos)
CREATE TABLE IF NOT EXISTS usuarios (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  nome         VARCHAR(120)          NOT NULL,
  email        VARCHAR(160)          NOT NULL UNIQUE,
  telefone     VARCHAR(20)           NULL,         -- usado para WhatsApp
  notify_email_estab    TINYINT(1)   NOT NULL DEFAULT 1,
  notify_whatsapp_estab TINYINT(1)   NOT NULL DEFAULT 1,
  cep          VARCHAR(8)            NULL,
  endereco     VARCHAR(255)          NULL,
  numero       VARCHAR(20)           NULL,
  complemento  VARCHAR(120)          NULL,
  bairro       VARCHAR(120)          NULL,
  cidade       VARCHAR(120)          NULL,
  estado       CHAR(2)               NULL,
  senha_hash   VARCHAR(200)          NOT NULL,
  tipo         ENUM('cliente','estabelecimento') NOT NULL,
  plan         ENUM('starter','pro','premium') NOT NULL DEFAULT 'starter',
  plan_status  ENUM('trialing','active','delinquent') NOT NULL DEFAULT 'trialing',
  plan_cycle   ENUM('mensal','anual') NOT NULL DEFAULT 'mensal',
  plan_trial_ends_at DATETIME       NULL,
  plan_active_until DATETIME       NULL,
  plan_subscription_id VARCHAR(80) NULL,
  criado_em    TIMESTAMP             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_usuarios_tipo (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Tokens de redefinicao de senha (invalidacao pos-uso)
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

-- Servicos (somente estabelecimento)
CREATE TABLE IF NOT EXISTS servicos (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT              NOT NULL,
  nome               VARCHAR(120)     NOT NULL,
  descricao          TEXT             NULL,
  imagem_url         VARCHAR(255)     NULL,
  duracao_min        INT              NOT NULL,
  preco_centavos     INT              DEFAULT 0,
  ativo              TINYINT(1)       DEFAULT 1,
  CONSTRAINT fk_serv_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_servicos_estab_ativo (estabelecimento_id, ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Profissionais
CREATE TABLE IF NOT EXISTS profissionais (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT          NOT NULL,
  nome               VARCHAR(120) NOT NULL,
  descricao          TEXT         NULL,
  avatar_url         VARCHAR(255) NULL,
  ativo              TINYINT(1)   NOT NULL DEFAULT 1,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_profissionais_estab (estabelecimento_id),
  CONSTRAINT fk_profissionais_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Relacao servico x profissionais
CREATE TABLE IF NOT EXISTS servico_profissionais (
  servico_id       INT NOT NULL,
  profissional_id  INT NOT NULL,
  PRIMARY KEY (servico_id, profissional_id),
  INDEX idx_servico_prof_prof (profissional_id),
  CONSTRAINT fk_servico_prof_servico FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE,
  CONSTRAINT fk_servico_prof_prof   FOREIGN KEY (profissional_id) REFERENCES profissionais(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Agendamentos
CREATE TABLE IF NOT EXISTS agendamentos (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id         INT          NOT NULL,
  estabelecimento_id INT          NOT NULL,
  servico_id         INT          NOT NULL,
  profissional_id    INT          NULL,
  inicio             DATETIME     NOT NULL,
  fim                DATETIME     NOT NULL,
  status             ENUM('confirmado','cancelado') NOT NULL DEFAULT 'confirmado',
  -- (NOVO) opcional: armazenar IDs dos jobs de lembrete do WhatsApp (1 dia / 15 min)
  wa_job_1d_id       VARCHAR(120) NULL,
  wa_job_15m_id      VARCHAR(120) NULL,
  -- (NOVO) marca quando o lembrete de 8h foi enviado (evita duplicidade e permite reprocessar apos reboot)
  reminder_8h_sent_at DATETIME    NULL,
  reminder_8h_msg_id  VARCHAR(191) NULL,
  -- Lembrete de 5h para o estabelecimento (WhatsApp/email)
  estab_reminder_5h_sent_at DATETIME NULL,
  estab_reminder_5h_msg_id  VARCHAR(191) NULL,
  cliente_confirmou_whatsapp_at DATETIME NULL,
  criado_em          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_ag_cli   FOREIGN KEY (cliente_id)         REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_ag_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_ag_srv   FOREIGN KEY (servico_id)         REFERENCES servicos(id) ON DELETE CASCADE,
  CONSTRAINT fk_ag_prof  FOREIGN KEY (profissional_id)    REFERENCES profissionais(id) ON DELETE SET NULL,

  -- indices uteis para consultas
  INDEX idx_ag_estab_inicio (estabelecimento_id, inicio),
  INDEX idx_ag_cliente_inicio (cliente_id, inicio),
  INDEX idx_ag_estab_status_inicio (estabelecimento_id, status, inicio),
  INDEX idx_ag_cliente_status_inicio (cliente_id, status, inicio),
  INDEX idx_ag_confirm_wa (cliente_confirmou_whatsapp_at),
  INDEX idx_ag_reminder_estab_5h (estab_reminder_5h_sent_at, inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Bloqueios de horarios (slots indisponiveis)
CREATE TABLE IF NOT EXISTS bloqueios (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT          NOT NULL,
  inicio             DATETIME     NOT NULL,
  fim                DATETIME     NOT NULL,
  CONSTRAINT fk_blk_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_blk_estab_inicio (estabelecimento_id, inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS email_change_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  new_email VARCHAR(190) NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_email_change_user (user_id),
  KEY idx_email_change_expires (expires_at),
  CONSTRAINT fk_email_change_user FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS estabelecimento_perfis (
  estabelecimento_id INT PRIMARY KEY,
  sobre TEXT NULL,
  contato_email VARCHAR(160) NULL,
  contato_telefone VARCHAR(20) NULL,
  site_url VARCHAR(255) NULL,
  instagram_url VARCHAR(255) NULL,
  facebook_url VARCHAR(255) NULL,
  linkedin_url VARCHAR(255) NULL,
  youtube_url VARCHAR(255) NULL,
  tiktok_url VARCHAR(255) NULL,
  horarios_json TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_estab_perfil_estabelecimento FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS estabelecimento_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  cliente_id INT NOT NULL,
  nota TINYINT NOT NULL,
  comentario TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_estab_review (estabelecimento_id, cliente_id),
  INDEX idx_reviews_estab (estabelecimento_id),
  INDEX idx_reviews_cliente (cliente_id),
  CONSTRAINT fk_reviews_estabelecimento FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_cliente FOREIGN KEY (cliente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT chk_reviews_nota CHECK (nota BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS cliente_favoritos (
  cliente_id INT NOT NULL,
  estabelecimento_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cliente_id, estabelecimento_id),
  INDEX idx_favoritos_estab (estabelecimento_id),
  CONSTRAINT fk_favoritos_cliente FOREIGN KEY (cliente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_favoritos_estabelecimento FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS estabelecimento_imagens (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  titulo VARCHAR(120) NULL,
  descricao VARCHAR(255) NULL,
  ordem INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_est_imagens_estab (estabelecimento_id),
  CONSTRAINT fk_estab_imagem_estabelecimento FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS billing_payment_reminders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  due_date DATETIME NOT NULL,
  reminder_kind ENUM('due_soon','overdue_grace','blocked') NOT NULL,
  channel ENUM('email','whatsapp') NOT NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_reminder (estabelecimento_id, due_date, reminder_kind, channel),
  KEY idx_reminder_due (due_date),
  CONSTRAINT fk_billing_reminder_estab FOREIGN KEY (estabelecimento_id)
    REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
