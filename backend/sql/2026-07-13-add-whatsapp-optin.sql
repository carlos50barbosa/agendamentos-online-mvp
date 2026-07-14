-- Migration: consentimento (opt-in) para receber mensagens no WhatsApp.
--
-- Contexto: a WABA da plataforma foi desabilitada pela Meta por "violação dos Termos de Uso
-- Aceitável". O projeto nunca coletou opt-in: bastava o cliente digitar o telefone para agendar e
-- ele passava a receber template message de um número que nunca autorizou. É a causa mais comum
-- desse banimento — o destinatário bloqueia/denuncia, a nota de qualidade cai, a Meta desabilita.
--
-- A Meta exige que o consentimento seja ATIVO, nomeie o remetente e o canal, e seja COMPROVÁVEL.
-- Por isso a tabela guarda o TEXTO EXATO que a pessoa leu, e não um booleano: um `aceitou=1` não
-- prova nada num recurso. Guarda também de onde veio o aceite, o IP e o user agent.
--
-- Append-only: cada linha é um EVENTO ('granted'/'revoked'), nunca um UPDATE. O estado atual de um
-- telefone é o último evento dele. Isso preserva o histórico de quem aceitou, saiu e voltou — que é
-- exatamente o que se precisa mostrar quando a Meta pergunta "por que você mandou para este
-- número em tal data?".
--
-- Sem FK para `usuarios`: a prova do consentimento tem de sobreviver à exclusão da conta (inclusive
-- a exclusão pedida por LGPD, que apaga o cadastro mas não pode apagar o registro de que houve
-- consentimento). Mesmo motivo pelo qual `audit_log.ator_id` também não tem FK.
--
-- A chave é o TELEFONE, não o usuario_id: quem a Meta autoriza (ou não) a receber mensagem é um
-- número, não uma conta. O mesmo número pode trocar de dono ou aparecer em cadastros diferentes.
USE agendamentos;

CREATE TABLE IF NOT EXISTS whatsapp_optins (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,

  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  -- E.164-BR sem o "+": 55 + DDD + número (12 ou 13 dígitos). Mesmo formato de `usuarios.telefone`,
  -- normalizado por lib/phone_br.js. Guardar em outro formato aqui quebraria a consulta do envio.
  telefone_e164 VARCHAR(20) NOT NULL,

  evento VARCHAR(16) NOT NULL,              -- granted | revoked

  -- Contexto de quem aceitou. Ambos podem ser NULL (aceite anônimo no agendamento público, ou
  -- revogação que chega pelo WhatsApp sem sessão).
  usuario_id BIGINT NULL,
  estabelecimento_id BIGINT NULL,

  origem VARCHAR(32) NOT NULL,              -- agendamento_publico | agendamento_cliente | cadastro | whatsapp_parar | painel_cliente

  -- A prova. `texto` é o que a pessoa efetivamente leu, renderizado pelo servidor (nunca o que o
  -- cliente HTTP mandou), e `texto_versao` permite saber qual redação estava no ar naquele dia.
  texto_versao VARCHAR(16) NULL,
  texto TEXT NULL,

  ip VARCHAR(64) NULL,
  user_agent VARCHAR(256) NULL,

  -- Consulta do caminho quente (a cada envio): último evento deste telefone.
  --   WHERE telefone_e164=? ORDER BY id DESC LIMIT 1
  -- O índice composto resolve com uma varredura reversa do prefixo — sem filesort.
  INDEX idx_wa_optin_telefone (telefone_e164, id),
  INDEX idx_wa_optin_usuario (usuario_id, id),
  INDEX idx_wa_optin_criado_em (criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
