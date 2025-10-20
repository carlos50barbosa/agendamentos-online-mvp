-- Migration: add establishment profile, reviews and favorites tables
USE agendamentos;

CREATE TABLE IF NOT EXISTS estabelecimento_perfis (
  estabelecimento_id INT PRIMARY KEY,
  sobre TEXT NULL,
  contato_email VARCHAR(160) NULL,
  contato_telefone VARCHAR(20) NULL,
  site_url VARCHAR(255) NULL,
  instagram_url VARCHAR(255) NULL,
  facebook_url VARCHAR(255) NULL,
  linkedin_url VARCHAR(255) NULL,
  youtube_url VARCHAR(255) NULL,
  tiktok_url VARCHAR(255) NULL,
  horarios_json TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_estab_perfil_estabelecimento FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS estabelecimento_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  cliente_id INT NOT NULL,
  nota TINYINT NOT NULL,
  comentario TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_estab_review (estabelecimento_id, cliente_id),
  INDEX idx_reviews_estab (estabelecimento_id),
  INDEX idx_reviews_cliente (cliente_id),
  CONSTRAINT fk_reviews_estabelecimento FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_cliente FOREIGN KEY (cliente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT chk_reviews_nota CHECK (nota BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS cliente_favoritos (
  cliente_id INT NOT NULL,
  estabelecimento_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cliente_id, estabelecimento_id),
  INDEX idx_favoritos_estab (estabelecimento_id),
  CONSTRAINT fk_favoritos_cliente FOREIGN KEY (cliente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_favoritos_estabelecimento FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
