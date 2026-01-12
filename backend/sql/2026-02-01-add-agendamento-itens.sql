-- Migration: add agendamento_itens for multi-servico
USE agendamentos;

CREATE TABLE IF NOT EXISTS agendamento_itens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agendamento_id INT NOT NULL,
  servico_id INT NOT NULL,
  ordem INT NOT NULL DEFAULT 1,
  duracao_min INT NOT NULL DEFAULT 0,
  preco_snapshot INT NOT NULL DEFAULT 0,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agendamento_itens_agendamento (agendamento_id),
  INDEX idx_agendamento_itens_servico (servico_id),
  UNIQUE KEY uniq_agendamento_item_ordem (agendamento_id, ordem),
  CONSTRAINT fk_ag_itens_agendamento FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id) ON DELETE CASCADE,
  CONSTRAINT fk_ag_itens_servico FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO agendamento_itens (agendamento_id, servico_id, ordem, duracao_min, preco_snapshot)
SELECT a.id, a.servico_id, 1,
       COALESCE(s.duracao_min, 0),
       COALESCE(s.preco_centavos, 0)
FROM agendamentos a
JOIN servicos s ON s.id = a.servico_id
LEFT JOIN agendamento_itens ai ON ai.agendamento_id = a.id
WHERE ai.agendamento_id IS NULL;
