-- Migration: normaliza usuarios.telefone para E.164-BR (55 + DDD + número)
--
-- Por que: até agora o PUT /auth/me gravava o telefone cru, enquanto cadastro, booking e bot
-- gravavam com o 55. A base ficou com 11 e 13 dígitos para o mesmo dado. O código já foi
-- corrigido (backend/src/lib/phone_br.js é a fonte única); isto acerta o que já está gravado.
--
-- Regra (idêntica à do phone_br.js): decide pelo COMPRIMENTO, nunca por "começa com 55" —
-- 55 também é DDD (Santa Maria/RS). Local = 10 ou 11 dígitos; com país = 12 ou 13.
--
-- Não toca em estabelecimento_perfis.contato_telefone: aquele é um contato de exibição do perfil
-- público, digitado livremente pelo estabelecimento, e não alimenta envio de WhatsApp.
USE agendamentos;

-- 1) Backup dos valores atuais ANTES de qualquer escrita. Se algo sair errado, dá para restaurar:
--    UPDATE usuarios u JOIN usuarios_telefone_backup_20260712 b ON b.id=u.id SET u.telefone=b.telefone_antes;
--    (CREATE ... IF NOT EXISTS AS SELECT não repopula se a tabela já existir → reexecução é segura.)
CREATE TABLE IF NOT EXISTS usuarios_telefone_backup_20260712 AS
SELECT id, telefone AS telefone_antes, NOW() AS copiado_em
FROM usuarios
WHERE telefone IS NOT NULL AND telefone <> '';

-- 2) Número local (10 ou 11 dígitos) -> prefixa o código do país.
--    Inclui o caso do DDD 55: 55999998888 (11) vira 5555999998888, e não fica ambíguo.
UPDATE usuarios
SET telefone = CONCAT('55', REGEXP_REPLACE(REGEXP_REPLACE(telefone, '[^0-9]', ''), '^0+', ''))
WHERE telefone IS NOT NULL
  AND telefone <> ''
  AND CHAR_LENGTH(REGEXP_REPLACE(REGEXP_REPLACE(telefone, '[^0-9]', ''), '^0+', '')) IN (10, 11);

-- 3) Já em E.164 mas com máscara/sujeira ((11) 99999-8888, +55…): guarda só os dígitos.
UPDATE usuarios
SET telefone = REGEXP_REPLACE(REGEXP_REPLACE(telefone, '[^0-9]', ''), '^0+', '')
WHERE telefone IS NOT NULL
  AND telefone <> ''
  AND CHAR_LENGTH(REGEXP_REPLACE(REGEXP_REPLACE(telefone, '[^0-9]', ''), '^0+', '')) IN (12, 13)
  AND REGEXP_REPLACE(REGEXP_REPLACE(telefone, '[^0-9]', ''), '^0+', '') LIKE '55%'
  AND telefone <> REGEXP_REPLACE(REGEXP_REPLACE(telefone, '[^0-9]', ''), '^0+', '');

-- O que NÃO é tocado de propósito: telefones que não caem em 10-13 dígitos (lixo/incompletos).
-- Normalizá-los seria inventar dado. Eles ficam como estão e o app já os trata como ausentes.
-- Para auditar o que sobrou:
--   SELECT id, telefone FROM usuarios
--    WHERE telefone IS NOT NULL AND telefone <> ''
--      AND CHAR_LENGTH(REGEXP_REPLACE(telefone,'[^0-9]','')) NOT IN (12,13);
