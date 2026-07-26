-- Aceite dos Termos no momento de conectar o WhatsApp.
--
-- Os Tech Provider Terms da Meta (Sec. 5) exigem que as proibicoes estejam no contrato COM O CLIENTE.
-- Subir a versao dos Termos nao resolve: `termsVersion` so e' enviado no cadastro, e nao ha reaceite —
-- os estabelecimentos ja cadastrados seguem vinculados ao texto antigo, que nao tem as proibicoes.
-- Por isso o aceite e' coletado exatamente onde a obrigacao nasce: na conexao.
--
-- Fica em wa_accounts (e nao numa tabela nova) porque o aceite pertence a CONEXAO: desconectou e
-- reconectou, aceita de novo, e a versao vigente naquele momento fica registrada.
ALTER TABLE wa_accounts
  ADD COLUMN IF NOT EXISTS terms_version VARCHAR(32) NULL AFTER meta_user_id;

ALTER TABLE wa_accounts
  ADD COLUMN IF NOT EXISTS terms_accepted_at DATETIME(3) NULL AFTER terms_version;

-- IP de quem aceitou. Mesma logica da trilha de opt-in: prova de quando e de onde.
ALTER TABLE wa_accounts
  ADD COLUMN IF NOT EXISTS terms_accepted_ip VARCHAR(64) NULL AFTER terms_accepted_at;
