USE agendamentos;

ALTER TABLE estabelecimento_perfis
  ADD COLUMN IF NOT EXISTS accent_color VARCHAR(7) NULL AFTER tiktok_url;

ALTER TABLE estabelecimento_perfis
  ADD COLUMN IF NOT EXISTS accent_strong_color VARCHAR(7) NULL AFTER accent_color;
