-- Migration: normalize recurring-card + manual-pix subscription lifecycle
USE agendamentos;

SET @db := DATABASE();

-- usuarios.plan_status: allow old and new values during remap
SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'usuarios'
       AND COLUMN_NAME = 'plan_status'
  ),
  'ALTER TABLE usuarios MODIFY COLUMN plan_status ENUM(''trialing'',''active'',''delinquent'',''pending'',''pending_payment'',''pending_pix'',''past_due'',''unpaid'',''expired'',''canceled'') NOT NULL DEFAULT ''trialing''',
  'SELECT 0'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE usuarios
   SET plan_status='unpaid'
 WHERE plan_status='delinquent';

UPDATE usuarios
   SET plan_status='pending_pix'
 WHERE plan_status='pending';

SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'usuarios'
       AND COLUMN_NAME = 'plan_status'
  ),
  'ALTER TABLE usuarios MODIFY COLUMN plan_status ENUM(''trialing'',''active'',''pending_payment'',''pending_pix'',''past_due'',''unpaid'',''expired'',''canceled'') NOT NULL DEFAULT ''trialing''',
  'SELECT 0'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- subscriptions: required columns for recurring card + manual PIX
SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'subscriptions'
       AND COLUMN_NAME = 'payment_method'
  ),
  'SELECT 0',
  'ALTER TABLE subscriptions ADD COLUMN payment_method ENUM(''credit_card'',''pix'') NOT NULL DEFAULT ''pix'' AFTER gateway'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'subscriptions'
       AND COLUMN_NAME = 'gateway_customer_id'
  ),
  'SELECT 0',
  'ALTER TABLE subscriptions ADD COLUMN gateway_customer_id VARCHAR(80) NULL AFTER payment_method'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'subscriptions'
       AND COLUMN_NAME = 'gateway_payment_id'
  ),
  'SELECT 0',
  'ALTER TABLE subscriptions ADD COLUMN gateway_payment_id VARCHAR(80) NULL AFTER gateway_subscription_id'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'subscriptions'
       AND COLUMN_NAME = 'current_period_start'
  ),
  'SELECT 0',
  'ALTER TABLE subscriptions ADD COLUMN current_period_start DATETIME NULL AFTER trial_ends_at'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'subscriptions'
       AND COLUMN_NAME = 'next_billing_at'
  ),
  'SELECT 0',
  'ALTER TABLE subscriptions ADD COLUMN next_billing_at DATETIME NULL AFTER current_period_end'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'subscriptions'
       AND COLUMN_NAME = 'grace_until'
  ),
  'SELECT 0',
  'ALTER TABLE subscriptions ADD COLUMN grace_until DATETIME NULL AFTER next_billing_at'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'subscriptions'
       AND COLUMN_NAME = 'last_payment_at'
  ),
  'SELECT 0',
  'ALTER TABLE subscriptions ADD COLUMN last_payment_at DATETIME NULL AFTER grace_until'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE subscriptions
   SET payment_method =
     CASE
       WHEN gateway_subscription_id IS NOT NULL AND TRIM(gateway_subscription_id) <> '' THEN 'credit_card'
       ELSE 'pix'
     END
 WHERE payment_method IS NULL
    OR payment_method = '';

-- subscriptions.status: allow old + new values during remap
SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'subscriptions'
       AND COLUMN_NAME = 'status'
  ),
  'ALTER TABLE subscriptions MODIFY COLUMN status ENUM(''initiated'',''pending'',''authorized'',''active'',''paused'',''pending_payment'',''pending_pix'',''past_due'',''unpaid'',''expired'',''canceled'',''trialing'') NOT NULL DEFAULT ''pending_pix''',
  'SELECT 0'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE subscriptions
   SET status =
     CASE
       WHEN status IN ('initiated','pending') AND payment_method='credit_card' THEN 'pending_payment'
       WHEN status IN ('initiated','pending') THEN 'pending_pix'
       WHEN status='authorized' THEN 'active'
       WHEN status='paused' THEN 'past_due'
       ELSE status
     END;

UPDATE subscriptions
   SET next_billing_at = current_period_end
 WHERE next_billing_at IS NULL
   AND current_period_end IS NOT NULL;

SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'subscriptions'
       AND COLUMN_NAME = 'status'
  ),
  'ALTER TABLE subscriptions MODIFY COLUMN status ENUM(''trialing'',''active'',''pending_payment'',''pending_pix'',''past_due'',''unpaid'',''expired'',''canceled'') NOT NULL DEFAULT ''pending_pix''',
  'SELECT 0'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- indexes used by sync/webhook/runtime queries
SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'subscriptions'
       AND INDEX_NAME = 'idx_subscriptions_gateway_payment'
  ),
  'SELECT 0',
  'ALTER TABLE subscriptions ADD INDEX idx_subscriptions_gateway_payment (gateway_payment_id)'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'subscriptions'
       AND INDEX_NAME = 'idx_subscriptions_next_billing'
  ),
  'SELECT 0',
  'ALTER TABLE subscriptions ADD INDEX idx_subscriptions_next_billing (next_billing_at)'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := NULL;
SELECT IF(
  EXISTS(
    SELECT 1
      FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = @db
       AND TABLE_NAME = 'subscriptions'
       AND INDEX_NAME = 'idx_subscription_events_event'
  ),
  'SELECT 0',
  'ALTER TABLE subscription_events ADD INDEX idx_subscription_events_event (event_type, gateway_event_id)'
) INTO @sql;
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
