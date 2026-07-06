-- 2026-07-05: Sinal (depósito) via Asaas com SPLIT para a conta do estabelecimento.
-- Modelo: conta Asaas PF única da plataforma cria a cobrança PIX e repassa via split
-- (fixedValue) para o walletId do estabelecimento; estabelecimento recebe 100% (sem
-- comissão da plataforma). Coexiste com o Mercado Pago atrás da flag DEPOSIT_PROVIDER.
-- Todas as colunas são aditivas (NULL/DEFAULT) — linhas MP existentes seguem válidas.
-- Idempotente (ADD COLUMN IF NOT EXISTS, MariaDB) para re-execução segura.
USE agendamentos;

-- 1) establishment_settings: walletId do estabelecimento + signalConfig estendido.
ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS asaas_wallet_id       VARCHAR(36)  NULL,                 -- walletId Asaas do estabelecimento
  ADD COLUMN IF NOT EXISTS wallet_verified_at    DATETIME     NULL,                 -- setado após 1a cobranca OK; NULL = a validar
  ADD COLUMN IF NOT EXISTS asaas_account_id      VARCHAR(64)  NULL,                 -- White Label (secao 7) — null por ora
  ADD COLUMN IF NOT EXISTS asaas_api_key_ref     VARCHAR(191) NULL,                 -- ref no secret store, NUNCA a chave em claro
  ADD COLUMN IF NOT EXISTS deposit_type          ENUM('PERCENT','FIXED') NOT NULL DEFAULT 'PERCENT',
  ADD COLUMN IF NOT EXISTS deposit_fixed_centavos INT         NULL,                 -- valor fixo do sinal quando type=FIXED
  ADD COLUMN IF NOT EXISTS deposit_min_centavos  INT          NULL,                 -- piso do sinal
  ADD COLUMN IF NOT EXISTS deposit_max_centavos  INT          NULL,                 -- teto do sinal
  ADD COLUMN IF NOT EXISTS refund_window_hours   INT          NOT NULL DEFAULT 24,  -- cancelou antes disso (vs inicio) -> estorna
  ADD COLUMN IF NOT EXISTS retain_on_no_show     TINYINT(1)   NOT NULL DEFAULT 1;

-- 2) appointment_payments: contabilidade do split/fee + percent nullable (sinal FIXED nao tem percentual).
ALTER TABLE appointment_payments
  MODIFY COLUMN percent INT NULL,
  ADD COLUMN IF NOT EXISTS split_centavos                   INT      NULL,          -- repasse ao estabelecimento (fixedValue)
  ADD COLUMN IF NOT EXISTS platform_fee_centavos            INT      NULL,          -- residuo da plataforma (0 por decisao)
  ADD COLUMN IF NOT EXISTS asaas_fee_centavos               INT      NULL,          -- taxa real do Asaas (value - netValue no webhook)
  ADD COLUMN IF NOT EXISTS refunded_at                      DATETIME NULL,
  ADD COLUMN IF NOT EXISTS refund_initiated_by_cancellation TINYINT(1) NOT NULL DEFAULT 0;

-- 3) asaas_webhook_events: reprocesso (desenho 200-always + processed_at/error).
--    payload guarda o corpo do evento para reprocessar sem depender de reenvio do Asaas.
ALTER TABLE asaas_webhook_events
  ADD COLUMN IF NOT EXISTS payload      LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS processed_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS error        TEXT     NULL;
