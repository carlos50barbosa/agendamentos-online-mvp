-- Migration: add descricao field to servicos
USE agendamentos;

ALTER TABLE servicos
  ADD COLUMN descricao TEXT NULL AFTER nome;

