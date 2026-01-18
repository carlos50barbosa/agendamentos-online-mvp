-- Migration: add reporting insights columns + indexes
USE agendamentos;
SET @db := DATABASE();

-- no_show flag
SELECT COUNT(*)
INTO @col_no_show
FROM information_schema.columns
WHERE table_schema=@db AND table_name='agendamentos' AND column_name='no_show';
SET @sql := IF(@col_no_show=0,
  'ALTER TABLE agendamentos ADD COLUMN no_show TINYINT(1) NOT NULL DEFAULT 0 AFTER status',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- origem/canal
SELECT COUNT(*)
INTO @col_origem
FROM information_schema.columns
WHERE table_schema=@db AND table_name='agendamentos' AND column_name='origem';
SET @sql := IF(@col_origem=0,
  'ALTER TABLE agendamentos ADD COLUMN origem VARCHAR(32) NULL AFTER no_show',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- indexes for report filters
SELECT COUNT(*)
INTO @idx_inicio_status
FROM information_schema.statistics
WHERE table_schema=@db AND table_name='agendamentos' AND index_name='idx_ag_estab_inicio_status';
SET @sql := IF(@idx_inicio_status=0,
  'CREATE INDEX idx_ag_estab_inicio_status ON agendamentos (estabelecimento_id, inicio, status)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT COUNT(*)
INTO @idx_criado
FROM information_schema.statistics
WHERE table_schema=@db AND table_name='agendamentos' AND index_name='idx_ag_estab_criado';
SET @sql := IF(@idx_criado=0,
  'CREATE INDEX idx_ag_estab_criado ON agendamentos (estabelecimento_id, criado_em)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
