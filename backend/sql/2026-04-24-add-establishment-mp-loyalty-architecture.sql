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

INSERT INTO establishment_mp_accounts (
  estabelecimento_id,
  mp_user_id,
  mp_collector_id,
  access_token_encrypted,
  refresh_token_encrypted,
  token_last4,
  token_expires_at,
  status,
  created_at,
  updated_at
)
SELECT legacy.estabelecimento_id,
       legacy.mp_user_id,
       legacy.mp_user_id,
       legacy.access_token_enc,
       legacy.refresh_token_enc,
       legacy.token_last4,
       legacy.expires_at,
       CASE
         WHEN legacy.status='connected' AND legacy.expires_at IS NOT NULL AND legacy.expires_at < NOW() THEN 'expired'
         WHEN legacy.status='revoked' THEN 'revoked'
         WHEN legacy.status='error' THEN 'error'
         ELSE 'connected'
       END,
       legacy.created_at,
       legacy.updated_at
  FROM mercadopago_accounts legacy
  LEFT JOIN establishment_mp_accounts current
    ON current.estabelecimento_id = legacy.estabelecimento_id
 WHERE current.id IS NULL;

ALTER TABLE client_loyalty_subscriptions
  ADD COLUMN owner_type ENUM('platform','establishment') NOT NULL DEFAULT 'establishment' AFTER loyalty_plan_id,
  ADD COLUMN seller_mp_account_id BIGINT NULL AFTER owner_type,
  ADD COLUMN mp_payer_id VARCHAR(120) NULL AFTER gateway_customer_id,
  ADD COLUMN mp_preapproval_id VARCHAR(120) NULL AFTER gateway_subscription_id,
  ADD COLUMN started_at DATETIME NULL AFTER external_reference,
  MODIFY COLUMN external_reference VARCHAR(191) NULL,
  ADD UNIQUE INDEX uk_client_loyalty_mp_preapproval (mp_preapproval_id),
  ADD INDEX idx_client_loyalty_seller_mp_account (seller_mp_account_id),
  ADD INDEX idx_client_loyalty_external_reference (external_reference);

UPDATE client_loyalty_subscriptions
   SET owner_type='establishment'
 WHERE owner_type IS NULL OR owner_type='';

UPDATE client_loyalty_subscriptions
   SET mp_payer_id = gateway_customer_id
 WHERE mp_payer_id IS NULL
   AND gateway_customer_id IS NOT NULL;

UPDATE client_loyalty_subscriptions
   SET mp_preapproval_id = gateway_subscription_id
 WHERE mp_preapproval_id IS NULL
   AND gateway_subscription_id IS NOT NULL;

UPDATE client_loyalty_subscriptions
   SET started_at = current_period_start
 WHERE started_at IS NULL
   AND current_period_start IS NOT NULL;

UPDATE client_loyalty_subscriptions cls
  JOIN establishment_mp_accounts account
    ON account.estabelecimento_id = cls.estabelecimento_id
   SET cls.seller_mp_account_id = account.id
 WHERE cls.seller_mp_account_id IS NULL;

ALTER TABLE client_loyalty_subscription_events
  ADD COLUMN mp_topic VARCHAR(80) NULL AFTER gateway_event_id,
  ADD COLUMN owner_type ENUM('platform','establishment') NOT NULL DEFAULT 'establishment' AFTER mp_topic,
  ADD COLUMN owner_id BIGINT NULL AFTER owner_type,
  ADD COLUMN estabelecimento_id INT NULL AFTER owner_id,
  ADD COLUMN mp_user_id VARCHAR(64) NULL AFTER estabelecimento_id,
  ADD COLUMN mp_collector_id VARCHAR(64) NULL AFTER mp_user_id,
  ADD COLUMN mp_payment_id VARCHAR(120) NULL AFTER mp_collector_id,
  ADD COLUMN payment_status VARCHAR(60) NULL AFTER mp_payment_id,
  ADD COLUMN payment_method VARCHAR(60) NULL AFTER payment_status,
  ADD COLUMN payment_type VARCHAR(60) NULL AFTER payment_method,
  ADD COLUMN amount_cents INT NULL AFTER payment_type,
  ADD COLUMN action_taken VARCHAR(80) NULL AFTER amount_cents,
  ADD COLUMN ignored_reason VARCHAR(80) NULL AFTER action_taken,
  ADD INDEX idx_client_loyalty_events_mp_payment (mp_payment_id),
  ADD INDEX idx_client_loyalty_events_topic (mp_topic, created_at),
  ADD INDEX idx_client_loyalty_events_owner (owner_type, owner_id, created_at);

UPDATE client_loyalty_subscription_events ev
  JOIN client_loyalty_subscriptions cls
    ON cls.id = ev.client_loyalty_subscription_id
   SET ev.owner_type = 'establishment',
       ev.owner_id = cls.estabelecimento_id,
       ev.estabelecimento_id = cls.estabelecimento_id
 WHERE ev.estabelecimento_id IS NULL OR ev.owner_id IS NULL;

CREATE TABLE IF NOT EXISTS mercadopago_webhook_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(120) NULL,
  delivery_key VARCHAR(191) NOT NULL,
  owner_type ENUM('platform','establishment') NOT NULL,
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
  ignored_reason VARCHAR(80) NULL,
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
