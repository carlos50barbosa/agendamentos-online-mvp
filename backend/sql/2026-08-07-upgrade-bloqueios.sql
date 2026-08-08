-- 2026-08-07: bloqueio de horários vira uma feature de verdade.
--
-- O QUE EXISTIA: a tabela `bloqueios` (id, estabelecimento_id, inicio, fim) e um único
-- POST /slots/toggle que criava janelas FIXAS de 30 minutos, sem tela nenhuma no painel
-- (o wrapper Api.toggleSlot estava morto no frontend). Pior: o bloqueio era COSMÉTICO —
-- só o GET /slots lia a tabela, para pintar o slot como indisponível na grade. Nenhum dos
-- caminhos de escrita de agendamento consultava `bloqueios`, então um POST direto (ou uma
-- corrida entre carregar a grade e confirmar) agendava por cima do horário bloqueado.
--
-- O QUE MUDA AQUI: o dono passa a bloquear um intervalo livre ("fecho das 12h às 14h",
-- "viagem na semana que vem"), opcionalmente de UM profissional só, com um motivo que é
-- nota interna dele — o motivo NUNCA é devolvido a quem está agendando.
--
-- `profissional_id` NULL continua significando "o estabelecimento inteiro"; preenchido,
-- o bloqueio atinge somente agendamentos daquele profissional. É essa coluna que permite
-- o salão fechar a agenda de uma manicure sem fechar a do cabeleireiro.
--
-- Aditivo e idempotente: ADD COLUMN IF NOT EXISTS (MariaDB — o setup do banco de teste
-- emula a cláusula por coluna, ver scripts/setup-test-db.mjs) e information_schema para
-- índice/FK, que não aceitam IF NOT EXISTS de forma confiável. Re-executar não aborta.
SET @db := DATABASE();

ALTER TABLE bloqueios
  ADD COLUMN IF NOT EXISTS profissional_id INT NULL AFTER estabelecimento_id;

-- Nota interna do dono ("dentista", "viagem"). 180 chars é o limite validado na API.
ALTER TABLE bloqueios
  ADD COLUMN IF NOT EXISTS motivo VARCHAR(180) NULL;

-- Só marca a INTENÇÃO de "dia inteiro"; o intervalo real continua em inicio/fim, já
-- expandido para 00:00 do dia local até 00:00 do dia seguinte. Assim toda a checagem de
-- sobreposição segue sendo uma comparação de instantes, sem caso especial.
ALTER TABLE bloqueios
  ADD COLUMN IF NOT EXISTS dia_inteiro TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE bloqueios
  ADD COLUMN IF NOT EXISTS criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- O índice antigo (estabelecimento_id, inicio) não cobre a busca por sobreposição, que
-- filtra pelas DUAS pontas (inicio < fim_pedido AND fim > inicio_pedido). Com `fim` no
-- índice o SELECT ... FOR UPDATE de cada agendamento criado deixa de varrer a faixa toda.
SELECT COUNT(*)
INTO @idx_blk_estab_range
FROM information_schema.statistics
WHERE table_schema=@db AND table_name='bloqueios' AND index_name='idx_blk_estab_range';
SET @sql := IF(@idx_blk_estab_range=0,
  'CREATE INDEX idx_blk_estab_range ON bloqueios (estabelecimento_id, inicio, fim)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- CASCADE (e não SET NULL): profissional removido levaria seus bloqueios a virar bloqueio
-- do estabelecimento inteiro, fechando a agenda de todo mundo em silêncio.
SELECT COUNT(*)
INTO @fk_blk_profissional
FROM information_schema.table_constraints
WHERE constraint_schema=@db AND table_name='bloqueios' AND constraint_name='fk_blk_profissional';
SET @sql := IF(@fk_blk_profissional=0,
  'ALTER TABLE bloqueios
     ADD CONSTRAINT fk_blk_profissional
       FOREIGN KEY (profissional_id) REFERENCES profissionais(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
