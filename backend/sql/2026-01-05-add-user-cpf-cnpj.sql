-- 2026-01-05: adicionar CPF/CNPJ em usuarios
ALTER TABLE usuarios
  ADD COLUMN cpf_cnpj VARCHAR(20) NULL AFTER data_nascimento;
