USE agendamentos;

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS onboarding_concluido TINYINT(1) NOT NULL DEFAULT 0 AFTER plan_subscription_id;

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS onboarding_etapa VARCHAR(50) NOT NULL DEFAULT 'profissionais' AFTER onboarding_concluido;

