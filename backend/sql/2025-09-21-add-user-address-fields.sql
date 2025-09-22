-- Migration: add address fields to usuarios
USE agendamentos;

ALTER TABLE usuarios
  ADD COLUMN cep VARCHAR(8) NULL AFTER telefone,
  ADD COLUMN numero VARCHAR(20) NULL AFTER endereco,
  ADD COLUMN complemento VARCHAR(120) NULL AFTER numero,
  ADD COLUMN bairro VARCHAR(120) NULL AFTER complemento,
  ADD COLUMN cidade VARCHAR(120) NULL AFTER bairro,
  ADD COLUMN estado CHAR(2) NULL AFTER cidade;
