-- Migration: expand plan_status enum to suport billing lifecycle
USE agendamentos;

SET @db := DATABASE();
SET @sql := NULL;

SELECT IF(
  FIND_IN_SET('pending', REPLACE(COLUMN_TYPE, "'", '')) = 0,
  'ALTER TABLE usuarios MODIFY COLUMN plan_status ENUM(''trialing'',''active'',''delinquent'',''pending'',''canceled'',''expired'') NOT NULL DEFAULT ''trialing''',
  'SELECT 0'
) INTO @sql
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'plan_status'
LIMIT 1;

PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
