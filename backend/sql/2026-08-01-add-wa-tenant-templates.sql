-- Modelos de mensagem criados na WABA de cada estabelecimento que conecta a própria conta.
--
-- Por que uma tabela e não uma coluna em wa_accounts: cada modelo tem ciclo de vida PRÓPRIO.
-- A criação devolve PENDING e a aprovação chega depois, por webhook (message_template_status_update),
-- um modelo de cada vez. Um deles pode ser recusado enquanto os outros três são aprovados — e aí o
-- envio daquele tipo cai para e-mail sem derrubar o resto.
--
-- O que NÃO entra aqui: os modelos voltados ao DONO (`_estab`). Decidido em 01/08/2026 que avisos ao
-- dono continuam saindo do número global da plataforma — ele é cliente nosso, não do salão. Fazer o
-- salão mandar mensagem para si mesmo não teria sentido.

CREATE TABLE IF NOT EXISTS wa_tenant_templates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,

  estabelecimento_id INT NOT NULL,
  -- Guardado junto porque a WABA pode mudar (desconectar e reconectar com outra conta): sem isto,
  -- não dá para saber a qual conta um modelo aprovado pertence.
  waba_id VARCHAR(64) NOT NULL,

  -- confirm_cli | reminder_cli | cancel_cli | reschedule_cli (lib/wa_template_catalog.js)
  kind VARCHAR(32) NOT NULL,
  name VARCHAR(80) NOT NULL,
  language VARCHAR(16) NOT NULL DEFAULT 'pt_BR',

  meta_template_id VARCHAR(64) NULL,
  -- PENDING | APPROVED | REJECTED | PAUSED | DISABLED — os estados que a Meta usa.
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  rejected_reason VARCHAR(255) NULL,

  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em DATETIME(3) NULL,

  -- Um modelo por tipo, por estabelecimento. É o que torna a criação idempotente: reconectar
  -- atualiza a linha em vez de duplicar.
  UNIQUE KEY uk_wa_tpl_estab_kind (estabelecimento_id, kind),
  -- O webhook de status identifica o modelo pelo nome dentro da WABA; é por aqui que a atualização
  -- encontra a linha.
  INDEX idx_wa_tpl_waba_name (waba_id, name),
  INDEX idx_wa_tpl_status (status),

  CONSTRAINT fk_wa_tpl_estab FOREIGN KEY (estabelecimento_id)
    REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
