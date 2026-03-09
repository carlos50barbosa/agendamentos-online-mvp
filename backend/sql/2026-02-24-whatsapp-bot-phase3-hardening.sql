-- Migration: WhatsApp bot fase 3 + hardening de producao
SET @db := DATABASE();

-- wa_sessions.last_interaction_at (janela de 24h por tenant + phone)
SET @has_wa_sessions := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'wa_sessions'
);
SET @has_last_interaction_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'wa_sessions'
    AND COLUMN_NAME = 'last_interaction_at'
);
SET @add_last_interaction_sql := IF(
  @has_wa_sessions = 1 AND @has_last_interaction_at = 0,
  'ALTER TABLE wa_sessions ADD COLUMN last_interaction_at DATETIME NULL AFTER expires_at',
  'SELECT 1'
);
PREPARE stmt_add_last_interaction FROM @add_last_interaction_sql;
EXECUTE stmt_add_last_interaction;
DEALLOCATE PREPARE stmt_add_last_interaction;

-- wa_conversation_logs.latency_ms
SET @has_wa_logs := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'wa_conversation_logs'
);
SET @has_latency_ms := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'wa_conversation_logs'
    AND COLUMN_NAME = 'latency_ms'
);
SET @add_latency_sql := IF(
  @has_wa_logs = 1 AND @has_latency_ms = 0,
  'ALTER TABLE wa_conversation_logs ADD COLUMN latency_ms INT NULL AFTER reply_type',
  'SELECT 1'
);
PREPARE stmt_add_latency FROM @add_latency_sql;
EXECUTE stmt_add_latency;
DEALLOCATE PREPARE stmt_add_latency;

-- wa_conversation_logs.tenant_resolution_source
SET @has_tenant_resolution_source := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'wa_conversation_logs'
    AND COLUMN_NAME = 'tenant_resolution_source'
);
SET @add_tenant_source_sql := IF(
  @has_wa_logs = 1 AND @has_tenant_resolution_source = 0,
  'ALTER TABLE wa_conversation_logs ADD COLUMN tenant_resolution_source VARCHAR(128) NULL AFTER reply_type',
  'SELECT 1'
);
PREPARE stmt_add_tenant_source FROM @add_tenant_source_sql;
EXECUTE stmt_add_tenant_source;
DEALLOCATE PREPARE stmt_add_tenant_source;

-- indice util para leitura de eventos por tenant + recebimento
SET @has_idx_inbound_received := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'wa_inbound_events'
    AND INDEX_NAME = 'idx_wa_inbound_events_tenant_received'
);
SET @add_idx_inbound_received_sql := IF(
  @has_idx_inbound_received = 0,
  'ALTER TABLE wa_inbound_events ADD INDEX idx_wa_inbound_events_tenant_received (tenant_id, received_at)',
  'SELECT 1'
);
PREPARE stmt_add_idx_inbound_received FROM @add_idx_inbound_received_sql;
EXECUTE stmt_add_idx_inbound_received;
DEALLOCATE PREPARE stmt_add_idx_inbound_received;
