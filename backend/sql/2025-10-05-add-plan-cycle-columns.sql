-- Migration: add billing cycle tracking to users and subscriptions
USE agendamentos;

ALTER TABLE usuarios
  ADD COLUMN plan_cycle ENUM('mensal','anual') NOT NULL DEFAULT 'mensal' AFTER plan_status;

ALTER TABLE subscriptions
  ADD COLUMN billing_cycle ENUM('mensal','anual') NOT NULL DEFAULT 'mensal' AFTER currency;

