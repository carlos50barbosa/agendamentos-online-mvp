-- 2026-07-13: usuarios.avatar_url — a coluna que existia em producao e em nenhum .sql.
--
-- Encontrada pelo smoke test (tests/smoke-routes.test.js), que constroi o banco DO ZERO a
-- partir deste diretorio. O resultado foi 401 em toda rota autenticada: o middleware de
-- auth faz `SELECT ..., avatar_url, ... FROM usuarios`, a coluna nao existia no banco
-- recem-criado, e o catch do auth transforma qualquer erro em token_invalid.
--
-- Ou seja: um ambiente novo levantado a partir do repositorio nascia com o LOGIN QUEBRADO.
-- A coluna foi adicionada em producao na mao, sem virar migration. Este arquivo fecha a
-- lacuna e deixa o repo capaz de reconstruir o schema de producao.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS, MariaDB): producao ja tem a coluna, entao
-- re-executar e seguro. Em MySQL a clausula e emulada por scripts/setup-test-db.mjs.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(255) NULL;
