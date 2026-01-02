CREATE TABLE IF NOT EXISTS billing_plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  price_cents INT NOT NULL DEFAULT 0,
  max_professionals INT NULL,
  included_wa_messages INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS billing_addon_packs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  price_cents INT NOT NULL DEFAULT 0,
  wa_messages INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO billing_plans (code, name, price_cents, max_professionals, included_wa_messages)
VALUES
  ('starter', 'Starter', 1490, 2, 250),
  ('pro', 'Pro', 2990, 5, 500),
  ('premium', 'Premium', 9990, 10, 1500)
ON DUPLICATE KEY UPDATE
  name=VALUES(name),
  price_cents=VALUES(price_cents),
  max_professionals=VALUES(max_professionals),
  included_wa_messages=VALUES(included_wa_messages);
