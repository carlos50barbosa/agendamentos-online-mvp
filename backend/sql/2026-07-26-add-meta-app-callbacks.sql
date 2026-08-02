-- Callbacks de app da Meta: desautorização e exclusão de dados.
-- Exigidos para app com permissões avançadas (Embedded Signup do WhatsApp).

-- Quem conectou, na escala do app. O callback de desautorização identifica a pessoa por este id —
-- sem ele não há como saber QUAL conexão desligar, e o callback vira um 200 inútil.
ALTER TABLE wa_accounts
  ADD COLUMN IF NOT EXISTS meta_user_id VARCHAR(64) NULL AFTER business_id;

-- Sem `IF NOT EXISTS`: isso é sintaxe de MariaDB para índice, e a PRODUÇÃO é MariaDB — passou
-- lá e quebrou no MySQL do ambiente local (erro 1064). Como o setup-test-db aborta o arquivo no
-- primeiro erro, a CREATE TABLE abaixo nunca rodava e as CINCO migrations seguintes também não:
-- o banco de teste ficava com schema incompleto sem ninguém perceber.
--
-- Idempotência sem sintaxe específica de engine: em banco novo o índice é criado; em banco que já
-- o tem, o erro 1061 (ER_DUP_KEYNAME) é tolerado pelo setup-test-db. A produção não reexecuta
-- este arquivo — migrate.mjs é forward-only e já o registrou em schema_migrations.
ALTER TABLE wa_accounts
  ADD INDEX idx_wa_accounts_meta_user (meta_user_id);

-- A Meta exige responder com uma URL onde a pessoa acompanhe o pedido, e um código de confirmação.
-- Guardar é o que permite responder essa consulta depois — e é a prova de que o pedido foi atendido.
CREATE TABLE IF NOT EXISTS meta_data_deletion_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  confirmation_code VARCHAR(40) NOT NULL,
  meta_user_id VARCHAR(64) NULL,
  estabelecimento_id INT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'received',   -- received | completed | not_found
  detalhes VARCHAR(255) NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  concluido_em DATETIME(3) NULL,
  UNIQUE KEY uk_meta_deletion_code (confirmation_code),
  INDEX idx_meta_deletion_user (meta_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
