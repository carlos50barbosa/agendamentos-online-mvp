ALTER TABLE agendamentos
  ADD COLUMN reminder_8h_msg_id VARCHAR(191) NULL AFTER reminder_8h_sent_at,
  ADD COLUMN cliente_confirmou_whatsapp_at DATETIME NULL AFTER reminder_8h_msg_id,
  ADD INDEX idx_ag_confirm_wa (cliente_confirmou_whatsapp_at);
