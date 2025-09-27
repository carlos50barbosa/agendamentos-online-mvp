-- Migration: add plan and billing fields to usuarios
USE agendamentos;

SET @db := DATABASE();

SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'plan'
  ),
  'SELECT 0',
  'ALTER TABLE usuarios ADD COLUMN plan ENUM(''starter'',''pro'',''premium'') NOT NULL DEFAULT ''starter'' AFTER tipo'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'plan_status'
  ),
  'SELECT 0',
  'ALTER TABLE usuarios ADD COLUMN plan_status ENUM(''trialing'',''active'',''delinquent'') NOT NULL DEFAULT ''trialing'' AFTER plan'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'plan_trial_ends_at'
  ),
  'SELECT 0',
  'ALTER TABLE usuarios ADD COLUMN plan_trial_ends_at DATETIME NULL AFTER plan_status'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'plan_active_until'
  ),
  'SELECT 0',
  'ALTER TABLE usuarios ADD COLUMN plan_active_until DATETIME NULL AFTER plan_trial_ends_at'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'plan_subscription_id'
  ),
  'SELECT 0',
  'ALTER TABLE usuarios ADD COLUMN plan_subscription_id VARCHAR(80) NULL AFTER plan_active_until'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE usuarios SET plan = IFNULL(NULLIF(plan, ''), 'starter');
UPDATE usuarios SET plan_status = IFNULL(NULLIF(plan_status, ''), 'trialing');
