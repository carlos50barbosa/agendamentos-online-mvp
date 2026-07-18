# Runbook — Troca de plano com assinatura ANUAL ativa (via suporte)

## Por que este runbook existe

A troca de plano self-serve (`POST /api/billing/asaas/checkout-session`) só é
automática quando a assinatura ativa está no ciclo **mensal** (janela grátis ≤ 1
mês). Quando o período **pago é anual**, qualquer troca é bloqueada com
`409 plan_change_annual_support` ("fale com o suporte"), porque:

- **Subir de tier** (ex.: Pro anual → Premium anual) daria acesso ao tier maior
  por até ~11 meses sem cobrar a diferença — vazamento de receita real.
- **Anual → mensal** converteria um anual já pago em mensal sem proração.

A proração automática (cobrar a diferença na hora) ainda **não está ligada** no
lado de escrita do Asaas (`backend/src/lib/subscription_credits.js` tem a
maquinária de crédito, mas não é usada aqui). Até lá, o suporte faz o ajuste
manual descrito abaixo.

> ⚠️ **Não basta editar o banco.** O que o Asaas **cobra** na renovação é o
> `value`/`cycle` da assinatura no gateway; o banco controla o **acesso** e o
> plano que o webhook reativa. Se você mexer só no banco, o cliente fica com o
> tier novo pagando o preço antigo. **Sempre ajuste os dois: Asaas + banco.**

## Antes de começar — decida a política de proração (caso a caso)

Isto é decisão de negócio, não há regra automática:

- **Upgrade anual:** cobrar a diferença proporcional agora? Dar como cortesia até
  a renovação? Reancorar a data de cobrança (`nextDueDate`) para hoje?
- **Anual → mensal:** normalmente mantém o período anual já pago e só passa a
  cobrar mensal a partir da próxima renovação.

Registre a decisão no ticket antes de aplicar.

## Passo 1 — Localizar a assinatura

```sql
-- estabelecimento_id você pega pelo e-mail/telefone do dono
SELECT id, estabelecimento_id, plan, billing_cycle, amount_cents,
       gateway_subscription_id, status, current_period_end
  FROM subscriptions
 WHERE estabelecimento_id = :ESTAB_ID
   AND gateway = 'asaas'
   AND external_reference LIKE 'subscription:estab:%'
 ORDER BY created_at DESC
 LIMIT 1;

SELECT id, plan, plan_cycle, plan_status, plan_active_until
  FROM usuarios
 WHERE id = :ESTAB_ID AND tipo = 'estabelecimento';
```

Anote `gateway_subscription_id` (ex.: `sub_xxx`) e o `subscriptions.id` local.

## Passo 2 — Ajustar a assinatura no Asaas (o que será COBRADO)

Preços atuais (centavos → reais), de `backend/src/lib/plans.js`:

| Plano   | Mensal   | Anual     |
|---------|----------|-----------|
| Starter | R$ 14,90 | R$ 149,00 |
| Pro     | R$ 29,90 | R$ 299,00 |
| Premium | R$ 99,90 | R$ 999,00 |

Atualize **a mesma** assinatura (nunca crie uma segunda — isso cobra em
paralelo). Via API (produção usa a API key do Asaas):

```bash
curl -X POST "https://api.asaas.com/v3/subscriptions/<GATEWAY_SUBSCRIPTION_ID>" \
  -H "access_token: $ASAAS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "value": 999.00,            // preço-alvo em reais (ex.: Premium anual)
    "cycle": "YEARLY",          // YEARLY (anual) ou MONTHLY (mensal)
    "description": "Assinatura Premium (anual)",
    "updatePendingPayments": true   // reescreve cobranças PENDENTES; não toca nas já pagas
    // "nextDueDate": "2026-08-01"  // opcional: reancorar a data da próxima cobrança
  }'
```

Se decidiu **cobrar a diferença agora**, crie uma cobrança avulsa (payment) no
Asaas para o valor da diferença e confirme o pagamento antes do Passo 3.

## Passo 3 — Ajustar o banco (acesso + o que o webhook reativa)

Estes são exatamente os campos que a troca automática (`changeTenantAsaasPlan`)
mexe. Rode como **uma transação**.

```sql
START TRANSACTION;

-- subscriptions: o webhook LÊ plan/billing_cycle daqui na renovação
UPDATE subscriptions
   SET plan = :NOVO_PLANO,           -- 'starter' | 'pro' | 'premium'
       amount_cents = :NOVO_VALOR_CENTS,
       billing_cycle = :NOVO_CICLO,  -- 'mensal' | 'anual'
       updated_at = NOW()
 WHERE id = :SUBSCRIPTION_ID;

-- usuarios: acesso ao tier. plan_active_until controla ATÉ QUANDO o acesso vale.
--   - Upgrade com cortesia até a renovação: NÃO mexa em plan_active_until.
--   - Se reancorou a cobrança/aplicou proração: ajuste plan_active_until conforme a decisão.
UPDATE usuarios
   SET plan = :NOVO_PLANO,
       plan_cycle = :NOVO_CICLO
 WHERE id = :ESTAB_ID AND tipo = 'estabelecimento';

COMMIT;
```

## Passo 4 — Conferir

```sql
SELECT s.plan, s.billing_cycle, s.amount_cents, s.status,
       u.plan AS u_plan, u.plan_cycle, u.plan_status, u.plan_active_until
  FROM subscriptions s
  JOIN usuarios u ON u.id = s.estabelecimento_id
 WHERE s.id = :SUBSCRIPTION_ID;
```

- `subscriptions.plan` == `usuarios.plan` (nunca deixe divergir — o guard de
  downgrade lê `usuarios.plan`).
- No Asaas, a assinatura mostra o novo `value`/`cycle`.
- Peça pro dono recarregar `/assinatura` e confirmar o plano exibido.

## Erros comuns

- **Editar só o banco** → cliente com tier novo pagando preço antigo. Sempre
  ajuste o Asaas também.
- **Criar uma 2ª assinatura** em vez de dar `POST` na existente → cobrança em
  paralelo. Edite a mesma (`gateway_subscription_id`).
- **`subscriptions.plan` ≠ `usuarios.plan`** → na próxima renovação o webhook
  reativa o plano de `subscriptions`; e o guard de downgrade pode reclassificar
  errado. Mantenha os dois iguais.

## Roadmap (o que elimina este runbook)

Ligar a proração de verdade no Asaas (reusar `subscription_credits.js` +
cobrança avulsa da diferença) torna o upgrade anual **self-serve** — que é,
inclusive, o upsell de maior valor (Pro anual → Premium anual).
