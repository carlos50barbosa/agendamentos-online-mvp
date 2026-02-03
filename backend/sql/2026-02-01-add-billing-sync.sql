-- Migration: billing sync adjustments (subscription_events payload_json + indexes)
SET @db := DATABASE();

-- subscription_events: payload_json
SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'subscription_events' AND COLUMN_NAME = 'payload_json'
  ),
  'SELECT 0',
  'ALTER TABLE subscription_events ADD COLUMN payload_json LONGTEXT NULL AFTER gateway_event_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- subscription_events: event_type
SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'subscription_events' AND COLUMN_NAME = 'event_type'
  ),
  'SELECT 0',
  'ALTER TABLE subscription_events ADD COLUMN event_type VARCHAR(80) NOT NULL AFTER subscription_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- subscription_events: created_at
SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'subscription_events' AND COLUMN_NAME = 'created_at'
  ),
  'SELECT 0',
  'ALTER TABLE subscription_events ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- subscriptions: index on gateway_preference_id
SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'subscriptions' AND INDEX_NAME = 'idx_subscriptions_gateway_preference'
  ),
  'SELECT 0',
  'ALTER TABLE subscriptions ADD INDEX idx_subscriptions_gateway_preference (gateway_preference_id)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- subscriptions: index on (estabelecimento_id, status)
SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'subscriptions' AND INDEX_NAME = 'idx_subscriptions_estab_status'
  ),
  'SELECT 0',
  'ALTER TABLE subscriptions ADD INDEX idx_subscriptions_estab_status (estabelecimento_id, status)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
