INSERT INTO billing_addon_packs (code, name, price_cents, wa_messages, is_active)
VALUES
  ('wa_100',  'Pacote 100 mensagens',   990,  100, 1),
  ('wa_200',  'Pacote 200 mensagens',  1690,  200, 1),
  ('wa_300',  'Pacote 300 mensagens',  2490,  300, 1),
  ('wa_500',  'Pacote 500 mensagens',  3990,  500, 1),
  ('wa_1000', 'Pacote 1000 mensagens', 7990, 1000, 1),
  ('wa_2500', 'Pacote 2500 mensagens',19990, 2500, 1)
ON DUPLICATE KEY UPDATE
  name=VALUES(name),
  price_cents=VALUES(price_cents),
  wa_messages=VALUES(wa_messages),
  is_active=VALUES(is_active);
