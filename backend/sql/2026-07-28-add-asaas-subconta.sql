-- 2026-07-28: subconta Asaas aberta PELA plataforma, em nome do estabelecimento.
--
-- Ate aqui o salao precisava abrir a propria conta no Asaas e colar o Wallet ID nas
-- Configuracoes. Nao era escolha: a conta da plataforma era PF, e o Asaas so permite criar
-- subcontas a partir de conta PJ. Com o CNPJ aprovado, `POST /v3/accounts` destrava e o
-- walletId passa a ser preenchido pela propria plataforma.
--
-- As colunas `asaas_wallet_id`, `asaas_account_id` e `asaas_api_key_ref` JA EXISTEM
-- (2026-07-05-add-asaas-split-sinal.sql). O que falta e' distinguir a wallet que a plataforma
-- criou da que o dono colou na mao, e guardar a prova do aceite.
--
-- Aditivo e idempotente (ADD COLUMN IF NOT EXISTS, MariaDB) para re-execucao segura.
USE agendamentos;

-- `asaas_subaccount_created_at` NAO NULO e o que distingue subconta de wallet manual: o
-- caminho manual continua existindo para quem ja tem conta Asaas (um CPF/CNPJ ja cadastrado
-- no Asaas nao pode virar subconta).
ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS asaas_subaccount_created_at DATETIME NULL;

-- Trilha do aceite. Mesma forma da adotada em wa_accounts (2026-07-26-add-wa-terms-acceptance):
-- quem/quando/de onde. Aqui pesa mais: a plataforma abre uma conta FINANCEIRA em nome de
-- terceiro, e o consentimento precisa ser demonstravel depois, nao presumido.
ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS asaas_onboarding_terms_version VARCHAR(32) NULL;

ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS asaas_onboarding_accepted_at DATETIME(3) NULL;

ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS asaas_onboarding_accepted_ip VARCHAR(64) NULL;
