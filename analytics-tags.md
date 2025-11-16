# Templates de Tags – Google & Meta

O front-end já coloca o Google Tag Manager (ID `GTM-M66FSB3K`) e o Meta Pixel (`864468765947159`) em todas as páginas. Também emitimos automaticamente os eventos abaixo no `dataLayer` e no `fbq`, então basta configurar as tags para começar a registrar conversões.

## Eventos disparados

| Evento | Origem | Momento | Campos úteis |
|--------|--------|---------|--------------|
| `initiate_checkout` (GA/GTM) <br> `InitiateCheckout` (Meta) | Clique em “Gerar PIX” com criação de cobrança bem-sucedida. | Após `POST /billing/pix`. | `plan`, `plan_label`, `billing_cycle`, `payment_id`, `currency` (sempre `BRL`), `value`, `items` |
| `purchase` (GA/GTM) <br> `Purchase` (Meta) | Assim que a assinatura retorna `active` (PIX confirmado). | O efeito detecta a mudança apenas uma vez por ciclo. | `plan`, `plan_label`, `billing_cycle`, `subscription_id`, `transaction_id`, `currency`, `value`, `items` |

Os `items` enviados possuem o formato: `[{ item_id, item_name, item_category: 'subscription', billing_cycle, quantity: 1, price }]`.

## Como configurar no Google Tag Manager

Consulte `analytics/gtm-template.json` (estrutura de variáveis, triggers e tags). O passo a passo:

1. **Variáveis da Camada de Dados**  
   Crie uma Data Layer Variable para cada campo (`plan`, `plan_label`, `billing_cycle`, `payment_id`, `subscription_id`, `transaction_id`, `value`, `currency`, `items`). Defina `0` como valor padrão de `value` e `BRL` como padrão de `currency`.
2. **Triggers**  
   - `EV - initiate_checkout`: Custom Event `initiate_checkout`.  
   - `EV - purchase`: Custom Event `purchase`.
3. **Tags GA4**  
   - `GA4 - Config`: tipo *GA4 Configuration*, Measurement ID real (ex.: `G-0000000000`), disparo em *All Pages*.  
   - `GA4 - initiate_checkout`: tipo *GA4 Event*, evento `initiate_checkout`, parâmetros preenchidos com as variáveis do passo 1, trigger `EV - initiate_checkout`.  
   - `GA4 - purchase`: tipo *GA4 Event*, evento `purchase`, mesmos parâmetros + `transaction_id` e `subscription_id`, trigger `EV - purchase`.
4. **Google Ads**  
   Importe as conversões do GA4 para o Google Ads. Se quiser uma tag própria, duplique o trigger `EV - purchase` e utilize as mesmas variáveis para `Conversion Value`/`Currency`.

## Meta Ads / Pixel

Os eventos `InitiateCheckout` e `Purchase` já nascem com `value` e `currency`. No Events Manager:

1. Verifique a aba *Test Events* para garantir o recebimento em tempo real do domínio.
2. Crie *Custom Conversions* com as seguintes regras (adapte conforme necessidade):
   - `InitiateCheckout` com condição `plan` contém `pro` ou `premium`.
   - `Purchase` com condição `value` maior que zero.
3. No *Aggregated Event Measurement* priorize o evento `Purchase`.

## Checklist de validação

1. **GTM Preview / Tag Assistant**  
   - Clique em “Preview” no GTM e abra `https://agendamentosonline.com/configuracoes`.  
   - Gere um PIX e confirme que os tags `GA4 - initiate_checkout` e `GA4 - purchase` aparecem no painel (o segundo só após o plano voltar como ativo).
2. **Meta Pixel Helper**  
   - Gere um PIX; confira o evento `InitiateCheckout` com `value`/`currency`.  
   - Depois que o pagamento for aprovado, abra novamente a área de configurações para ver o evento `Purchase`.
3. **Events Manager / GA4 DebugView**  
   - Em *Test Events* (Meta) e *DebugView* (GA4) valide se ambos os eventos foram entregues.  
4. **Pagamento real de homologação**  
   - Faça um pagamento real (ou de sandbox) e confirme, horas depois, se a conversão aparece nos relatórios do GA4 e do Meta.
