-- Migration: add establishment gallery images table
USE agendamentos;

CREATE TABLE IF NOT EXISTS estabelecimento_imagens (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  titulo VARCHAR(120) NULL,
  descricao VARCHAR(255) NULL,
  ordem INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_est_imagens_estab (estabelecimento_id),
  CONSTRAINT fk_estab_imagem_estabelecimento FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
