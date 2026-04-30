ALTER TABLE client_loyalty_subscription_events
  MODIFY COLUMN ignored_reason VARCHAR(191) NULL;

ALTER TABLE mercadopago_webhook_events
  MODIFY COLUMN ignored_reason VARCHAR(191) NULL;
