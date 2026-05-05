USE agendamentos;

ALTER TABLE servicos
  ADD COLUMN capacidade_por_horario INT NOT NULL DEFAULT 1 AFTER preco_centavos;

UPDATE servicos
   SET capacidade_por_horario = 1
 WHERE capacidade_por_horario IS NULL
    OR capacidade_por_horario < 1;

ALTER TABLE agendamentos
  ADD INDEX idx_ag_capacity_lookup (
    estabelecimento_id,
    servico_id,
    profissional_id,
    inicio,
    status
  );
