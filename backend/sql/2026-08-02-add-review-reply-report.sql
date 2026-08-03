-- Resposta do dono e denúncia de avaliação.
--
-- Por que existe: até aqui uma avaliação era via de mão única. O dono não respondia, não
-- denunciava e não ocultava — um comentário difamatório ficava na página pública dele
-- indefinidamente, e a única saída era alguém mexer no banco à mão.
--
-- Denúncia mora em COLUNA e não em tabela própria porque só o dono denuncia, e há um dono por
-- estabelecimento: no máximo uma denúncia por avaliação. Uma tabela N:1 aqui seria estrutura
-- para um caso que não existe.
--
-- A denúncia NÃO esconde nada sozinha. Ela registra para o suporte avaliar — sumir com
-- avaliação verdadeira por reclamação do avaliado é o abuso que este campo precisa evitar.

ALTER TABLE estabelecimento_reviews
  ADD COLUMN IF NOT EXISTS resposta TEXT NULL AFTER comentario;

ALTER TABLE estabelecimento_reviews
  ADD COLUMN IF NOT EXISTS resposta_em DATETIME NULL AFTER resposta;

ALTER TABLE estabelecimento_reviews
  ADD COLUMN IF NOT EXISTS denuncia_motivo VARCHAR(255) NULL AFTER resposta_em;

ALTER TABLE estabelecimento_reviews
  ADD COLUMN IF NOT EXISTS denunciado_em DATETIME NULL AFTER denuncia_motivo;
