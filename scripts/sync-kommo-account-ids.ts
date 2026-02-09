/**
 * Script para sincronizar los IDs de cuentas Kommo desde la API y guardarlos en customers.
 * Ejecutar con: npx tsx scripts/sync-kommo-account-ids.ts
 *
 * Requiere: ENCRYPTION_KEY y MONGODB_URI en el entorno.
 */

import { syncKommoAccountIds } from '../src/lib/sync-kommo-account-ids.js';

async function main() {
  console.log('🔄 Sincronizando IDs de cuentas Kommo en customers...\n');

  if (!process.env.ENCRYPTION_KEY) {
    console.error('❌ ENCRYPTION_KEY no está configurada. Configurála en .env');
    process.exit(1);
  }

  const result = await syncKommoAccountIds();

  for (const d of result.details) {
    console.log(`\n📌 ${d.name} (${d.customerId})`);
    if (d.kommo1) {
      const s = d.kommo1;
      if (s.error) console.log(`   ❌ Kommo 1: ${s.error}`);
      else if (s.accountId) console.log(`   ${s.updated ? '✅' : '⏭️'} Kommo 1: accountId=${s.accountId}`);
    }
    if (d.kommoAccounts) {
      d.kommoAccounts.forEach((s, i) => {
        if (s.error) console.log(`   ❌ Kommo ${i + 2}: ${s.error}`);
        else if (s.accountId) console.log(`   ${s.updated ? '✅' : '⏭️'} Kommo ${i + 2}: accountId=${s.accountId}`);
      });
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ Sincronización completada');
  console.log(`   - Total customers: ${result.total}`);
  console.log(`   - Con Kommo: ${result.withKommo}`);
  console.log(`   - Actualizados: ${result.updated}`);
  console.log(`   - Errores: ${result.errors}`);
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});
