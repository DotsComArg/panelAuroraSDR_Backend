import { MongoClient, ObjectId } from 'mongodb';
import { encrypt } from '../lib/encryption-utils';

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://admin:admin@cluster01.pxbkzd4.mongodb.net/";
const DB_NAME = process.env.MONGODB_DB || "AuroraSDR";

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

async function loadPostgresCredentials() {
  console.log('🔄 Cargando credenciales de PostgreSQL en los perfiles de clientes...\n');

  // Cargar variables de entorno desde .env si existe
  try {
    require('dotenv').config();
  } catch (e) {
    // dotenv no está instalado, continuar
  }

  if (!process.env.ENCRYPTION_KEY) {
    console.error('❌ ERROR: ENCRYPTION_KEY no está configurada en las variables de entorno.');
    console.error('   Por favor, configura ENCRYPTION_KEY en tu archivo .env');
    console.error('   Puedes generar una con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB\n');

    const db = client.db(DB_NAME);
    const customersCollection = db.collection('customers');

    for (const [email, credentials] of Object.entries(CREDENTIALS)) {
      console.log(`📝 Procesando cliente: ${email}`);
      
      const customer = await customersCollection.findOne({ email });
      
      if (!customer) {
        console.log(`   ⚠️  Cliente no encontrado: ${email}\n`);
        continue;
      }

      // Encriptar connection string
      const encryptedConnectionString = encrypt(credentials.connectionString);

      // Actualizar cliente con credenciales encriptadas
      const result = await customersCollection.updateOne(
        { _id: customer._id },
        {
          $set: {
            postgresCredentials: {
              connectionString: encryptedConnectionString
            },
            updatedAt: new Date()
          }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`   ✅ Credenciales de PostgreSQL cargadas para: ${customer.nombre} ${customer.apellido}`);
        console.log(`   - Email: ${email}`);
        console.log(`   - Connection string encriptado y guardado\n`);
      } else {
        console.log(`   ℹ️  Cliente ya tenía credenciales o no se pudo actualizar\n`);
      }
    }

    console.log('✅ Proceso completado\n');
  } catch (error) {
    console.error('❌ Error al cargar credenciales:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 Desconectado de MongoDB');
  }
}

// Ejecutar el script
loadPostgresCredentials()
  .then(() => {
    console.log('\n✨ Script finalizado exitosamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });

