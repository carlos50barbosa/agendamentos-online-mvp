// backend/scripts/list-mp-loyalty-subs.mjs
// READ-ONLY. Lista assinaturas de fidelidade (client_loyalty_subscriptions) que
// ainda podem estar COBRANDO via Mercado Pago (preapproval recorrente de cartão),
// para você cancelar manualmente no painel do MP. Não escreve nada no banco.
//
// Uso (onde o banco de prod é alcançável — ex.: na VPS, com o .env do backend):
//   node scripts/list-mp-loyalty-subs.mjs
import mysql from 'mysql2/promise';
import { config } from '../src/lib/config.js';

// Status em que uma assinatura ainda está "viva" (autorizada a cobrar de novo).
const CHARGING_STATUSES = new Set(['trialing', 'active', 'past_due', 'pending_payment']);

const conn = await mysql.createConnection({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.pass,
  database: config.db.name,
});

function fmt(v) {
  if (v == null) return '-';
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace('T', ' ');
  return String(v);
}

try {
  let rows;
  try {
    [rows] = await conn.query(
      `SELECT cls.id, cls.status, cls.payment_method, cls.gateway, cls.auto_renew,
              cls.gateway_subscription_id, cls.mp_preapproval_id,
              cls.next_billing_at, cls.last_payment_at,
              cls.loyalty_plan_id,
              cu.nome AS cliente_nome, cu.email AS cliente_email,
              eu.nome AS estab_nome
         FROM client_loyalty_subscriptions cls
         LEFT JOIN usuarios cu ON cu.id = cls.cliente_id
         LEFT JOIN usuarios eu ON eu.id = cls.estabelecimento_id
        WHERE (cls.gateway = 'mercadopago' OR cls.gateway IS NULL)
        ORDER BY FIELD(cls.status,'active','trialing','past_due','pending_payment') , cls.id`,
    );
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      console.log('Tabela client_loyalty_subscriptions não existe neste banco — fidelidade nunca foi usada aqui. Nada a cancelar.');
      process.exit(0);
    }
    if (err?.code === 'ER_BAD_FIELD_ERROR') {
      console.error('Coluna ausente (mp_preapproval_id?). Este banco pode não ter a migração 2026-04-24. Detalhe:', err.message);
      process.exit(2);
    }
    throw err;
  }

  const all = rows || [];
  // "Cobrando" = cartão recorrente, auto_renew ligado, status vivo, e com preapproval no MP.
  const charging = all.filter(
    (r) =>
      String(r.payment_method) === 'credit_card' &&
      Number(r.auto_renew) === 1 &&
      CHARGING_STATUSES.has(String(r.status)) &&
      (r.mp_preapproval_id || r.gateway_subscription_id),
  );

  console.log(`\n=== Assinaturas de fidelidade MP: ${all.length} no total ===\n`);
  if (all.length === 0) {
    console.log('✅ Nenhuma assinatura de fidelidade — nada vazando pelo MP.');
    process.exit(0);
  }

  for (const r of all) {
    const isCharging = charging.includes(r);
    const flag = isCharging ? '🔴 COBRANDO' : '⚪ inerte  ';
    const preapproval = r.mp_preapproval_id || r.gateway_subscription_id || '-';
    console.log(
      `${flag}  #${r.id}  [${fmt(r.status)}/${fmt(r.payment_method)}]  ` +
        `cliente="${fmt(r.cliente_nome)}" <${fmt(r.cliente_email)}>  estab="${fmt(r.estab_nome)}"  ` +
        `plano_id=${fmt(r.loyalty_plan_id)}  preapproval=${preapproval}  ` +
        `auto_renew=${fmt(r.auto_renew)}  next=${fmt(r.next_billing_at)}  last=${fmt(r.last_payment_at)}`,
    );
  }

  console.log(`\n=== Resumo ===`);
  console.log(`Total: ${all.length}`);
  console.log(`🔴 Ainda cobrando via MP (cancelar no painel): ${charging.length}`);
  if (charging.length > 0) {
    console.log(`\nPreapprovals a cancelar no painel do Mercado Pago:`);
    for (const r of charging) {
      console.log(`  - ${r.mp_preapproval_id || r.gateway_subscription_id}  (assinatura #${r.id})`);
    }
    console.log(
      `\nComo cancelar: painel MP → Assinaturas/Preapprovals → localizar pelo id acima → Cancelar.` +
        `\n(Este script NÃO cancela nada — só lista. Cancelamento em massa via API só com seu OK.)`,
    );
  } else {
    console.log(`✅ Nenhuma assinatura MP recorrente ativa — nada vazando pelo MP.`);
  }
} finally {
  await conn.end();
}
