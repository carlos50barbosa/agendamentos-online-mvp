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
  data_nascimento DATE               NULL,
  cpf_cnpj     VARCHAR(20)           NULL,
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
  plan_status  ENUM('trialing','active','pending_payment','pending_pix','past_due','unpaid','expired','canceled') NOT NULL DEFAULT 'trialing',
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
  capacidade_por_horario INT          NOT NULL DEFAULT 1,
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
  status             ENUM('confirmado','pendente','pendente_pagamento','cancelado','concluido') NOT NULL DEFAULT 'confirmado',
  total_centavos     INT NOT NULL DEFAULT 0,
  deposit_required   TINYINT(1)   NOT NULL DEFAULT 0,
  deposit_percent    INT          NULL,
  deposit_centavos   INT          NULL,
  deposit_expires_at DATETIME     NULL,
  deposit_paid_at    DATETIME     NULL,
  no_show            TINYINT(1)   NOT NULL DEFAULT 0,
  origem             VARCHAR(32)  NULL,
  public_confirm_token_hash VARCHAR(64) NULL,
  public_confirm_expires_at DATETIME    NULL,
  public_confirmed_at DATETIME          NULL,
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
  loyalty_subscription_id BIGINT NULL,
  loyalty_credit_applied TINYINT(1) NOT NULL DEFAULT 0,
  loyalty_discount_percent DECIMAL(5,2) NULL,
  loyalty_benefit_snapshot_json LONGTEXT NULL,
  criado_em          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_ag_cli   FOREIGN KEY (cliente_id)         REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_ag_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_ag_srv   FOREIGN KEY (servico_id)         REFERENCES servicos(id) ON DELETE CASCADE,
  CONSTRAINT fk_ag_prof  FOREIGN KEY (profissional_id)    REFERENCES profissionais(id) ON DELETE SET NULL,

  -- indices uteis para consultas
  INDEX idx_ag_estab_inicio (estabelecimento_id, inicio),
  INDEX idx_ag_estab_inicio_status (estabelecimento_id, inicio, status),
  INDEX idx_ag_estab_criado (estabelecimento_id, criado_em),
  INDEX idx_ag_estab_cliente_inicio (estabelecimento_id, cliente_id, inicio),
  INDEX idx_ag_estab_prof_inicio (estabelecimento_id, profissional_id, inicio),
  INDEX idx_ag_estab_origem_inicio (estabelecimento_id, origem, inicio),
  INDEX idx_ag_cliente_inicio (cliente_id, inicio),
  INDEX idx_ag_estab_status_inicio (estabelecimento_id, status, inicio),
  INDEX idx_ag_capacity_lookup (estabelecimento_id, servico_id, profissional_id, inicio, status),
  INDEX idx_ag_cliente_status_inicio (cliente_id, status, inicio),
  INDEX idx_ag_confirm_wa (cliente_confirmou_whatsapp_at),
  INDEX idx_ag_public_confirm_expires (public_confirm_expires_at),
  INDEX idx_ag_reminder_estab_5h (estab_reminder_5h_sent_at, inicio),
  INDEX idx_ag_loyalty_subscription (loyalty_subscription_id),
  INDEX idx_ag_loyalty_credit_applied (loyalty_credit_applied),
  CONSTRAINT fk_ag_loyalty_subscription FOREIGN KEY (loyalty_subscription_id) REFERENCES client_loyalty_subscriptions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

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
  CONSTRAINT fk_appointment_payments_agendamento FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE,
  CONSTRAINT fk_appointment_payments_estabelecimento FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

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

