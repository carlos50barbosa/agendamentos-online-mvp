-- 2026-08-20: liberar, por estabelecimento, o mesmo servico duas vezes no mesmo dia.
--
-- CONTEXTO: a regra "o cliente nao repete o mesmo servico no mesmo dia" subiu no commit a2951a6
-- valendo para todo mundo, sem chave. O dono pediu que fosse opcional: ha negocio em que repetir
-- o mesmo servico no dia e normal, e nesses a recusa e um estorvo, nao uma protecao.
--
-- O MODELO: a regra continua sendo o PADRAO (a coluna nasce 0 = nao permite repetir), porque
-- repetir servico no mesmo dia e quase sempre engano do cliente. Quem quiser liberar, libera.
--
--   bloqueia quando  permite_servico_repetido_dia = 0  E  o cliente ja tem o servico naquele dia
--
-- Repare que o DEFAULT aqui e o INVERSO do da trava diaria (limite_diario_ativo DEFAULT 0, que
-- nasce desligada). Nao e incoerencia: sao perguntas de natureza diferente. "Quantos horarios uma
-- pessoa pode ocupar num dia" e politica comercial, e ligar isso sem o dono pedir mudaria a regra
-- do negocio dele. "Marcar o mesmo servico duas vezes no dia" e quase sempre erro de quem agenda,
-- e o padrao seguro e recusar -- com a saida a um clique para quem precisa do contrario.
--
-- A REGRA IRMA DE SOBREPOSICAO NAO GANHA CHAVE. Dois horarios do mesmo cliente que se cruzam sao
-- impossiveis de cumprir, com qualquer profissional; nao ha negocio em que isso seja desejado. Se
-- um dia parecer que ha, o caso real e outro (familia compartilhando um cadastro) e a saida ja
-- existe: o estabelecimento marca pelo painel, que e isento de todas as regras de cliente.
--
-- Aditiva e idempotente (ADD COLUMN IF NOT EXISTS), no mesmo padrao das migrations anteriores
-- desta tabela. Re-executar nao aborta.

-- 0 = a regra vale (padrao). 1 = o cliente pode marcar o mesmo servico mais de uma vez no dia.
ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS permite_servico_repetido_dia TINYINT(1) NOT NULL DEFAULT 0;
