-- Migration: add subscriptions tables for billing
USE agendamentos;

CREATE TABLE IF NOT EXISTS subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  plan ENUM('starter','pro','premium') NOT NULL,
  gateway VARCHAR(40) NOT NULL DEFAULT 'mercadopago',
  gateway_subscription_id VARCHAR(80) NULL,
  gateway_preference_id VARCHAR(80) NULL,
  external_reference VARCHAR(120) NULL,
  status ENUM('initiated','pending','authorized','active','paused','past_due','canceled','expired') NOT NULL DEFAULT 'initiated',
  amount_cents INT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'BRL',
  trial_ends_at DATETIME NULL,
  current_period_end DATETIME NULL,
  cancel_at DATETIME NULL,
  canceled_at DATETIME NULL,
  last_event_id VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_subscriptions_gateway (gateway_subscription_id),
  INDEX idx_subscriptions_estab (estabelecimento_id),
  CONSTRAINT fk_subscriptions_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS subscription_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  subscription_id INT NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  gateway_event_id VARCHAR(80) NULL,
  payload LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_subscription_events_sub (subscription_id),
  CONSTRAINT fk_subscription_events_sub FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

