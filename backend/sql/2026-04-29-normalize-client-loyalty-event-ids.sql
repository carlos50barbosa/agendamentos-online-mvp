ALTER TABLE client_loyalty_subscription_events
  MODIFY COLUMN gateway_event_id VARCHAR(191) NULL,
  ADD INDEX idx_client_loyalty_events_dedupe (
    client_loyalty_subscription_id,
    tipo_evento,
    gateway_event_id
  );
