-- Migration: add profissionais table and relations
USE agendamentos;

CREATE TABLE IF NOT EXISTS profissionais (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  nome VARCHAR(120) NOT NULL,
  descricao TEXT NULL,
  avatar_url VARCHAR(255) NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_profissionais_estab (estabelecimento_id),
  CONSTRAINT fk_profissionais_estab FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS servico_profissionais (
  servico_id INT NOT NULL,
  profissional_id INT NOT NULL,
  PRIMARY KEY (servico_id, profissional_id),
  INDEX idx_servico_prof_prof (profissional_id),
  CONSTRAINT fk_servico_prof_servico FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE,
  CONSTRAINT fk_servico_prof_prof FOREIGN KEY (profissional_id) REFERENCES profissionais(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE agendamentos
  ADD COLUMN profissional_id INT NULL AFTER servico_id;

ALTER TABLE agendamentos
  ADD INDEX idx_ag_profissional (profissional_id);

ALTER TABLE agendamentos
  ADD CONSTRAINT fk_ag_profissional FOREIGN KEY (profissional_id) REFERENCES profissionais(id) ON DELETE SET NULL;
