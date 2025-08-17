# Agendamentos Online — Backend (MVP)

## Como rodar
1) Crie o banco MySQL e rode o script `sql/schema.sql` (ajuste se já possuir a MESMA estrutura de tabelas; este arquivo é uma referência).
2) Copie `.env.example` para `.env` e preencha.
3) `npm install`
4) `npm run dev`

## Rotas principais
- `POST /auth/register` {nome, email, senha, tipo: 'cliente'|'estabelecimento'}
- `POST /auth/login` {email, senha}
- `GET /me` (autenticado)
- Serviços (estabelecimento): `GET /servicos`, `POST /servicos`, `PUT /servicos/:id`, `DELETE /servicos/:id`
- Slots: `GET /slots?establishmentId=ID&weekStart=YYYY-MM-DD`, `POST /slots/toggle` {slotDatetime}
- Agendamentos:
  - Cliente: `GET /agendamentos` (meus), `POST /agendamentos` (criar), `PUT /agendamentos/:id/cancel` (cancelar)
  - Estabelecimento: `GET /agendamentos-estabelecimento` (somente confirmados)