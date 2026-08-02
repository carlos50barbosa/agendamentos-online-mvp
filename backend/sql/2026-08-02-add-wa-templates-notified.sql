-- Marca de que o dono já foi avisado de que os modelos do WhatsApp dele foram liberados.
--
-- Por que uma coluna e não deduzir do estado: "todos aprovados" é verdade para sempre depois que
-- acontece, e o webhook de status chega uma vez POR MODELO. Sem a marca, cada evento posterior
-- (mudança de qualidade, pausa e volta) reenviaria o mesmo "está liberado".
--
-- Fica em wa_accounts, e não em wa_tenant_templates, porque o aviso é UM por conexão, não por
-- modelo. É também o que dá a reivindicação atômica: o UPDATE ... WHERE ... IS NULL só afeta linha
-- para quem chegar primeiro, então dois webhooks simultâneos não geram dois e-mails.
--
-- Volta a NULL quando os modelos são provisionados de novo (reconexão): conexão nova, aviso novo.
-- Idempotente (ADD COLUMN IF NOT EXISTS, MariaDB). O setup do banco de teste emula essa cláusula
-- por coluna quando roda no MySQL — ver scripts/setup-test-db.mjs.
ALTER TABLE wa_accounts
  ADD COLUMN IF NOT EXISTS templates_ready_notified_at DATETIME(3) NULL AFTER last_sync_at;
