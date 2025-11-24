-- 2025-03-09: Marca envio de lembrete 8h (evita perder em reinicio)
ALTER TABLE agendamentos
  ADD COLUMN reminder_8h_sent_at DATETIME NULL AFTER wa_job_15m_id;

CREATE INDEX idx_ag_reminder8h ON agendamentos (reminder_8h_sent_at, inicio);
