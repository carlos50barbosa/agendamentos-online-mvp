-- 2026-08-07: janela de agendamento — ate onde no futuro o cliente pode marcar.
--
-- O PROBLEMA (relatado por estabelecimento que trabalha com planos de assinatura): a agenda
-- nao tinha horizonte nenhum. Nem no backend, nem no front — o handleWeekChange aceitava
-- qualquer semana e a semana ainda ia na URL (?week=), entao dava para pular para dezembro
-- digitando. O assinante, que ja pagou a mensalidade e nao tem custo marginal por sessao,
-- marcava o mes inteiro de uma vez e faltava em parte; o horario ficava ocupado e o cliente
-- avulso — que paga por visita — nao achava vaga.
--
-- O MODELO: uma regra so, do estabelecimento, valendo para quem agenda pelo link publico.
--
--   limite = proxima ocorrencia de (janela_abre_dia, janela_abre_hora) no fuso local
--          + (janela_semanas - 1) * 7 dias
--
-- Tudo ANTES do limite e agendavel; dali para frente, fechado. No instante da abertura o
-- limite pula 7 dias e a semana seguinte inteira destrava de uma vez — que e exatamente o
-- "gostaria que ela so abrisse aos domingos" do pedido. Com domingo 00:00 e 1 semana, na
-- quarta o cliente enxerga de quarta a sabado; domingo 00:00 abre Dom-Sab inteira.
--
-- Por que uma ocorrencia fixa no calendario, e nao "N dias rolantes": com janela deslizante
-- de 7 dias o cliente enxerga sempre 7 dias a frente, entao na quarta ele ja alcanca a quarta
-- seguinte. Nunca ha o momento de "abriu a semana", que e o efeito pedido.
--
-- DEFAULT 'livre' de proposito: a coluna nasce desligada para todo mundo. Nenhum
-- estabelecimento existente muda de comportamento com esta migration.
--
-- Aditivo e idempotente (ADD COLUMN IF NOT EXISTS), no mesmo padrao das migrations
-- anteriores desta tabela. Re-executar nao aborta.

-- 'livre' = sem horizonte (comportamento historico). 'semanal' = a formula acima.
ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS janela_modo ENUM('livre','semanal') NOT NULL DEFAULT 'livre';

-- Dia da semana em que a proxima leva abre. 0=domingo ... 6=sabado, o mesmo indice de
-- Date#getDay/getUTCDay e de weekDayIndexInTZ — nao inventamos uma segunda convencao.
ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS janela_abre_dia TINYINT NOT NULL DEFAULT 0;

-- Hora local (0..23) da abertura. Zero = meia-noite, que e o pedido original. Existe como
-- coluna porque abrir 00:00 de domingo deixa o sabado a tarde com quase nada disponivel:
-- mover a abertura para sabado ao meio-dia resolve sem trocar o modelo.
ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS janela_abre_hora TINYINT NOT NULL DEFAULT 0;

-- Quantas semanas ficam abertas a partir da proxima abertura. 1 = so a semana vigente.
-- 2 = o cliente ja enxerga a semana seguinte, para quem achar 1 apertado demais.
ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS janela_semanas TINYINT NOT NULL DEFAULT 1;
