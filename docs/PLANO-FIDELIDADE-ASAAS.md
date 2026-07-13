# Planos recorrentes cliente → estabelecimento, via Asaas

Plano de implementação. O produto: o **salão vende um plano mensal ao seu próprio cliente**
("2 cortes por mês por R$ 80"), o cliente paga no cartão, o dinheiro cai na conta do salão
e o cliente consome os créditos ao agendar.

Não confundir com a **assinatura SaaS** (o salão pagando a plataforma), que é outra coisa e
já existe em `lib/asaas_subscription.js`.

---

## O ponto de partida: o motor já está vivo

Isto muda a forma do projeto e vale ler antes de qualquer coisa.

`applyClientLoyaltyBenefitsTx` **roda hoje, em produção, em toda criação de agendamento** —
`routes/agendamentos.js:891`, `:1706` e `routes/agendamentos_public.js:966` —, sem feature
flag. Ele busca a assinatura elegível, debita o crédito, calcula o desconto, grava o
snapshot em `agendamentos.loyalty_benefit_snapshot_json` e devolve o crédito no
cancelamento (`lib/appointment_loyalty.js`).

Só que **cai sempre no caminho "sem assinatura elegível"**, porque não existe nenhum
endpoint que crie uma linha em `client_loyalty_subscriptions`.

Ou seja: **o motor não precisa ser construído.** `lib/client_loyalty_credits.js` (437
linhas: créditos, ciclos, snapshot, estorno) **não tem uma única linha de Mercado Pago**.
O que morreu foi a camada de pagamento e a superfície de API.

> ⚠️ **`client_loyalty_credits.js` é caminho crítico do agendamento.** Mexer nele quebra
> agendamento, não fidelidade. Não tocar.

### O que existe, por camada

| Camada | Estado |
|---|---|
| **Tabelas** (`loyalty_plans`, `loyalty_plan_items`, `client_loyalty_subscriptions`, `..._credits`, `..._events`) | Existem, **vazias**. `loyalty_plans`, `loyalty_plan_items` e `..._credits` são 100% neutras de gateway. |
| **Motor de crédito** (`client_loyalty_credits.js`) | Vivo, 0% MP. **Reaproveitar inteiro.** |
| **Estado/elegibilidade da assinatura** (`client_loyalty_subscriptions.js`) | ~75% aproveitável. Acopla em 3 pontos: lookup `OR mp_preapproval_id`, JOIN em `mercadopago_webhook_events`, filtro `gateway='mercadopago'`. |
| **CRUD dos planos** (`loyalty_plans.js`) | Pronto e **órfão** — nenhuma rota importa. É só expor. |
| **Camada de cobrança** (`client_loyalty_billing.js`, 3.969 linhas) | Mercado Pago puro no núcleo. **21 dos 25 exports estão mortos.** Reescrever. |
| **Rotas** | **Não existem.** Todos os endpoints dão 404. |
| **Frontend** | UI removida. Sobrou o **contrato completo de API** (`utils/api.js:699-736`, 16 métodos) e a casca de exibição no `NovoAgendamento.jsx`. |

---

## Fase 0 — Decisões (fechadas)

### 1. Cobrança: **cartão recorrente tokenizado**

`billingType: 'CREDIT_CARD'` + `creditCardToken`. O Asaas tokeniza do lado dele — a
plataforma não toca em dados de cartão (sem PCI).

Por quê: o modelo atual do wrapper é checkout hospedado (`billingType: 'UNDEFINED'`), em que
o Asaas **emite uma fatura por ciclo e o cliente vai lá pagar**. Para o consumidor final,
isso mata o plano no segundo mês.

### 2. Comissão da plataforma: **5%**

Cobrada via `split`, sobre o valor do plano. A taxa do Asaas fica por conta do salão (mesmo
modelo do sinal, `lib/signal_calculator.js:60`).

Racional: take rate alto (10–20%) se justifica quando a plataforma **traz a demanda**. Aqui
não traz — quem assina é o cliente que já é do salão. A plataforma fornece o trilho de
pagamento e o motor de créditos. 5% é preço de infraestrutura, não de marketplace.

Num plano de R$ 80: salão recebe ~R$ 73, paga ~R$ 2,89 ao Asaas e R$ 4,00 à plataforma
(~8,6% de custo total sobre receita recorrente garantida).

Variante possível, se quiser usar a comissão como alavanca de upgrade do SaaS:
**7% Starter · 5% Pro · 3% Premium**.

### 3. Estorno: **sai da conta do salão**

O `refundPayment` sem `value` reverte o split automaticamente (`services/asaas/payments.js:177`)
— o dinheiro volta da carteira do salão.

