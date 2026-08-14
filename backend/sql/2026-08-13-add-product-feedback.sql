-- Feedback sobre o PRODUTO — não confundir com `estabelecimento_reviews`.
--
-- `estabelecimento_reviews` é o cliente final avaliando o negócio do nosso cliente: nota pública,
-- com resposta do dono, que vive na página do estabelecimento. Nada ali fala sobre a plataforma.
-- Esta tabela é o outro lado: o que o DONO (e o visitante que não virou dono) acha da plataforma.
-- Nunca é público, nunca aparece na página de ninguém.
--
-- Uma tabela só para os quatro canais (cancelamento, downgrade, NPS, pesquisa da landing) porque
-- todos respondem à mesma pergunta operacional — "por que essa pessoa não está feliz / não ficou?"
-- — e quase sempre são lidos juntos, na mesma janela de tempo. Quatro tabelas com três colunas
-- iguais só dariam quatro JOINs para montar o mesmo relatório.

CREATE TABLE IF NOT EXISTS product_feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  -- 'cancelamento' | 'downgrade' | 'nps' | 'landing'. VARCHAR e não ENUM: canal novo aqui é
  -- rotina (amanhã tem CSAT pós-onboarding), e cada canal novo num ENUM é um ALTER que reescreve
  -- a tabela. A lista válida mora em lib/product_feedback.js, onde dá para testar.
  tipo VARCHAR(32) NOT NULL,
  -- Código da opção escolhida ('preco', 'sem_uso', ...). NULL no NPS, que só tem nota + texto.
  motivo VARCHAR(48) NULL,
  -- 0..10 do NPS. NULL nos demais canais.
  nota TINYINT NULL,
  comentario TEXT NULL,
  -- NULL = anônimo. É o caso normal da pesquisa da landing: quem responde ali ainda não tem conta.
  usuario_id INT NULL,
  -- Plano no momento da resposta, congelado. Ler de `usuarios` na hora do relatório responderia
  -- "qual plano ele tem HOJE" — e depois de um cancelamento isso é justamente o que mudou.
  plano VARCHAR(32) NULL,
  -- Onde a pessoa estava (rota, seção). Distingue "achei caro" na /planos de "achei caro" na
  -- hora de cancelar, que são duas conversas diferentes.
  contexto VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_feedback_tipo_data (tipo, created_at),
  INDEX idx_feedback_usuario (usuario_id),
  -- SET NULL, e não CASCADE, de propósito: quando alguém apaga a conta, o motivo pelo qual saiu é
  -- exatamente o dado que não pode sumir junto. CASCADE apagaria a resposta na hora em que ela
  -- passa a valer mais. De quebra a linha vira anônima sozinha, que é o que a LGPD pede.
  CONSTRAINT fk_feedback_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT chk_feedback_nota CHECK (nota IS NULL OR nota BETWEEN 0 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
