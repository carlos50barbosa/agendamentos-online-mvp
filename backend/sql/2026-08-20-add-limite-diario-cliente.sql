-- 2026-08-20: trava opcional de agendamentos do mesmo cliente no mesmo dia.
--
-- O PROBLEMA: o cliente marca dois ou tres horarios do mesmo dia "para garantir" e aparece em
-- um. Os outros ficam ocupados ate a hora passar, e ninguem mais consegue pegar. O dono ve a
-- agenda cheia e o dia vazio. Caso que motivou (19/08/2026, estabelecimento 194): a mesma
-- pessoa marcou 16:00 e 16:30 com 57 segundos de diferenca, tendo refeito o agendamento por
-- achar que o primeiro nao tinha dado certo.
--
-- O MODELO: uma regra do estabelecimento, valendo para quem marca pelo lado do CLIENTE (link
-- publico, bot do WhatsApp e cliente logado). O dono NAO e limitado ao criar pelo painel — o
-- encaixe de balcao e dele, do mesmo jeito que a janela de agendamento so vale para o cliente.
--
--   bloqueia quando  (agendamentos vivos do cliente naquele dia) >= limite_diario_max
--
-- Por que DUAS colunas e nao so um booleano: "quantos" depende do negocio. Salao de unha em que
-- a cliente faz mao e pe em sessoes separadas quer 2; barbearia quer 1. Com uma coluna so, o
-- segundo caso viraria pedido de feature na semana seguinte. O liga/desliga continua sendo o
-- controle principal na tela; o numero so aparece quando esta ligado.
--
-- DEFAULT DESLIGADO de proposito: a coluna nasce off para todo mundo. Nenhum estabelecimento
-- existente muda de comportamento com esta migration, e ninguem descobre a trava por um cliente
-- reclamando que nao consegue marcar.
--
-- Sobre "no mesmo dia": `agendamentos.inicio` e DATETIME em hora de PAREDE local (medido e
-- documentado em backend/src/lib/datetime_tz.js), entao a contagem compara com limites locais
-- montados em JS. Nao ha CONVERT_TZ nem DATE(inicio)=CURDATE() em lugar nenhum desta feature:
-- os dois deslocam o dia em 3 horas.
--
-- O indice de que a contagem precisa JA EXISTE: idx_ag_estab_cliente_inicio
-- (estabelecimento_id, cliente_id, inicio), criado em sql/schema.sql. Esta migration nao cria
-- indice nenhum.
--
-- Aditiva e idempotente (ADD COLUMN IF NOT EXISTS), no mesmo padrao das migrations anteriores
-- desta tabela. Re-executar nao aborta.

-- 0 = desligado (comportamento historico). 1 = a trava vale para os caminhos do cliente.
ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS limite_diario_ativo TINYINT(1) NOT NULL DEFAULT 0;

-- Quantos agendamentos o mesmo cliente pode ter no mesmo dia quando a trava esta ligada.
-- 1 = o pedido original ("travar dois agendamentos no mesmo dia"). So tem efeito com
-- limite_diario_ativo = 1; sozinha, esta coluna nao liga nada.
ALTER TABLE establishment_settings
  ADD COLUMN IF NOT EXISTS limite_diario_max TINYINT NOT NULL DEFAULT 1;
