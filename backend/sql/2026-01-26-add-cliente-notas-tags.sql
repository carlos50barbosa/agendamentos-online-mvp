-- Migration: add cliente notas/tags + index for CRM
USE agendamentos;
SET @db := DATABASE();

-- cliente_notas
SELECT COUNT(*)
INTO @tbl_notas
FROM information_schema.tables
WHERE table_schema=@db AND table_name='cliente_notas';
SET @sql := IF(@tbl_notas=0,
  'CREATE TABLE cliente_notas (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- cliente_tags
SELECT COUNT(*)
INTO @tbl_tags
FROM information_schema.tables
WHERE table_schema=@db AND table_name='cliente_tags';
SET @sql := IF(@tbl_tags=0,
  'CREATE TABLE cliente_tags (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- index for faster cliente/estab lookups
SELECT COUNT(*)
INTO @idx_estab_cliente_inicio
FROM information_schema.statistics
WHERE table_schema=@db AND table_name='agendamentos' AND index_name='idx_ag_estab_cliente_inicio';
SET @sql := IF(@idx_estab_cliente_inicio=0,
  'CREATE INDEX idx_ag_estab_cliente_inicio ON agendamentos (estabelecimento_id, cliente_id, inicio)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

