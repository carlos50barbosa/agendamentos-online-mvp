ALTER TABLE agendamentos
  ADD COLUMN estab_reminder_5h_sent_at DATETIME NULL AFTER reminder_8h_msg_id,
  ADD COLUMN estab_reminder_5h_msg_id  VARCHAR(191) NULL AFTER estab_reminder_5h_sent_at;

CREATE INDEX idx_ag_reminder_estab_5h ON agendamentos (estab_reminder_5h_sent_at, inicio);
