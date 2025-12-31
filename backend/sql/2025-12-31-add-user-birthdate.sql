-- Migration: add data_nascimento to usuarios
USE agendamentos;

ALTER TABLE usuarios
  ADD COLUMN data_nascimento DATE NULL AFTER telefone;
