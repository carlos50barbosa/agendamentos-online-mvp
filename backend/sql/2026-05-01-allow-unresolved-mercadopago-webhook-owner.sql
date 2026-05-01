ALTER TABLE mercadopago_webhook_events
  MODIFY COLUMN owner_type ENUM('platform','establishment','unresolved') NOT NULL;
