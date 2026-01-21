import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://admin:admin@cluster01.pxbkzd4.mongodb.net/";
const DB_NAME = process.env.MONGODB_DB || "AuroraSDR";

// Función de hash local para el script
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");
  return `${salt}:${hash}`;
}

async function updatePasswords() {
  console.log('🔄 Actualizando contraseñas en MongoDB...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB\n');

    const db = client.db(DB_NAME);
    const usersCollection = db.collection('users');

    // Mapeo de usuarios y sus contraseñas
    const usersToUpdate = [
      { email: 'admin@aurorasdr.ai', password: 'admin' },
      { email: 'contacto@academiamav.com', password: 'cliente' },
      { email: 'hubautos', password: 'hubautos123!' },
    ];

    console.log('🔐 Actualizando contraseñas encriptadas...\n');

    for (const userData of usersToUpdate) {
      const user = await usersCollection.findOne({ email: userData.email });
      
      if (user) {
        // Verificar si ya tiene passwordHash válido (formato salt:hash)
        const hasValidHash = user.passwordHash && user.passwordHash.includes(':') && user.passwordHash.length > 20;
        
        if (!hasValidHash) {
          const passwordHash = hashPassword(userData.password);
          await usersCollection.updateOne(
            { email: userData.email },
            { 
              $set: { 
                passwordHash,
                updatedAt: new Date()
              } 
            }
          );
          console.log(`✅ Contraseña actualizada para: ${userData.email}`);
        } else {
          console.log(`ℹ️ Contraseña ya encriptada para: ${userData.email}`);
        }
      } else {
        console.log(`⚠️ Usuario no encontrado: ${userData.email}`);
      }
    }

    console.log('\n🎉 Proceso completado!');
    console.log('\n📊 Resumen:');
    const totalUsers = await usersCollection.countDocuments();
    const usersWithHash = await usersCollection.countDocuments({ passwordHash: { $exists: true, $ne: null } });
    console.log(`   - Total usuarios: ${totalUsers}`);
    console.log(`   - Usuarios con contraseña encriptada: ${usersWithHash}`);

  } catch (error) {
    console.error('❌ Error al actualizar contraseñas:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n✅ Conexión cerrada');
  }
}

updatePasswords();










