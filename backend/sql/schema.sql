-- Criar o banco de dados
CREATE DATABASE IF NOT EXISTS agendamentos
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;

-- Usar o banco
USE agendamentos;

-- Tabela de usuários (clientes e estabelecimentos)
CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  senha_hash VARCHAR(200) NOT NULL,
  tipo ENUM('cliente','estabelecimento') NOT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de serviços (somente para estabelecimentos)
CREATE TABLE IF NOT EXISTS servicos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  nome VARCHAR(120) NOT NULL,
  duracao_min INT NOT NULL,
  preco_centavos INT DEFAULT 0,
  ativo TINYINT(1) DEFAULT 1,
  FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Tabela de agendamentos
CREATE TABLE IF NOT EXISTS agendamentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  estabelecimento_id INT NOT NULL,
  servico_id INT NOT NULL,
  inicio DATETIME NOT NULL,
  fim DATETIME NOT NULL,
  status ENUM('confirmado','cancelado') NOT NULL DEFAULT 'confirmado',
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE,
  INDEX (estabelecimento_id, inicio),
  INDEX (cliente_id, inicio)
);

-- Tabela para bloqueios de horários (slots indisponíveis)
CREATE TABLE IF NOT EXISTS bloqueios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  inicio DATETIME NOT NULL,
  fim DATETIME NOT NULL,
  FOREIGN KEY (estabelecimento_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX (estabelecimento_id, inicio)
);

-- ================================
-- DADOS DE TESTE
-- ================================

-- Senha hash gerada com bcrypt (senha = "123456")
-- Você pode gerar novas hashes se quiser.
INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES
('João da Silva', 'cliente1@example.com', '$2a$10$uIYpQ6vFqP5QGxYVfOx2eO1XoMzziEtGlUZEM6IuEIu2qZ/3h2c5e', 'cliente'),
('Maria Souza', 'cliente2@example.com', '$2a$10$uIYpQ6vFqP5QGxYVfOx2eO1XoMzziEtGlUZEM6IuEIu2qZ/3h2c5e', 'cliente'),
('Salão Beleza VIP', 'estab1@example.com', '$2a$10$uIYpQ6vFqP5QGxYVfOx2eO1XoMzziEtGlUZEM6IuEIu2qZ/3h2c5e', 'estabelecimento'),
('Clínica Saúde Total', 'estab2@example.com', '$2a$10$uIYpQ6vFqP5QGxYVfOx2eO1XoMzziEtGlUZEM6IuEIu2qZ/3h2c5e', 'estabelecimento');

-- Serviços para os estabelecimentos
INSERT INTO servicos (estabelecimento_id, nome, duracao_min, preco_centavos, ativo) VALUES
(3, 'Corte de Cabelo', 30, 5000, 1),
(3, 'Manicure', 45, 3500, 1),
(4, 'Consulta Geral', 60, 12000, 1),
(4, 'Exame de Rotina', 30, 8000, 1);

-- Agendamentos (alguns confirmados e cancelados)
INSERT INTO agendamentos (cliente_id, estabelecimento_id, servico_id, inicio, fim, status) VALUES
(1, 3, 1, '2025-08-11 10:00:00', '2025-08-11 10:30:00', 'confirmado'),
(2, 3, 2, '2025-08-11 11:00:00', '2025-08-11 11:45:00', 'confirmado'),
(1, 4, 3, '2025-08-12 14:00:00', '2025-08-12 15:00:00', 'cancelado');

-- Bloqueios de horários (exemplo)
INSERT INTO bloqueios (estabelecimento_id, inicio, fim) VALUES
(3, '2025-08-13 09:00:00', '2025-08-13 09:30:00');
