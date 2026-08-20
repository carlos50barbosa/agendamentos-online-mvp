-- Prova de posse do número por mensagem RECEBIDA, para o "ver todos os meus agendamentos".
--
-- Por que não é OTP: a categoria AUTHENTICATION da Meta é bloqueada por elegibilidade (verificação
-- de empresa MAIS um scaling path — na prática, milhares de mensagens iniciadas pelo negócio em 30
-- dias). Esta conta faz duas ordens de grandeza menos que isso, então o template de código não sai.
-- Fora da janela de 24h — que é sempre o caso de quem pede acesso — texto livre não é entregue.
--
-- E, mesmo se saísse, a inversão é melhor: um código prova quem tem ACESSO AO APARELHO; uma
-- mensagem ENVIADA daquele número prova quem é DONO dele. É o mesmo raciocínio já escrito em
-- whatsapp/inbound/optInConfirm.js para o AUTORIZO, e a mesma infra de inbound.
--
-- O código aqui NÃO é segredo forte, é um correlacionador: ele liga a mensagem que chegou à ABA que
-- está esperando. Sem ele saberíamos que "alguém mandou MEUS AGENDAMENTOS", sem saber qual navegador
-- destravar. Guardado como sha256 para permitir busca direta no inbound (bcrypt exigiria varrer
-- todas as pendentes) e para não deixar em claro algo que abre sessão.

CREATE TABLE IF NOT EXISTS wa_link_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  -- Identificador que volta para o navegador. É por ele que a aba pergunta "já chegou?".
  request_id VARCHAR(64) NOT NULL UNIQUE,
  code_hash CHAR(64) NOT NULL,
  -- Preenchidos quando a mensagem chega. `wamid` é a prova registrada pela Meta, igual ao AUTORIZO.
  telefone_e164 VARCHAR(20) NULL,
  wamid VARCHAR(128) NULL,
  confirmado_em DATETIME NULL,
  -- Token entregue uma vez só: reabrir a mesma URL não deve render sessão nova.
  consumido_em DATETIME NULL,
  expires_at DATETIME NOT NULL,
  ip_addr VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_wa_link_code (code_hash),
  INDEX idx_wa_link_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
