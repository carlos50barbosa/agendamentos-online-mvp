-- Migration: trilha de auditoria (quem fez o quê, de onde, com que resultado)
--
-- Tabela nova em vez de reaproveitar `auditoria` (2025-12-29): aquela nasceu para um fluxo de
-- protocolo/e-mail, nunca foi usada por nenhuma linha de src/, e não tem como responder as
-- perguntas de auditoria (de qual IP? qual request? o que havia antes?).
--
-- `request_id` amarra cada linha ao access log HTTP correspondente.
-- `dados_antes`/`dados_depois` guardam apenas os campos que mudaram, já com segredos removidos.
USE agendamentos;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,

  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  request_id VARCHAR(128) NULL,

  -- Ator: quem executou. NULL em ação anônima (login falho, webhook, request público).
  ator_id BIGINT NULL,
  ator_tipo VARCHAR(32) NULL,          -- cliente | estabelecimento | admin | sistema | anonimo
  ator_email VARCHAR(255) NULL,        -- snapshot: e-mail do ator no momento do ato

  -- Ação e alvo.
  acao VARCHAR(64) NOT NULL,           -- ex.: auth.login, auth.login_failed, servico.delete
  entidade VARCHAR(64) NULL,           -- ex.: usuario, servico, agendamento, plano
  entidade_id VARCHAR(64) NULL,
  estabelecimento_id BIGINT NULL,      -- tenant afetado, quando aplicável

  -- Resultado.
  resultado VARCHAR(16) NOT NULL DEFAULT 'sucesso',  -- sucesso | falha | negado
  status_http SMALLINT UNSIGNED NULL,
  motivo VARCHAR(255) NULL,            -- por que falhou/foi negado

  -- Origem.
  metodo VARCHAR(10) NULL,
  rota VARCHAR(255) NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(256) NULL,

  -- Detalhe (JSON serializado, já sanitizado — nunca contém senha/token/cartão).
  dados_antes TEXT NULL,
  dados_depois TEXT NULL,
  metadados TEXT NULL,

  INDEX idx_audit_criado_em (criado_em),
  INDEX idx_audit_ator (ator_id, criado_em),
  INDEX idx_audit_acao (acao, criado_em),
  INDEX idx_audit_entidade (entidade, entidade_id),
  INDEX idx_audit_estabelecimento (estabelecimento_id, criado_em),
  INDEX idx_audit_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
