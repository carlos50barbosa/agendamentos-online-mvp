# WhatsApp Bot (Fase 1 a 6 Operacional)

Implementacao multi-tenant do bot WhatsApp para agendamentos.

Premissas mantidas:
- Sem alteracao da logica de SINAL/PIX.
- Sem duplicar validacoes criticas de conflito/expediente/buffer/status.
- Bot apenas conversa e chama endpoints internos existentes.

## Entrypoint oficial

- `POST /api/webhooks/whatsapp`
- Aliases compativeis:
  - `POST /webhooks/whatsapp`
  - `POST /api/wa/webhook`
  - `POST /wa/webhook`

## Fluxos de conversa

- `AGENDAR` ponta a ponta
- `REMARCAR` ponta a ponta
- `CANCELAR` ponta a ponta
- `MENU` / `HUMANO`
- Handoff humano com pausa do bot por conversa

## Fase 4/5/6 operacional (producao)

### 1) Templates reais fora da janela de 24h

- Fora da janela: resposta enviada como template via outbox.
- Modulo central: `src/bot/templates/templateRegistry.js`
- Envio via outbox: `src/lib/whatsapp_outbox.js` e `src/bot/runtime/replyDispatcher.js`
- Se template ausente:
  - nao envia texto direto,
  - registra erro `BOT_NO_TEMPLATE`,
  - abre handoff humano automaticamente.

### 2) Feature flags por tenant + rollout + kill switch

Tabela: `wa_bot_settings`
- `enabled`
- `mode` (`bot_only | hybrid | human_only`)
- `rollout_percent` (0-100)
- `kill_switch`

Politica de runtime:
- `kill_switch=1`: ignora processamento (log + encerra).
- `enabled=0`: abre handoff e nao roda engine.
- `mode=human_only`: abre handoff e nao roda engine.
- rollout gradual por hash do telefone:
  - `hash(from_phone) % 100 < rollout_percent`.

### 3) Handoff humano completo + pause bot

Tabela: `wa_handoff_queue`
- `open/assigned/closed`
- `reason`, `assigned_to`, timestamps.

Sessao:
- `context.bot_paused=true` quando handoff abre.
- Enquanto pausado, engine nao roda.
- Retomar bot (modo `hybrid`): `voltar bot` ou `menu`.

### 4) Metricas do funil

Tabela: `wa_bot_metrics_daily`
- inbound
- starts/completions de agendar/remarcar/cancelar
- conflitos 409
- handoff aberto
- template fora da janela
- erros

Atualizacao central ao final do processamento da mensagem.

### 5) Protecoes de estabilidade

- Rate limit por `(tenant, from_phone)`:
  - padrao: `20 mensagens / 5 min`
- Timeout em chamadas internas:
  - padrao: `8s`
- Codigos de erro:
  - `BOT_UPSTREAM_TIMEOUT`
  - `BOT_UPSTREAM_5XX`

No modo `hybrid`, timeout/5xx pode abrir handoff automaticamente.

### 6) Observabilidade pratica

`wa_conversation_logs` inclui:
- `reply_type`
- `tenant_resolution_source`
- `latency_ms`

Endpoint admin:
- `GET /api/admin/wa-bot/metrics?tenant_id=&from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/admin/wa-bot/conversations?tenant_id=&limit=50`
- `GET /api/admin/wa-bot/settings?tenant_id=...`
- `PUT /api/admin/wa-bot/settings/:tenantId`

## Migrations

Aplicar nesta ordem:

1. `backend/sql/2026-02-23-add-whatsapp-bot-engine.sql`
2. `backend/sql/2026-02-24-whatsapp-bot-phase3-hardening.sql`
3. `backend/sql/2026-02-24-wa-bot-settings.sql`
4. `backend/sql/2026-02-24-wa-handoff-queue.sql`
5. `backend/sql/2026-02-24-wa-bot-metrics-daily.sql`

## Variaveis de ambiente

