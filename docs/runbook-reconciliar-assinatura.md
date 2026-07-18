# Runbook — Reconciliar assinatura ("PIX pendente" apesar de pago)

## Sintoma
O dono está pago/ativo (ex.: "ativo até 06/08"), mas a tela de Assinatura mostra
**"PIX pendente"** e um botão **"Assinar"**. Causa: uma `pending_pix` órfã ficou
como a assinatura *efetiva* — sobrou de cliques repetidos no "Assinar" **antes**
da trava/supersede-protegido entrar em produção. O supersede antigo **cancelou a
paga** (local + INATIVOU no gateway) e a órfã nova virou a efetiva.

Isso não é só cosmético:
- A renovação futura seria **ignorada** pelo webhook (guard `status<>'canceled'`).
- A assinatura paga está **INATIVA no Asaas** → sem renovação automática.
- A órfã ainda tem uma **cobrança PIX aberta** que, se paga, vira **cobrança dupla**.

## Fix automático (endpoint admin)

Precisa de `ADMIN_TOKEN` (header `x-admin-token`). **Sempre rode o dry-run primeiro.**

### 1) Dry-run (não altera nada — só mostra o plano)
```bash
curl -sS -X POST https://SEU_HOST/api/admin/subscriptions/reconcile \
  -H "x-admin-token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{ "email": "dono@exemplo.com" }' | jq
```
Confira no retorno:
- `action` = `"reconcile"` (se `noop`/`manual_review`, veja abaixo).
- `canonical` = a linha PAGA que será restaurada (id + `gatewaySubscriptionId`).
- `orphans` = as pendentes que serão canceladas.
- `paidThrough` = até quando o período pago vale.

### 2) Aplicar
```bash
curl -sS -X POST https://SEU_HOST/api/admin/subscriptions/reconcile \
  -H "x-admin-token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{ "email": "dono@exemplo.com", "apply": true }' | jq
```
O que ele faz (com `apply:true`):
- **Órfãs**: apaga a cobrança PIX aberta (`deletedCharges`) + INATIVA no gateway +
  cancela local.
- **Paga (canônica)**: restaura para `active` com o período pago + **REATIVA no
  gateway** (`canonicalReactivated`) para a renovação voltar a acontecer.
- **usuarios**: realinha para `active` apontando a canônica (`userRealigned`).

Parâmetros do body: `estabelecimentoId` **ou** `email`; `apply` (default `false`);
`cancelGateway` (default `true` — passe `false` para reconciliar **só local**, sem
tocar o Asaas).

### 3) Conferir
Peça ao dono para recarregar `/assinatura`: deve mostrar **"Assinatura ativa até
DD/MM"** e o botão **"Trocar plano"** (não mais "Assinar"/"PIX pendente").

## Quando o retorno NÃO é `reconcile`
- `noop`: a efetiva já é `active` (nada a fazer) **ou** não há período pago vigente
  (não é o caso deste bug — não force).
- `manual_review`: há período pago vigente mas **nenhuma linha com pagamento**
  (`last_payment_at`). Não dá para saber qual é a paga automaticamente — investigue
  no banco (`SELECT * FROM subscriptions WHERE estabelecimento_id=? ORDER BY created_at DESC`)
  e ajuste manualmente.

## Conferir consistência do gateway
O retorno traz `gatewayConsistent` (true só se **todas** as ops de gateway —
apagar cobrança, INATIVAR órfã, REATIVAR paga — deram certo). Se vier `false`,
olhe `gatewayOps`/`deletedCharges` para o item com `ok:false` e resolva no painel
do Asaas (o estado local já ficou correto; só o gateway ficou pela metade).

## Caveat — reativação no gateway
A reativação da paga usa `updateSubscription(status:'ACTIVE', nextDueDate: paidThrough)`
— ela **ancora a próxima cobrança na data do período pago**, então não dispara
cobrança imediata mesmo que o schedule guardado no Asaas estivesse no passado. Se
`gatewayOps` retornar `ok:false` para a reativação, verifique a assinatura no painel
do Asaas (pode ter sido removida, não só inativada) e recrie/reative à mão.
