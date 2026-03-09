-- Migration: metricas diarias do funil do bot WhatsApp
SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS wa_bot_metrics_daily (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  day DATE NOT NULL,
  inbound_count INT NOT NULL DEFAULT 0,
  started_agendar INT NOT NULL DEFAULT 0,
  completed_agendar INT NOT NULL DEFAULT 0,
  started_remarcar INT NOT NULL DEFAULT 0,
  completed_remarcar INT NOT NULL DEFAULT 0,
  started_cancelar INT NOT NULL DEFAULT 0,
  completed_cancelar INT NOT NULL DEFAULT 0,
  conflicts_409 INT NOT NULL DEFAULT 0,
  handoff_opened INT NOT NULL DEFAULT 0,
  outside_window_template_sent INT NOT NULL DEFAULT 0,
  errors_count INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wa_bot_metrics_daily_tenant_day (tenant_id, day),
  INDEX idx_wa_bot_metrics_daily_day (day),
  CONSTRAINT fk_wa_bot_metrics_daily_tenant FOREIGN KEY (tenant_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
