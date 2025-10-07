# Pagamentos — Mercado Pago (Assinaturas)

## Variáveis de ambiente

- Obrigatórias
  - `MERCADOPAGO_ACCESS_TOKEN` — Access Token da aplicação (use `TEST-...` no sandbox e `APP_USR-...` na produção)
  - `MERCADOPAGO_WEBHOOK_SECRET` — Assinatura secreta (Webhook secret) da mesma aplicação/ambiente

- Opcionais
  - `MERCADOPAGO_PUBLIC_KEY`
  - `MERCADOPAGO_SUCCESS_URL`, `MERCADOPAGO_FAILURE_URL`, `MERCADOPAGO_PENDING_URL`
  - `MERCADOPAGO_TEST_PAYER_EMAIL` — e-mail do comprador de teste (`test_user_...@testuser.com`) quando usar `TEST-...`
  - `BILLING_CURRENCY` — padrão `BRL`
  - `MERCADOPAGO_WEBHOOK_SECRET_2` — segundo segredo aceito (para rotação/transição de apps ou ambientes)

Observação: mantenha `ACCESS_TOKEN`, `PUBLIC_KEY` e `WEBHOOK_SECRET` da MESMA aplicação e do MESMO ambiente para evitar assinaturas inválidas.

## Webhook

- Endpoint: `POST /billing/webhook` (alias: `POST /api/billing/webhook`)
- Assinatura: header `x-signature` no formato `ts=<unix>, v1=<hex>`
- O backend valida duas variantes do payload HMAC-SHA256 (compatível com o MP):
  - `id:<data.id>;request-id:<x-request-id>;ts:<ts>`
  - `id:<data.id>;topic:<type>;ts:<ts>`
- Multi-segredo: valida contra até 2 segredos (`MERCADOPAGO_WEBHOOK_SECRET` e `MERCADOPAGO_WEBHOOK_SECRET_2`). Passa se qualquer um bater.
- Resposta: `401` quando a assinatura não confere, `200` quando válida.

### Health/Diagnóstico

- `GET /billing/webhook/health`
  - Sem parâmetros: informa se há segredo configurado.
  - Com `id`, `request_id`, `type` (topic) e `ts`: retorna os HMACs esperados para cada segredo configurado, em ambas as variantes (request-id e topic).
  - Exemplo:
    - `/billing/webhook/health?id=<data.id>&request_id=<x-request-id>&type=subscription_preapproval&ts=<unix>`

## Fluxos

- Sandbox (teste)
  - Vendedor: use `MERCADOPAGO_ACCESS_TOKEN=TEST-...` e o Webhook secret do sandbox.
  - Comprador: faça login no checkout com o e-mail `test_user_...@testuser.com` e use cartões de teste.

- Produção
  - Vendedor: use `MERCADOPAGO_ACCESS_TOKEN=APP_USR-...` e Webhook secret de produção.
  - Comprador: conta e cartão reais (não utilizar `MERCADOPAGO_TEST_PAYER_EMAIL`).

## Rotas úteis

- `POST /billing/checkout-session?force=1` — cria um novo plano/checkout (evita reaproveitar links antigos)
- `GET /billing/subscription` — status atual da assinatura do estabelecimento autenticado
- `GET /billing/sync?preapproval_id=<id>` — força sincronização de um preapproval (fallback se o webhook não chegar)

