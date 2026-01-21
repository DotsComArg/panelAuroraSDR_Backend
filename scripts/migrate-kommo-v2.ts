/**
 * Script para migrar todos los clientes al sistema de caché v2 de Kommo
 * Ejecutar con: npx tsx scripts/migrate-kommo-v2.ts
 */

import { migrateAllToV2 } from '../lib/kommo-cache/migrate-to-v2'

async function main() {
  console.log('🚀 Iniciando migración de Kommo Cache v1 → v2...\n')
  
  try {
    const startTime = Date.now()
    const result = await migrateAllToV2()
    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    
    console.log('\n✅ Migración completada!')
    console.log(`📊 Resumen:`)
    console.log(`   - Total de clientes: ${result.total}`)
    console.log(`   - Migrados exitosamente: ${result.migrated}`)
    console.log(`   - Errores: ${result.errors}`)
    console.log(`   - Tiempo total: ${duration}s\n`)
    
    if (result.errors > 0) {
      console.log('⚠️  Clientes con errores:')
      result.details
        .filter(d => !d.success)
        .forEach(d => {
          console.log(`   - ${d.customerId}: ${d.error}`)
        })
      console.log('')
    }
    
    if (result.migrated > 0) {
      const totalLeads = result.details
        .filter(d => d.success)
        .reduce((sum, d) => sum + d.leadsMigrated, 0)
      console.log(`📈 Total de leads migrados: ${totalLeads.toLocaleString()}\n`)
    }
    
    process.exit(0)
  } catch (error: any) {
    console.error('\n❌ Error durante la migración:', error.message)
    console.error(error)
    process.exit(1)
  }
}

main()
