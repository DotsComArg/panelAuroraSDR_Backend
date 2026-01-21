/**
 * Script para cargar credenciales de PostgreSQL usando la API del panel
 * Este script usa la API directamente, por lo que no necesita ENCRYPTION_KEY
 * ya que la API se encarga de encriptar las credenciales
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

// Credenciales de PostgreSQL por cliente
const CREDENTIALS = {
  // Academia MAV
  'contacto@academiamav.com': {
    connectionString: 'postgresql://postgres:zUrQI9Q1_QAT~KA8YMiZ5tl~_HYSm~Kn@yamabiko.proxy.rlwy.net:41643/railway'
  },
  // HubsAutos
  'hubautos@hubsautos.com': {
    connectionString: 'postgresql://postgres:TPeUhas7zVx1G8XsmgLuiO_hLcDjj-iR@yamanote.proxy.rlwy.net:12578/railway'
  }
};

async function loadPostgresCredentialsViaAPI() {
  console.log('🔄 Cargando credenciales de PostgreSQL usando la API...\n');

  try {
    // Primero, obtener todos los clientes
    const customersRes = await fetch(`${API_BASE_URL}/api/customers`);
    const customersData = await customersRes.json();

    if (!customersData.success) {
      throw new Error('Error al obtener clientes: ' + customersData.error);
    }

    const customers = customersData.data;
    console.log(`📋 Encontrados ${customers.length} clientes\n`);

    for (const [email, credentials] of Object.entries(CREDENTIALS)) {
      console.log(`📝 Procesando cliente: ${email}`);
      
      const customer = customers.find((c: any) => c.email === email);
      
      if (!customer) {
        console.log(`   ⚠️  Cliente no encontrado: ${email}\n`);
        continue;
      }

      console.log(`   ✅ Cliente encontrado: ${customer.nombre} ${customer.apellido} (ID: ${customer._id})`);

      // Actualizar cliente con credenciales usando la API
      // Necesitamos enviar todos los campos del cliente para que la actualización funcione
      const updateBody = {
        nombre: customer.nombre,
        apellido: customer.apellido,
        email: customer.email,
        telefono: customer.telefono || '',
        pais: customer.pais || '',
        cantidadAgentes: customer.cantidadAgentes || 1,
        planContratado: customer.planContratado || 'Básico',
        rol: customer.rol || 'Cliente',
        postgresCredentials: {
          connectionString: credentials.connectionString
        }
      };

      const updateRes = await fetch(`${API_BASE_URL}/api/customers/${customer._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateBody)
      });

      const updateData = await updateRes.json();

      if (updateData.success) {
        console.log(`   ✅ Credenciales de PostgreSQL cargadas y encriptadas`);
        console.log(`   - Email: ${email}`);
        console.log(`   - Connection string guardado encriptado en la base de datos\n`);
      } else {
        console.log(`   ❌ Error al actualizar: ${updateData.error}\n`);
      }
    }

    console.log('✅ Proceso completado\n');
  } catch (error: any) {
    console.error('❌ Error al cargar credenciales:', error.message);
    if (error.message.includes('fetch')) {
      console.error('\n💡 Asegúrate de que el servidor Next.js esté corriendo (npm run dev)');
    }
    process.exit(1);
  }
}

// Ejecutar el script
loadPostgresCredentialsViaAPI()
  .then(() => {
    console.log('✨ Script finalizado exitosamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });

