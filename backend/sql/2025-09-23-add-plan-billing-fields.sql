-- Migration: add plan and billing fields to usuarios
USE agendamentos;

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS plan ENUM('starter','pro','premium') NOT NULL DEFAULT 'starter' AFTER tipo,
  ADD COLUMN IF NOT EXISTS plan_status ENUM('trialing','active','delinquent') NOT NULL DEFAULT 'trialing' AFTER plan,
  ADD COLUMN IF NOT EXISTS plan_trial_ends_at DATETIME NULL AFTER plan_status,
  ADD COLUMN IF NOT EXISTS plan_active_until DATETIME NULL AFTER plan_trial_ends_at,
  ADD COLUMN IF NOT EXISTS plan_subscription_id VARCHAR(80) NULL AFTER plan_active_until;

UPDATE usuarios SET plan = IFNULL(NULLIF(plan, ''), 'starter');
UPDATE usuarios SET plan_status = IFNULL(NULLIF(plan_status, ''), 'trialing');
