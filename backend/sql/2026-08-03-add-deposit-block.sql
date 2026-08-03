-- Duas coisas nascidas do mesmo incidente (03/08/2026, salaodebelza).
--
-- O QUE ACONTECEU: o salão ligou o sinal com a subconta Asaas criada mas NÃO liberada (falta a
-- validação de documentos, sem a qual o Asaas não emite chave PIX). Cada agendamento pelo link
-- criava a reserva, falhava ao gerar o PIX, cancelava a reserva e devolvia 502 ao cliente com
-- "tente novamente" — que nunca ia funcionar, porque a causa é estrutural. O salão perdeu todo
-- agendamento do período e não tinha como saber: nada avisava o dono.

-- (1) BLOQUEIO DE RECEBIMENTO
--
-- Não dá para perguntar ao Asaas se a conta está liberada: a plataforma descarta a API key da
-- subconta de propósito (ver services/asaas/accounts.js — guardá-la seria poder movimentar o
-- dinheiro do salão). Então a descoberta é REATIVA: quando uma cobrança falha por causa
-- estrutural, grava-se aqui; quando uma passa, limpa-se. É o que alimenta o aviso no painel.
ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS deposit_block_reason VARCHAR(255) NULL;

ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS deposit_blocked_at DATETIME NULL;
