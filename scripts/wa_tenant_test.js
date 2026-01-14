/* Usage: node scripts/wa_tenant_test.js <estabelecimento_id> */
const estabId = Number(process.argv[2] || 0);

if (!Number.isFinite(estabId) || estabId <= 0) {
  console.log('Uso: node scripts/wa_tenant_test.js <estabelecimento_id>');
  process.exit(1);
}

(async () => {
  const { getWaAccountByEstabelecimentoId } = await import('../backend/src/services/waTenant.js');
  const { pool } = await import('../backend/src/lib/db.js');
  try {
    const account = await getWaAccountByEstabelecimentoId(estabId);
    if (!account) {
      console.log(`Estabelecimento ${estabId}: sem WhatsApp conectado.`);
      return;
    }
    console.log(`Estabelecimento ${estabId}:`);
    console.log(`- status: ${account.status}`);
    console.log(`- display_phone_number: ${account.display_phone_number || '-'}`);
    console.log(`- phone_number_id: ${account.phone_number_id || '-'}`);
    console.log(`- waba_id: ${account.waba_id || '-'}`);
    console.log(`- business_id: ${account.business_id || '-'}`);
    console.log(`- connected_at: ${account.connected_at || '-'}`);
    console.log(`- updated_at: ${account.updated_at || '-'}`);
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error('[wa_tenant_test] error:', err?.message || err);
  process.exit(1);
});
