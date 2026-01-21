import { MongoClient, ObjectId } from 'mongodb';
import type { ViewFeature } from '../src/lib/customer-types.js';

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://admin:admin@cluster01.pxbkzd4.mongodb.net/";
const DB_NAME = process.env.MONGODB_DB || "AuroraSDR";

// Vistas válidas disponibles en el sistema
const VALID_VIEWS: ViewFeature[] = [
  'dashboard',
  'agentes',
  'ubicaciones',
  'analiticas',
  'kommo',
  'equipo',
  'configuracion',
  'consultas',
  'tokens',
];

// Función para obtener vistas por defecto según el plan
function getDefaultViews(plan: 'Básico' | 'Profesional' | 'Enterprise' | 'Custom' | string): ViewFeature[] {
  switch (plan) {
    case 'Básico':
      return ['dashboard', 'agentes', 'configuracion'];
    case 'Profesional':
      return ['dashboard', 'agentes', 'ubicaciones', 'analiticas', 'equipo', 'configuracion'];
    case 'Enterprise':
    case 'Custom':
      return ['dashboard', 'agentes', 'ubicaciones', 'analiticas', 'kommo', 'equipo', 'configuracion', 'consultas'];
    default:
      return ['dashboard', 'configuracion'];
  }
}

interface Customer {
  _id: ObjectId;
  nombre: string;
  apellido: string;
  email: string;
  planContratado?: 'Básico' | 'Profesional' | 'Enterprise' | 'Custom';
  enabledViews?: ViewFeature[];
  [key: string]: any;
}

async function migrateFeatures() {
  console.log('🔄 Iniciando migración de features (enabledViews)...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB\n');

    const db = client.db(DB_NAME);
    const customersCollection = db.collection<Customer>('customers');

    // Buscar clientes que necesitan migración
    const customersToMigrate = await customersCollection.find({
      $or: [
        { enabledViews: { $exists: false } },
        { enabledViews: null },
        { enabledViews: [] }
      ]
    }).toArray();

    console.log(`📊 Encontrados ${customersToMigrate.length} clientes sin enabledViews configurado\n`);

    if (customersToMigrate.length === 0) {
      console.log('✅ Todos los clientes ya tienen enabledViews configurado. No se requiere migración.\n');
      return;
    }

    // Mostrar resumen de clientes a migrar
    console.log('📋 Clientes a migrar:');
    customersToMigrate.forEach((customer, index) => {
      const plan = customer.planContratado || 'Básico';
      const defaultViews = getDefaultViews(plan);
      console.log(`   ${index + 1}. ${customer.nombre} ${customer.apellido} (${customer.email})`);
      console.log(`      Plan: ${plan}`);
      console.log(`      Vistas a asignar: ${defaultViews.join(', ')}\n`);
    });

    // Actualizar cada cliente
    console.log('🔄 Actualizando clientes...\n');
    let updatedCount = 0;
    let errorCount = 0;

    for (const customer of customersToMigrate) {
      try {
        const plan = customer.planContratado || 'Básico';
        const defaultViews = getDefaultViews(plan);

        const result = await customersCollection.updateOne(
          { _id: customer._id },
          {
            $set: {
              enabledViews: defaultViews,
              updatedAt: new Date()
            }
          }
        );

        if (result.modifiedCount > 0) {
          updatedCount++;
          console.log(`✅ Cliente actualizado: ${customer.nombre} ${customer.apellido}`);
          console.log(`   - ID: ${customer._id}`);
          console.log(`   - Plan: ${plan}`);
          console.log(`   - Vistas asignadas: ${defaultViews.join(', ')}\n`);
        } else {
          console.log(`⚠️  No se pudo actualizar: ${customer.nombre} ${customer.apellido} (ID: ${customer._id})\n`);
          errorCount++;
        }
      } catch (error) {
        console.error(`❌ Error al actualizar cliente ${customer.nombre} ${customer.apellido}:`, error);
        errorCount++;
      }
    }

    // Verificar resultados
    console.log('\n🔍 Verificando resultados...\n');
    const customersWithViews = await customersCollection.countDocuments({
      enabledViews: { $exists: true, $ne: [], $ne: null }
    });
    const totalCustomers = await customersCollection.countDocuments();

    console.log('📊 Resumen de migración:');
    console.log(`   - Total de clientes: ${totalCustomers}`);
    console.log(`   - Clientes con enabledViews: ${customersWithViews}`);
    console.log(`   - Clientes actualizados: ${updatedCount}`);
    if (errorCount > 0) {
      console.log(`   - Errores: ${errorCount}`);
    }

    // Mostrar algunos ejemplos de clientes actualizados
    console.log('\n📋 Ejemplos de clientes actualizados:');
    const sampleCustomers = await customersCollection.find({
      enabledViews: { $exists: true, $ne: [] }
    }).limit(5).toArray();

    sampleCustomers.forEach((customer) => {
      console.log(`   - ${customer.nombre} ${customer.apellido} (${customer.email})`);
      console.log(`     Plan: ${customer.planContratado || 'Básico'}`);
      console.log(`     Vistas: ${customer.enabledViews?.join(', ') || 'N/A'}\n`);
    });

    console.log('✅ Migración completada exitosamente!\n');

  } catch (error) {
    console.error('❌ Error en la migración:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('✅ Conexión cerrada');
  }
}

// Ejecutar migración
migrateFeatures().catch((error) => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});
