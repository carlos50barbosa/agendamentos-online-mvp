-- 2026-08-08: horizonte por DIAS, para quem precisa do oposto da janela semanal.
--
-- A janela nasceu (07/08) para APERTAR o horizonte: estabelecimento de plano de assinatura
-- que queria abrir so a semana vigente. O pedido inverso apareceu em seguida — cliente que
-- precisa deixar marcar meses a frente.
--
-- O QUE IMPEDIA ISSO NAO ERA A JANELA. O wizard publico monta a lista de dias com
-- buildDayRange(new Date(), 14) — 14 dias CRAVADOS no codigo, desde antes da janela existir.
-- Modo 'livre' significava "a janela nao restringe", e mesmo assim o cliente via duas
-- semanas. Ninguem conseguia marcar meses a frente pelo link publico.
--
-- Entao este modo faz duas coisas de uma vez: da nome ao teto que ja existia (14 dias) e o
-- torna configuravel.
--
--   modo 'dias'    -> limite = inicio de HOJE (local) + janela_dias
--   modo 'semanal' -> limite = proxima abertura + (janela_semanas - 1) * 7 dias
--   modo 'livre'   -> sem limite (a lista publica cai no default de 14 dias)
--
-- 'dias' e uma janela DESLIZANTE: o limite anda com o relogio, um dia por dia. E o oposto
-- do 'semanal', que e um portao — fica parado e pula uma semana de uma vez. Por isso os dois
-- coexistem em vez de um parametrizar o outro: quem quer "sempre 90 dias a frente" nao quer
-- que a agenda abra em levas, e quem quer levas nao quer deslizamento diario.
--
-- MODIFY e naturalmente idempotente (reexecutar grava a mesma definicao), e por isso nao
-- precisa da emulacao de IF NOT EXISTS.
ALTER TABLE establishment_settings
  MODIFY COLUMN janela_modo ENUM('livre','semanal','dias') NOT NULL DEFAULT 'livre';

-- Default 14 de proposito: e exatamente o teto que o wizard ja aplicava. Ligar o modo 'dias'
-- sem tocar neste campo nao muda nada para o cliente — o dono sobe o numero quando quiser.
ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS janela_dias SMALLINT NOT NULL DEFAULT 14;