Basicas:
- `WA_VERIFY_TOKEN`
- `PORT`
- `BOT_INTERNAL_API_BASE_URL` (opcional)
- `BOT_INTERNAL_API_HOST` (opcional)
- `WA_BOT_SESSION_TTL_MIN` (default `120`)
- `WA_BOT_HTTP_TIMEOUT_MS` (default `8000`)

Templates:
- `WA_TEMPLATE_NAME_MENU` (obrigatorio em producao para janela fechada)
- `WA_TEMPLATE_LANG` (default `pt_BR`)
- opcionais:
  - `WA_TEMPLATE_NAME`
  - `WA_TEMPLATE_NAME_CONFIRMACAO`
  - `WA_TEMPLATE_NAME_REMARCAR`
  - `WA_TEMPLATE_NAME_CANCELAR`

Rate limit:
- `WA_BOT_RATE_LIMIT_MAX` (default `20`)
- `WA_BOT_RATE_LIMIT_WINDOW_MS` (default `300000`)

## Como ativar por tenant (rollout)

Via admin API:

```bash
curl -X PUT "http://127.0.0.1:3002/api/admin/wa-bot/settings/27" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"enabled":true,"mode":"hybrid","rollout_percent":50,"kill_switch":false}'
```

Rollout progressivo:
- `10` => ~10% dos telefones
- `50` => ~50%
- `100` => 100%

Kill switch imediato:
- `kill_switch=true`

## Testes

```bash
cd backend
npm run test:wa
```

Testes adicionados:
- `wa-rollout-settings.test.js`
- `wa-handoff-pause.test.js`
- `wa-templates-outside-window.test.js`
- `wa-metrics-daily.test.js`

## Simulacao

```bash
cd backend
node scripts/simulate-wa-bot.mjs
```

Exemplos:

Intent:

```bash
BOT_SIM_INTENT=remarcar node scripts/simulate-wa-bot.mjs
BOT_SIM_INTENT=cancelar node scripts/simulate-wa-bot.mjs
```

Sequencia:

```bash
BOT_SIM_MESSAGES="remarcar|1|1|1|1" node scripts/simulate-wa-bot.mjs
```

Fora da janela:

```bash
BOT_SIM_FORCE_OUTSIDE_WINDOW=1 BOT_SIM_INTENT=menu node scripts/simulate-wa-bot.mjs
```

Aplicar settings por tenant no simulador:

```bash
BOT_SIM_TENANT_ID=27 BOT_SIM_SET_ENABLED=1 BOT_SIM_SET_MODE=hybrid BOT_SIM_SET_ROLLOUT_PERCENT=50 node scripts/simulate-wa-bot.mjs
BOT_SIM_TENANT_ID=27 BOT_SIM_SET_KILL_SWITCH=1 node scripts/simulate-wa-bot.mjs
```

Simular burst para rate limit:

```bash
BOT_SIM_RATE_LIMIT_BURST=30 BOT_SIM_RATE_LIMIT_TEXT=menu BOT_SIM_DELAY_MS=10 node scripts/simulate-wa-bot.mjs
```

## Consultas uteis

```sql
SELECT * FROM wa_bot_settings WHERE tenant_id=27;

SELECT * FROM wa_handoff_queue
WHERE tenant_id=27
ORDER BY id DESC
LIMIT 20;

SELECT * FROM wa_bot_metrics_daily
WHERE tenant_id=27
ORDER BY day DESC;

SELECT id, tenant_id, from_phone, intent, action, reply_type, tenant_resolution_source, latency_ms, created_at
FROM wa_conversation_logs
ORDER BY id DESC
LIMIT 100;

SELECT id, tenant_id, to_phone, kind, status, provider_message_id, attempt_count, created_at, sent_at
FROM whatsapp_outbox
ORDER BY id DESC
LIMIT 100;
```

## Playbook rapido de falha

1. Ativar `kill_switch` no tenant.
2. Verificar `wa_conversation_logs` por `action=BOT_ERROR` e `endpoint_result.error_code`.
3. Verificar `whatsapp_outbox.status='error'`.
4. Verificar handoffs abertos em `wa_handoff_queue`.
5. Corrigir env/template/upstream e reativar rollout progressivo.
