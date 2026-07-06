// backend/scripts/cancel-mp-loyalty-subs.mjs
// Cancela no Mercado Pago os preapprovals de fidelidade que ainda podem cobrar
// (mesma seleção do list-mp-loyalty-subs.mjs) e marca as linhas como 'canceled'.
//
// DRY-RUN por padrão (não altera nada). Passe --yes para efetivar.
//   node scripts/cancel-mp-loyalty-subs.mjs                 # preview (via MP)
//   node scripts/cancel-mp-loyalty-subs.mjs --yes           # cancela no MP + marca o banco
//   node scripts/cancel-mp-loyalty-subs.mjs --db-only        # preview (só banco)
//   node scripts/cancel-mp-loyalty-subs.mjs --db-only --yes  # só marca o banco (MP já cancelado à parte / sem token)
//
// --db-only: NÃO fala com o Mercado Pago (use quando já cancelou no painel do MP,
// ou quando o MERCADOPAGO_ACCESS_TOKEN não está mais no .env). Idempotente.
import mysql from 'mysql2/promise';
import { config } from '../src/lib/config.js';
import {
  cancelMercadoPagoCardSubscription,
  getMercadoPagoCardSubscription,
} from '../src/lib/mercadopago_subscriptions.js';

const APPLY = process.argv.includes('--yes');
const DB_ONLY = process.argv.includes('--db-only');
const CHARGING_STATUSES = new Set(['trialing', 'active', 'past_due', 'pending_payment']);
const accessToken = config?.billing?.mercadopago?.accessToken || null;

if (APPLY && !DB_ONLY && !accessToken) {
  console.error(
    'MERCADOPAGO_ACCESS_TOKEN ausente no .env — não dá pra cancelar no MP.\n' +
      'Se você já cancelou no painel do MP, rode com --db-only --yes para só acertar o banco.',
  );
  process.exit(2);
}

const conn = await mysql.createConnection({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.pass,
  database: config.db.name,
});

try {
  const [rows] = await conn.query(
    `SELECT id, status, payment_method, auto_renew, gateway_subscription_id, mp_preapproval_id
       FROM client_loyalty_subscriptions
      WHERE (gateway = 'mercadopago' OR gateway IS NULL)`,
  );

  // Mesma regra do list-mp-loyalty-subs.mjs: cartão recorrente, auto_renew, status vivo, com preapproval.
  const charging = (rows || []).filter(
    (r) =>
      String(r.payment_method) === 'credit_card' &&
      Number(r.auto_renew) === 1 &&
      CHARGING_STATUSES.has(String(r.status)) &&
      (r.mp_preapproval_id || r.gateway_subscription_id),
  );

  const mode = DB_ONLY ? ' [db-only: não fala com o MP]' : '';
  console.log(
    `\n${APPLY ? '=== APLICANDO ===' : '=== DRY-RUN (nada será alterado; use --yes para efetivar) ==='}${mode}`,
  );
  console.log(`Candidatos: ${charging.length}\n`);
  if (charging.length === 0) {
    console.log('✅ Nada a fazer — nenhuma linha ainda marcada como cobrando.');
    process.exit(0);
  }

  let ok = 0;
  let failed = 0;

  for (const r of charging) {
    const preapprovalId = r.mp_preapproval_id || r.gateway_subscription_id;

    if (!APPLY) {
      const act = DB_ONLY ? 'marcaria (só banco)' : 'cancelaria';
      console.log(`[dry-run] ${act} #${r.id} → preapproval ${preapprovalId} (${r.status})`);
      continue;
    }

    try {
      let note = '(db-only; MP tratado à parte)';
      if (!DB_ONLY) {
        // Confere o status atual no MP (idempotência). Só 404 conta como "inexistente".
        let mpStatus = null;
        try {
          const got = await getMercadoPagoCardSubscription(preapprovalId, { accessToken });
          mpStatus = got?.raw?.status || got?.subscription?.status || null;
        } catch (e) {
          if (e?.status === 404) mpStatus = 'not_found';
          else throw e; // erro real (auth/rede) -> propaga, NÃO marca o banco
        }
        if (mpStatus !== 'cancelled' && mpStatus !== 'not_found') {
          await cancelMercadoPagoCardSubscription(preapprovalId, { accessToken });
        }
        note =
          mpStatus === 'cancelled'
            ? '(já cancelado no MP)'
            : mpStatus === 'not_found'
              ? '(inexistente no MP)'
              : '(cancelado no MP)';
      }

      await conn.query(
        `UPDATE client_loyalty_subscriptions
            SET status = 'canceled', canceled_at = NOW(), auto_renew = 0
          WHERE id = ? AND status <> 'canceled'`,
        [r.id],
      );

      console.log(`✅ #${r.id} ${note} → banco marcado 'canceled'  [${preapprovalId}]`);
      ok++;
    } catch (err) {
      console.error(`❌ #${r.id} FALHOU: ${err?.message || err}  [${preapprovalId}]`);
      failed++;
    }
  }

  console.log(`\n=== Resumo ===`);
  if (!APPLY) {
    console.log(`Dry-run: ${charging.length} seriam ${DB_ONLY ? 'marcados no banco' : 'cancelados'}. Rode de novo com --yes para efetivar.`);
  } else {
    console.log(`Marcados 'canceled': ${ok} | Falhas: ${failed}`);
    if (failed > 0) console.log('Reveja as falhas acima.');
  }
} finally {
  await conn.end();
}