CREATE TABLE IF NOT EXISTS establishment_mp_accounts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  mp_user_id VARCHAR(64) NULL,
  mp_collector_id VARCHAR(64) NULL,
  access_token_encrypted LONGTEXT NULL,
  refresh_token_encrypted LONGTEXT NULL,
  public_key VARCHAR(128) NULL,
  token_last4 VARCHAR(4) NULL,
  token_expires_at DATETIME NULL,
  scope VARCHAR(255) NULL,
  status ENUM('connected','expired','revoked','error') NOT NULL DEFAULT 'connected',
  raw_oauth_metadata LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_establishment_mp_accounts_estab (estabelecimento_id),
  UNIQUE KEY uk_establishment_mp_accounts_user (mp_user_id),
  INDEX idx_establishment_mp_accounts_collector (mp_collector_id),
  INDEX idx_establishment_mp_accounts_status (status),
  INDEX idx_establishment_mp_accounts_expires (token_expires_at),
  CONSTRAINT fk_establishment_mp_accounts_estab FOREIGN KEY (estabelecimento_id)
    REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

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
  status ENUM('connected','disconnected','error','connecting','validating') NOT NULL DEFAULT 'disconnected',
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
  CONSTRAINT fk_wa_accounts_estab FOREIGN KEY (estabelecimento_id)
    REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS wa_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  direction ENUM('in','out') NOT NULL,
  wa_id VARCHAR(64) NULL,
  wamid VARCHAR(128) NULL,
  phone_number_id VARCHAR(64) NULL,
  payload_json LONGTEXT NULL,
  status VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wa_messages_phone (phone_number_id),
  INDEX idx_wa_messages_estab (estabelecimento_id),
  INDEX idx_wa_messages_wamid (wamid),
  CONSTRAINT fk_wa_messages_estab FOREIGN KEY (estabelecimento_id)
    REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Contatos WhatsApp (ultima mensagem inbound)
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

CREATE TABLE IF NOT EXISTS agendamento_itens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agendamento_id INT NOT NULL,
  servico_id INT NOT NULL,
  ordem INT NOT NULL DEFAULT 1,
  duracao_min INT NOT NULL DEFAULT 0,
  preco_snapshot INT NOT NULL DEFAULT 0,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agendamento_itens_agendamento (agendamento_id),
  INDEX idx_agendamento_itens_servico (servico_id),
  INDEX idx_agendamento_itens_servico_agendamento (servico_id, agendamento_id),
  UNIQUE KEY uniq_agendamento_item_ordem (agendamento_id, ordem),
  CONSTRAINT fk_ag_itens_agendamento FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE,
  CONSTRAINT fk_ag_itens_servico FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE
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

