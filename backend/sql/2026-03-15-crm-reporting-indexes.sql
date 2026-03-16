-- Migration: add CRM/reporting support indexes
USE agendamentos;
SET @db := DATABASE();

SELECT COUNT(*)
INTO @idx_ag_prof_inicio
FROM information_schema.statistics
WHERE table_schema=@db AND table_name='agendamentos' AND index_name='idx_ag_estab_prof_inicio';
SET @sql := IF(@idx_ag_prof_inicio=0,
  'CREATE INDEX idx_ag_estab_prof_inicio ON agendamentos (estabelecimento_id, profissional_id, inicio)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT COUNT(*)
INTO @idx_ag_origem_inicio
FROM information_schema.statistics
WHERE table_schema=@db AND table_name='agendamentos' AND index_name='idx_ag_estab_origem_inicio';
SET @sql := IF(@idx_ag_origem_inicio=0,
  'CREATE INDEX idx_ag_estab_origem_inicio ON agendamentos (estabelecimento_id, origem, inicio)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT COUNT(*)
INTO @idx_ai_servico_agendamento
FROM information_schema.statistics
WHERE table_schema=@db AND table_name='agendamento_itens' AND index_name='idx_agendamento_itens_servico_agendamento';
SET @sql := IF(@idx_ai_servico_agendamento=0,
  'CREATE INDEX idx_agendamento_itens_servico_agendamento ON agendamento_itens (servico_id, agendamento_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
