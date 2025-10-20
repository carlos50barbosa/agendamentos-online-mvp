ALTER TABLE usuarios
  ADD COLUMN notify_email_estab TINYINT(1) NOT NULL DEFAULT 1 AFTER telefone,
  ADD COLUMN notify_whatsapp_estab TINYINT(1) NOT NULL DEFAULT 1 AFTER notify_email_estab;

UPDATE usuarios
   SET notify_email_estab = 1,
       notify_whatsapp_estab = 1
 WHERE tipo = 'estabelecimento' AND notify_email_estab IS NULL;

