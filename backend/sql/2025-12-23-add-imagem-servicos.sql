-- Migration: add imagem_url field to servicos
USE agendamentos;

ALTER TABLE servicos
  ADD COLUMN imagem_url VARCHAR(255) NULL AFTER descricao;