> ⚠️ **Consequência a documentar nos termos:** se o salão já sacou o valor, a carteira dele
> pode ficar **negativa**. A plataforma não cobre esse saldo. Isso precisa estar escrito no
> contrato com o estabelecimento **antes** do primeiro estorno, não depois.

---

## Fase 1 — Fundação Asaas ✅ **CONCLUÍDA**

Aditiva, isolada, não tocou em nada vivo.

| # | Tarefa | Onde ficou |
|---|---|---|
| 1.1 ✅ | **Roteamento do webhook corrigido** (ver armadilha abaixo) | `routes/webhooks_asaas.js` — prefixo `clientplan:` testado **antes** de `subscriptionId` |
| 1.2 ✅ | `createSubscription` aceita `split[]` | `services/asaas/payments.js` |
| 1.3 ✅ | `createSubscription` aceita cartão (`creditCardToken`, `creditCardHolderInfo`, `remoteIp`), com validação **antes** de chamar o Asaas | idem |
| 1.4 ✅ | `tokenizeCreditCard` (`POST /v3/creditCard/tokenize`) | idem |
| 1.5 ✅ | `getSubscription` / `updateSubscription` / `deleteSubscription` | idem |
| 1.6 ✅ | Calculadora de split percentual | `lib/loyalty_split.js` (novo, puro) |
| — ✅ | Config + `.env.example`: `LOYALTY_PLATFORM_PERCENT` (5), `ASAAS_CARD_FEE_PERCENT`, `ASAAS_CARD_FEE_FIXED_CENTS` | `lib/config.js` |

Testes: `tests/loyalty-split.test.js` (novo) + casos em `tests/asaas-payments.test.js` e
`tests/asaas-webhook.test.js`. O `test:asaas` (gate do deploy) roda o arquivo novo.

O ramo `client_plan` do webhook **existe e não processa nada** — registra o evento e devolve
`client_plan_not_implemented`. É proposital: garante que uma cobrança de plano do cliente
jamais escorregue para o ramo da assinatura do tenant enquanto a Fase 2 não chega.

### ⚠️ A armadilha do webhook (fazer primeiro)

O parser decide o tipo assim (`routes/webhooks_asaas.js:81`):

```js
if (subscriptionId || externalReference?.startsWith('subscription:')) kind = 'subscription';
```

**`subscriptionId` é testado primeiro.** Toda cobrança gerada por uma assinatura Asaas traz
`payment.subscription` preenchido — inclusive a do plano do cliente. Ela cairia no ramo da
assinatura do *tenant*, iria procurar em `subscriptions WHERE gateway='asaas'` e morreria em
`subscription_not_found`.

Correção: testar o prefixo novo (`clientplan:<id>`) **antes**, ou restringir o ramo do tenant
a `subscription:estab:`.

É um bug que só aparece em produção, com dinheiro real no meio. Vai primeiro.

### Por que `percentualValue` e não `fixedValue`

O split do sinal usa `fixedValue` (`lib/deposit_provider.js:120`) e desconta uma estimativa
fixa da taxa do Asaas. Num plano recorrente isso quebra: a taxa **varia por meio de
pagamento**, e a estimativa fixa erra quando o cliente troca de cartão para PIX.

**A confirmar em sandbox (não na documentação):** o `percentualValue` incide sobre o valor
**bruto** ou **líquido** da cobrança. Isso decide quem absorve a taxa do Asaas e é
pré-requisito para fixar os 5%.

---

## Fase 2 — Backend do plano

### 2.1 Generalizar `client_loyalty_subscriptions.js`

As colunas `gateway_subscription_id` / `gateway_customer_id` / `gateway_payment_id` **já
existem** lado a lado com as `mp_*`. Trocar os 3 pontos de acoplamento:

- `getClientLoyaltySubscriptionByGatewayId` — `WHERE gateway_subscription_id=? OR mp_preapproval_id=?`
- `getClientLoyaltySubscriptionByWebhookResourceId` — JOIN em `mercadopago_webhook_events`
- `listClientLoyaltyAuthorizedPaymentProbeCandidates` — filtro `gateway='mercadopago'`

Todo o resto (estado, elegibilidade, CRUD, log de eventos com dedupe) é reaproveitável.

### 2.2 Criar `client_loyalty_billing_asaas.js` — **novo, não portar**

O arquivo atual tem 3.969 linhas, das quais ~2.200 orquestram `preapproval` /
`authorized_payment` / `mpAccounts` — conceitos que **não existem no Asaas**, que tem apenas
`/subscriptions` + `/payments` + webhooks `PAYMENT_*`. Portar sai mais caro que reescrever.

