-- Migration: add public confirmation fields to agendamentos
USE agendamentos;

ALTER TABLE agendamentos
  MODIFY COLUMN status ENUM('confirmado','pendente','cancelado') NOT NULL DEFAULT 'confirmado',
  ADD COLUMN public_confirm_token_hash VARCHAR(64) NULL AFTER status,
  ADD COLUMN public_confirm_expires_at DATETIME NULL AFTER public_confirm_token_hash,
  ADD COLUMN public_confirmed_at DATETIME NULL AFTER public_confirm_expires_at,
  ADD INDEX idx_ag_public_confirm_expires (public_confirm_expires_at);
