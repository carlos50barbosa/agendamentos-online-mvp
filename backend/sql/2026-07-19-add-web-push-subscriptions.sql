-- Assinaturas de Web Push (PWA instalado na home screen).
--
-- Uma linha = um NAVEGADOR, nao um usuario. O mesmo dono pode ter o app no
-- celular e no desktop e espera receber nos dois; por isso nao ha unique em
-- usuario_id.
--
-- endpoint_hash existe porque o endpoint e uma URL longa do push service
-- (FCM/Mozilla/WNS) e cabe mal num indice. O SHA-256 e o que garante que
-- reinscrever o mesmo navegador faz UPDATE em vez de duplicar linha.
--
-- Sem FK para usuarios: o resto do schema tambem nao usa, e a limpeza de
-- assinatura morta ja acontece naturalmente quando o push service devolve
-- 404/410 (ver lib/web_push.js).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT NOT NULL,
  endpoint VARCHAR(512) NOT NULL,
  endpoint_hash CHAR(64) NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_success_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_subscriptions_endpoint (endpoint_hash),
  KEY idx_push_subscriptions_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