**Salvar por copy-paste (blocos puros, sem I/O):**

- validação de pagador (CPF/CNPJ, e-mail, telefone BR, nome do titular) — `client_loyalty_billing.js:130-291`
- ativação de ciclo e `past_due` com dias de graça — `:2042-2296`
- política de retry/cooldown no cartão — `:929-980`, `:1519-1572`, `:1685-1771` (a estrutura serve; trocar a tabela de códigos do MP pelos do Asaas)
- contexto de checkout — `:1887-1954`

> ⚠️ **Não apague `client_loyalty_billing.js`.** O `routes/billing.js:102-107` (webhook MP
> legado) ainda importa 4 funções de sincronização dele.

### 2.3 Ramo `clientplan` no webhook

| Evento Asaas | Ação |
|---|---|
| `PAYMENT_RECEIVED` / `PAYMENT_CONFIRMED` | ativa o ciclo + `ensureCreditsForCurrentCycle` (materializa créditos a partir de `loyalty_plan_items`) |
| `PAYMENT_OVERDUE` | `past_due` → dias de graça → suspende os benefícios |
| `PAYMENT_REFUNDED` / `PAYMENT_CHARGEBACK_REQUESTED` | estorna créditos, cancela assinatura |

### 2.4 As rotas — o contrato já está escrito

**`frontend/src/utils/api.js:699-736` tem os 16 métodos**, todos apontando para rotas que hoje
dão 404. É o mapa do produto antigo — implementar o backend contra esse contrato e o frontend
já sabe chamar:

```
GET    /loyalty/plans                                  (dono: listar)
POST   /loyalty/plans                                  (dono: criar)
PUT    /loyalty/plans/:id                              (dono: editar)
PATCH  /loyalty/plans/:id/status                       (dono: ativar/desativar)
DELETE /loyalty/plans/:id                              (dono: arquivar)
GET    /loyalty/subscribers                            (dono: assinantes)
GET    /public/estabelecimentos/:idOrSlug/loyalty-plans (vitrine)
GET    /cliente/loyalty/{config,subscription,context,history}
POST   /cliente/loyalty/{subscribe,pay/card,pay/pix,cancel}
```

O CRUD dos planos **já existe pronto e órfão** em `lib/loyalty_plans.js`
(`createLoyaltyPlan`, `listLoyaltyPlansForEstablishment`,
`getPublicLoyaltyPlansForEstablishment`, `listLoyaltySubscribersForEstablishment`) — nenhuma
rota as importa. É só expor.

### 2.5 Gate: sem carteira, sem plano

Salão sem `establishment_settings.asaas_wallet_id` **não pode vender plano** — mesmo padrão
do sinal (`routes/agendamentos.js:816`).

---

## Fase 3 — Frontend

- **Painel do dono:** CRUD de planos + lista de assinantes. Do zero.
- **Vitrine pública:** os planos na página do estabelecimento, ao lado dos serviços.
- **Área do cliente:** assinar (cartão), ver assinatura, cancelar, histórico. Do zero — o
  `utils/mercadoPagoCard.js` serve de esqueleto para o formulário (a lógica de erro e retry é
  aproveitável; o SDK muda).
- **Religar o `NovoAgendamento.jsx`:** o loader está *neutralizado* (comentário em `:3345`),
  mas o render já tem os hints por serviço (`:3192`), o banner (`:3213`) e o preview do total
  com desconto (`:3228`). É ligar de volta.

---

## Fase 4 — Operação

- Renovação e inadimplência: `past_due` → graça → suspende benefício (o
  `computeClientLoyaltySubscriptionState` já modela isso).
- Estorno / chargeback (ver decisão 3).
- **Smoke test das rotas novas** — `backend/tests/smoke-routes.test.js`. É uma linha por rota
  na lista, e elas passam a rodar contra o MariaDB no CI. Ver `docs/TESTES.md`.
- Validação ponta a ponta no **sandbox do Asaas**, com webhook real.

---

## Riscos e pendências

**`ASAAS_SPLIT_DISABLED=true` hoje.** O split está **desligado** — o sinal cobra tudo na conta
da plataforma, sem repasse. Isso significa que **o caminho de split pode nunca ter rodado com
dinheiro real.** O plano depende inteiramente dele. Validar no sandbox antes de contar com ele.

**Não existe `LOYALTY_ENABLED`.** O motor roda incondicionalmente, sem flag. Para lançar de
forma controlada (um salão piloto), criar a flag antes.

**A taxa real de cartão do Asaas** não está no repositório — só a estimativa de PIX
(`ASAAS_PIX_FEE_CENTS=199`). Conferir no painel da conta antes de fixar os 5%.
