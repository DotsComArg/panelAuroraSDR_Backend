/**
 * Script directo para cargar credenciales de PostgreSQL
 * Usa MongoDB directamente y requiere ENCRYPTION_KEY en el entorno
 */

import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://admin:admin@cluster01.pxbkzd4.mongodb.net/";
const DB_NAME = process.env.MONGODB_DB || "AuroraSDR";

// Función de encriptación inline (misma que encryption-utils.ts)
function encrypt(text: string, encryptionKey: string): string {
  const ALGORITHM = "aes-256-gcm";
  const IV_LENGTH = 16;
  const AUTH_TAG_LENGTH = 16;

  let keyHex = encryptionKey;
  if (keyHex.length < 64) {
    keyHex = crypto.createHash("sha256").update(keyHex).digest("hex");
  }
  const key = Buffer.from(keyHex.slice(0, 64), "hex").slice(0, 32);
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  const combined = Buffer.concat([
    iv,
    authTag,
    Buffer.from(encrypted, "hex"),
  ]);
  
  return combined.toString("base64");
}

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

  // Generar o usar ENCRYPTION_KEY
  let encryptionKey = process.env.ENCRYPTION_KEY;
  
  if (!encryptionKey) {
    console.log('⚠️  ENCRYPTION_KEY no encontrada. Generando una nueva...\n');
    encryptionKey = crypto.randomBytes(32).toString('hex');
    console.log('🔑 Nueva ENCRYPTION_KEY generada:');
    console.log(`   ${encryptionKey}\n`);
    console.log('⚠️  IMPORTANTE: Guarda esta clave en tu archivo .env como:');
    console.log(`   ENCRYPTION_KEY=${encryptionKey}\n`);
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

      console.log(`   ✅ Cliente encontrado: ${customer.nombre} ${customer.apellido}`);

      // Encriptar connection string
      const encryptedConnectionString = encrypt(credentials.connectionString, encryptionKey!);

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
        console.log(`   ✅ Credenciales de PostgreSQL cargadas y encriptadas`);
        console.log(`   - Email: ${email}`);
        console.log(`   - Connection string guardado encriptado\n`);
      } else if (result.matchedCount > 0) {
        console.log(`   ℹ️  Credenciales ya existían, actualizadas\n`);
      } else {
        console.log(`   ⚠️  No se pudo actualizar\n`);
      }
    }

    console.log('✅ Proceso completado\n');
  } catch (error: any) {
    console.error('❌ Error al cargar credenciales:', error.message);
    process.exit(1);
  } finally {
    await client.close();
    console.log('🔌 Desconectado de MongoDB');
  }
}

// Ejecutar el script
loadPostgresCredentials()
  .then(() => {
    console.log('✨ Script finalizado exitosamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });










