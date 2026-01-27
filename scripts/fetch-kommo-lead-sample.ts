/**
 * Script para traer UN lead desde la API de Kommo y ver la estructura completa
 * (custom_fields_values, _embedded.tags, fuente, etc.).
 *
 * Uso (desde la raíz del backend):
 *   npx tsx scripts/fetch-kommo-lead-sample.ts
 *   npx tsx scripts/fetch-kommo-lead-sample.ts 69379d7e108689b7ea498f71
 *
 * Requiere MONGODB_URI y que el cliente tenga kommoCredentials en la BD.
 */
const CUSTOMER_ID = process.argv[2] || '69379d7e108689b7ea498f71';

async function main() {
  console.log('🔍 Obteniendo un lead de muestra de Kommo...');
  console.log('   customerId:', CUSTOMER_ID);
  console.log('');

  const { getKommoCredentialsForCustomer, createKommoClient } = await import(
    '../src/lib/api-kommo.js'
  );

  const credentials = await getKommoCredentialsForCustomer(CUSTOMER_ID.trim());
  if (!credentials) {
    console.error('❌ No se encontraron credenciales Kommo para ese customerId.');
    process.exit(1);
  }
  console.log('✅ Credenciales obtenidas');

  const client = createKommoClient(credentials);
  const listLeads = await client.getLeadsWithFilters({});
  if (!listLeads.length) {
    console.log('⚠️ No hay leads en esta cuenta.');
    process.exit(0);
  }
  console.log('✅ Listado:', listLeads.length, 'leads. Obteniendo el primero completo (GET /leads/:id)...');

  const firstId = listLeads[0].id;
  const fullLead = await client.getLeadById(firstId);
  const lead = fullLead ?? listLeads[0];

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('ESTRUCTURA DEL LEAD (lead completo desde GET /leads/:id)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(JSON.stringify(lead, null, 2));
  console.log('');
  console.log('--- custom_fields_values (campos personalizados, p. ej. fuente) ---');
  console.log(JSON.stringify(lead.custom_fields_values ?? [], null, 2));
  console.log('');
  console.log('--- _embedded.tags ---');
  console.log(JSON.stringify(lead._embedded?.tags ?? [], null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
