# Agendamentos Online � Backend (MVP)

## Como rodar
1) Crie o banco MySQL e rode o script `sql/schema.sql` (ajuste se j� possuir a MESMA estrutura de tabelas; este arquivo � uma refer�ncia).
2) Copie `.env.example` para `.env` e preencha.
3) `npm install`
4) `npm run dev`

## Rotas principais
- `POST /auth/register` {nome, email, senha, tipo: 'cliente'|'estabelecimento'}
- `POST /auth/login` {email, senha}
- `GET /me` (autenticado)
- Servi�os (estabelecimento): `GET /servicos`, `POST /servicos`, `PUT /servicos/:id`, `DELETE /servicos/:id`
- Slots: `GET /slots?establishmentId=ID&weekStart=YYYY-MM-DD`, `POST /slots/toggle` {slotDatetime}
- Agendamentos:
  - Cliente: `GET /agendamentos` (meus), `POST /agendamentos` (criar), `PUT /agendamentos/:id/cancel` (cancelar)
  - Estabelecimento: `GET /agendamentos-estabelecimento` (somente confirmados)

## Pagamentos (Mercado Pago)
- Vari�veis obrigat�rias no `.env`: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`. Opcionalmente configure `MERCADOPAGO_SUCCESS_URL`, `MERCADOPAGO_FAILURE_URL`, `MERCADOPAGO_PENDING_URL`, `MERCADOPAGO_TEST_PAYER_EMAIL`, `BILLING_CURRENCY` (padr�o BRL).
- Rotas protegidas para estabelecimentos:
  - `POST /billing/checkout-session` � cria uma sess�o de pagamento para o plano informado e retorna o `init_point` do Mercado Pago.
  - `GET /billing/subscription` � contexto do plano e assinatura atual.
- Webhook p�blico: `POST /billing/webhook` � configure a URL no painel do Mercado Pago para receber eventos de preapproval.
- Banco: execute as migra��es `sql/2025-09-27-add-subscriptions-tables.sql` e `sql/2025-09-27-update-plan-status-enum.sql` ap�s aplicar `schema.sql`.
