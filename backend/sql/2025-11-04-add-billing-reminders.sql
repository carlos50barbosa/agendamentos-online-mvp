-- 2025-11-04: Tabela para registrar lembretes automatizados de cobrança (PIX)

CREATE TABLE IF NOT EXISTS billing_payment_reminders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estabelecimento_id INT NOT NULL,
  due_date DATETIME NOT NULL,
  reminder_kind ENUM('due_soon', 'overdue_grace', 'blocked') NOT NULL,
  channel ENUM('email', 'whatsapp') NOT NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_reminder (estabelecimento_id, due_date, reminder_kind, channel),
  KEY idx_reminder_due (due_date),
  CONSTRAINT fk_billing_reminder_estab FOREIGN KEY (estabelecimento_id)
    REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

