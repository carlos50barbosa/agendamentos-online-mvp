ALTER TABLE agendamentos
  ADD COLUMN loyalty_subscription_id BIGINT NULL AFTER public_confirmed_at,
  ADD COLUMN loyalty_credit_applied TINYINT(1) NOT NULL DEFAULT 0 AFTER loyalty_subscription_id,
  ADD COLUMN loyalty_discount_percent DECIMAL(5,2) NULL AFTER loyalty_credit_applied,
  ADD COLUMN loyalty_benefit_snapshot_json LONGTEXT NULL AFTER loyalty_discount_percent,
  ADD INDEX idx_ag_loyalty_subscription (loyalty_subscription_id),
  ADD INDEX idx_ag_loyalty_credit_applied (loyalty_credit_applied);

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
  status ENUM('trialing','active','pending_payment','pending_pix','past_due','unpaid','expired','canceled') NOT NULL DEFAULT 'pending_pix',
  payment_method ENUM('credit_card','pix') NOT NULL DEFAULT 'pix',
  gateway VARCHAR(40) NOT NULL DEFAULT 'mercadopago',
  gateway_customer_id VARCHAR(120) NULL,
  gateway_subscription_id VARCHAR(120) NULL,
  gateway_payment_id VARCHAR(120) NULL,
  external_reference VARCHAR(160) NULL,
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
  INDEX idx_client_loyalty_cliente_estab (cliente_id, estabelecimento_id),
  INDEX idx_client_loyalty_estab_status (estabelecimento_id, status),
  INDEX idx_client_loyalty_plan_status (loyalty_plan_id, status),
  INDEX idx_client_loyalty_gateway_payment (gateway_payment_id),
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
  payload_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client_loyalty_events_sub (client_loyalty_subscription_id, created_at),
  INDEX idx_client_loyalty_events_gateway (gateway_event_id),
  CONSTRAINT fk_client_loyalty_events_sub FOREIGN KEY (client_loyalty_subscription_id) REFERENCES client_loyalty_subscriptions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE agendamentos
  ADD CONSTRAINT fk_ag_loyalty_subscription
    FOREIGN KEY (loyalty_subscription_id) REFERENCES client_loyalty_subscriptions(id) ON DELETE SET NULL;