CREATE TABLE IF NOT EXISTS cliente_notas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  cliente_id INT NOT NULL,
  notas TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_cliente_notas (estabelecimento_id, cliente_id),
  INDEX idx_cliente_notas_estab_cliente (estabelecimento_id, cliente_id),
  CONSTRAINT fk_cliente_notas_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_cliente_notas_cliente FOREIGN KEY (cliente_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS cliente_tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  cliente_id INT NOT NULL,
  tag VARCHAR(40) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_cliente_tag (estabelecimento_id, cliente_id, tag),
  INDEX idx_cliente_tags_estab_cliente (estabelecimento_id, cliente_id),
  INDEX idx_cliente_tags_estab_tag (estabelecimento_id, tag),
  CONSTRAINT fk_cliente_tags_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_cliente_tags_cliente FOREIGN KEY (cliente_id) REFERENCES usuarios(id) ON DELETE CASCADE
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

CREATE TABLE IF NOT EXISTS subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  plan ENUM('starter','pro','premium') NOT NULL,
  gateway VARCHAR(40) NOT NULL DEFAULT 'mercadopago',
  payment_method ENUM('credit_card','pix') NOT NULL DEFAULT 'pix',
  gateway_customer_id VARCHAR(80) NULL,
  gateway_subscription_id VARCHAR(80) NULL,
  gateway_payment_id VARCHAR(80) NULL,
  gateway_preference_id VARCHAR(80) NULL,
  external_reference VARCHAR(120) NULL,
  status ENUM('trialing','active','pending_payment','pending_pix','past_due','unpaid','expired','canceled') NOT NULL DEFAULT 'pending_pix',
  amount_cents INT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'BRL',
  billing_cycle ENUM('mensal','anual') NOT NULL DEFAULT 'mensal',
  trial_ends_at DATETIME NULL,
  current_period_start DATETIME NULL,
  current_period_end DATETIME NULL,
  next_billing_at DATETIME NULL,
  grace_until DATETIME NULL,
  last_payment_at DATETIME NULL,
  cancel_at DATETIME NULL,
  canceled_at DATETIME NULL,
  last_event_id VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_subscriptions_gateway (gateway_subscription_id),
  INDEX idx_subscriptions_estab (estabelecimento_id),
  INDEX idx_subscriptions_estab_status (estabelecimento_id, status),
  INDEX idx_subscriptions_gateway_payment (gateway_payment_id),
  INDEX idx_subscriptions_next_billing (next_billing_at),
  CONSTRAINT fk_subscriptions_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS subscription_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  subscription_id INT NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  gateway_event_id VARCHAR(120) NULL,
  payload LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_subscription_events_sub (subscription_id),
  INDEX idx_subscription_events_event (event_type, gateway_event_id),
  CONSTRAINT fk_subscription_events_sub FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS subscription_credits (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  source_subscription_id INT NOT NULL,
  target_subscription_id INT NULL,
  source_plan ENUM('starter','pro','premium') NOT NULL,
  target_plan ENUM('starter','pro','premium') NOT NULL,
  source_cycle_started_at DATETIME NULL,
  source_cycle_ends_at DATETIME NULL,
  changed_at DATETIME NOT NULL,
  original_plan_amount_cents INT NOT NULL,
  generated_credit_cents INT NOT NULL,
  reserved_credit_cents INT NOT NULL DEFAULT 0,
  consumed_credit_cents INT NOT NULL DEFAULT 0,
  remaining_credit_cents INT NOT NULL DEFAULT 0,
  payment_method ENUM('credit_card','pix') NULL,
  source_payment_id VARCHAR(120) NULL,
  source_external_reference VARCHAR(191) NULL,
  reason VARCHAR(40) NOT NULL DEFAULT 'upgrade_proration',
  unique_key VARCHAR(191) NOT NULL,
  status ENUM('available','partially_reserved','reserved','partially_consumed','consumed','released','voided') NOT NULL DEFAULT 'available',
  audit_payload LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_subscription_credits_unique_key (unique_key),
  INDEX idx_subscription_credits_estab_status (estabelecimento_id, status),
  INDEX idx_subscription_credits_target_sub (target_subscription_id),
  INDEX idx_subscription_credits_source_sub (source_subscription_id),
  CONSTRAINT fk_subscription_credits_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_subscription_credits_source_sub FOREIGN KEY (source_subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
  CONSTRAINT fk_subscription_credits_target_sub FOREIGN KEY (target_subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS subscription_credit_applications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  credit_id BIGINT NOT NULL,
  estabelecimento_id INT NOT NULL,
  target_subscription_id INT NOT NULL,
  payment_method ENUM('credit_card','pix') NULL,
  application_type VARCHAR(40) NOT NULL,
  application_group_key VARCHAR(191) NOT NULL,
  application_key VARCHAR(191) NOT NULL,
  scheduled_for DATETIME NULL,
  payment_id VARCHAR(120) NULL,
  external_reference VARCHAR(191) NULL,
  amount_cents INT NOT NULL,
  status ENUM('scheduled','applied','released') NOT NULL DEFAULT 'scheduled',
  payload LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_subscription_credit_app_key (application_key),
  INDEX idx_subscription_credit_app_sub_status (target_subscription_id, status, scheduled_for),
  INDEX idx_subscription_credit_app_credit (credit_id),
  CONSTRAINT fk_subscription_credit_app_credit FOREIGN KEY (credit_id) REFERENCES subscription_credits(id) ON DELETE CASCADE,
  CONSTRAINT fk_subscription_credit_app_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_subscription_credit_app_sub FOREIGN KEY (target_subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS implementation_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(64) NOT NULL UNIQUE,
  user_id INT NULL,
  nome VARCHAR(160) NULL,
  email VARCHAR(160) NULL,
  telefone VARCHAR(32) NULL,
  produto VARCHAR(80) NOT NULL DEFAULT 'implantacao_agenda_online',
  tipo VARCHAR(40) NOT NULL DEFAULT 'one_time',
  valor_centavos INT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'BRL',
  status ENUM('pending','approved','failed','canceled','refunded') NOT NULL DEFAULT 'pending',
  provider VARCHAR(32) NOT NULL DEFAULT 'mercadopago',
  provider_preference_id VARCHAR(120) NULL,
  provider_payment_id VARCHAR(120) NULL,
  external_reference VARCHAR(191) NOT NULL,
  checkout_url TEXT NULL,
  plan_hint ENUM('starter','pro','premium') NULL,
  paid_at DATETIME NULL,
  raw_payload LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_implementation_payments_external_reference (external_reference),
  INDEX idx_implementation_payments_user (user_id),
  INDEX idx_implementation_payments_provider_payment (provider, provider_payment_id),
  INDEX idx_implementation_payments_status (status, created_at),
  CONSTRAINT fk_implementation_payments_user FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS loyalty_plans (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  nome VARCHAR(120) NOT NULL,
  descricao TEXT NULL,
  preco_centavos INT NOT NULL,
  periodicidade ENUM('monthly') NOT NULL DEFAULT 'monthly',
  status ENUM('active','inactive','archived') NOT NULL DEFAULT 'inactive',
  desconto_percentual_extras DECIMAL(5,2) NULL,
  max_assinantes INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_loyalty_plans_estab_status (estabelecimento_id, status),
  INDEX idx_loyalty_plans_estab_created (estabelecimento_id, created_at),
  CONSTRAINT fk_loyalty_plans_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS loyalty_plan_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  loyalty_plan_id BIGINT NOT NULL,
  servico_id INT NOT NULL,
  quantidade_por_ciclo INT NOT NULL,
  ordem INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_loyalty_plan_item (loyalty_plan_id, servico_id),
  INDEX idx_loyalty_plan_items_servico (servico_id),
  INDEX idx_loyalty_plan_items_ordem (loyalty_plan_id, ordem),
  CONSTRAINT fk_loyalty_plan_items_plan FOREIGN KEY (loyalty_plan_id) REFERENCES loyalty_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_loyalty_plan_items_servico FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS client_loyalty_subscriptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  estabelecimento_id INT NOT NULL,
  loyalty_plan_id BIGINT NOT NULL,
  owner_type ENUM('platform','establishment') NOT NULL DEFAULT 'establishment',
  seller_mp_account_id BIGINT NULL,
  status ENUM('trialing','active','pending_payment','pending_pix','past_due','unpaid','expired','canceled') NOT NULL DEFAULT 'pending_pix',
  payment_method ENUM('credit_card','pix') NOT NULL DEFAULT 'pix',
  gateway VARCHAR(40) NOT NULL DEFAULT 'mercadopago',
  gateway_customer_id VARCHAR(120) NULL,
  mp_payer_id VARCHAR(120) NULL,
  gateway_subscription_id VARCHAR(120) NULL,
  mp_preapproval_id VARCHAR(120) NULL,
  gateway_payment_id VARCHAR(120) NULL,
  external_reference VARCHAR(191) NULL,
  started_at DATETIME NULL,
  current_period_start DATETIME NULL,
  current_period_end DATETIME NULL,
  next_billing_at DATETIME NULL,
  last_payment_at DATETIME NULL,
  grace_until DATETIME NULL,
  cancel_at DATETIME NULL,
  canceled_at DATETIME NULL,
  auto_renew TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_client_loyalty_gateway_subscription (gateway_subscription_id),
  UNIQUE KEY uk_client_loyalty_mp_preapproval (mp_preapproval_id),
  INDEX idx_client_loyalty_cliente_estab (cliente_id, estabelecimento_id),
  INDEX idx_client_loyalty_estab_status (estabelecimento_id, status),
  INDEX idx_client_loyalty_plan_status (loyalty_plan_id, status),
  INDEX idx_client_loyalty_seller_mp_account (seller_mp_account_id),
  INDEX idx_client_loyalty_gateway_payment (gateway_payment_id),
  INDEX idx_client_loyalty_external_reference (external_reference),
  INDEX idx_client_loyalty_next_billing (next_billing_at),
  CONSTRAINT fk_client_loyalty_cliente FOREIGN KEY (cliente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_client_loyalty_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_client_loyalty_plan FOREIGN KEY (loyalty_plan_id) REFERENCES loyalty_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS client_loyalty_subscription_credits (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  client_loyalty_subscription_id BIGINT NOT NULL,
  servico_id INT NOT NULL,
  ciclo_ref DATE NOT NULL,
  quantidade_total INT NOT NULL,
  quantidade_utilizada INT NOT NULL DEFAULT 0,
  quantidade_restante INT NOT NULL,
  expira_em DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_client_loyalty_credit_cycle (client_loyalty_subscription_id, servico_id, ciclo_ref),
  INDEX idx_client_loyalty_credit_lookup (client_loyalty_subscription_id, ciclo_ref, servico_id),
  INDEX idx_client_loyalty_credit_expira (expira_em),
  CONSTRAINT fk_client_loyalty_credit_sub FOREIGN KEY (client_loyalty_subscription_id) REFERENCES client_loyalty_subscriptions(id) ON DELETE CASCADE,
  CONSTRAINT fk_client_loyalty_credit_servico FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS client_loyalty_subscription_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  client_loyalty_subscription_id BIGINT NOT NULL,
  tipo_evento VARCHAR(80) NOT NULL,
  gateway_event_id VARCHAR(191) NULL,
  mp_topic VARCHAR(80) NULL,
  owner_type ENUM('platform','establishment') NOT NULL DEFAULT 'establishment',
  owner_id BIGINT NULL,
  estabelecimento_id INT NULL,
  mp_user_id VARCHAR(64) NULL,
  mp_collector_id VARCHAR(64) NULL,
  mp_payment_id VARCHAR(120) NULL,
  payment_status VARCHAR(60) NULL,
  payment_method VARCHAR(60) NULL,
  payment_type VARCHAR(60) NULL,
  amount_cents INT NULL,
  action_taken VARCHAR(80) NULL,
  ignored_reason VARCHAR(191) NULL,
  payload_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client_loyalty_events_sub (client_loyalty_subscription_id, created_at),
  INDEX idx_client_loyalty_events_gateway (gateway_event_id),
  INDEX idx_client_loyalty_events_dedupe (client_loyalty_subscription_id, tipo_evento, gateway_event_id),
  INDEX idx_client_loyalty_events_mp_payment (mp_payment_id),
  INDEX idx_client_loyalty_events_topic (mp_topic, created_at),
  INDEX idx_client_loyalty_events_owner (owner_type, owner_id, created_at),
  CONSTRAINT fk_client_loyalty_events_sub FOREIGN KEY (client_loyalty_subscription_id) REFERENCES client_loyalty_subscriptions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS mercadopago_webhook_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(120) NULL,
  delivery_key VARCHAR(191) NOT NULL,
  owner_type ENUM('platform','establishment','unresolved') NOT NULL,
  owner_id BIGINT NULL,
  estabelecimento_id INT NULL,
  mp_user_id VARCHAR(64) NULL,
  mp_collector_id VARCHAR(64) NULL,
  topic VARCHAR(80) NOT NULL,
  action_name VARCHAR(120) NULL,
  resource_id VARCHAR(120) NULL,
  external_reference VARCHAR(191) NULL,
  loyalty_subscription_id BIGINT NULL,
  action_taken VARCHAR(80) NULL,
  ignored_reason VARCHAR(191) NULL,
  raw_payload LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_mercadopago_webhook_events_delivery (delivery_key),
  INDEX idx_mercadopago_webhook_events_owner (owner_type, owner_id, created_at),
  INDEX idx_mercadopago_webhook_events_topic (topic, resource_id, created_at),
  INDEX idx_mercadopago_webhook_events_estab (estabelecimento_id, created_at),
  CONSTRAINT fk_mercadopago_webhook_events_loyalty_sub
    FOREIGN KEY (loyalty_subscription_id) REFERENCES client_loyalty_subscriptions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS auditoria (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  protocolo VARCHAR(50) NOT NULL,
  acao VARCHAR(30) NOT NULL,
  alvo_email VARCHAR(255),
  executado_por VARCHAR(100),
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
