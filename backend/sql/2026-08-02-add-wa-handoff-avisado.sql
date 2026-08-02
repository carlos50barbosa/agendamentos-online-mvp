-- Marca de que a mensagem de "atendimento humano em andamento" já foi enviada para este handoff.
--
-- Sem isto, a frase era reenviada a CADA mensagem da cliente enquanto o handoff estivesse aberto.
-- Numa conversa humana de vinte mensagens sobre horário e esmalte, o número do salão injetava a
-- mesma frase vinte vezes, no meio do papo — do número do próprio salão, o que é pior.
--
-- É também a reivindicação atômica do aviso: `UPDATE ... WHERE avisado_em IS NULL` só afeta linha
-- para quem chegar primeiro, então duas mensagens da cliente chegando juntas não geram dois avisos.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS, MariaDB). O setup do banco de teste emula essa cláusula
-- por coluna quando roda no MySQL — ver scripts/setup-test-db.mjs.
ALTER TABLE wa_handoff_queue
  ADD COLUMN IF NOT EXISTS avisado_em DATETIME(3) NULL AFTER assigned_to;
