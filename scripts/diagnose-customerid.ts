import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://admin:admin@cluster01.pxbkzd4.mongodb.net/";
const DB_NAME = process.env.MONGODB_DB || "AuroraSDR";

async function diagnoseCustomerId() {
  console.log('🔍 Diagnóstico de CustomerId en MongoDB\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB\n');

    const db = client.db(DB_NAME);
    const customersCollection = db.collection('customers');
    const usersCollection = db.collection('users');

    // 1. Listar todos los customers
    console.log('📋 CUSTOMERS EN LA BASE DE DATOS:');
    console.log('=' .repeat(60));
    const customers = await customersCollection.find({}).toArray();
    
    customers.forEach((customer, index) => {
      const customerId = customer._id instanceof ObjectId ? customer._id.toString() : String(customer._id);
      console.log(`\n${index + 1}. Customer:`);
      console.log(`   ID: ${customerId}`);
      console.log(`   Nombre: ${customer.nombre || 'N/A'} ${customer.apellido || ''}`);
      console.log(`   Email: ${customer.email || 'N/A'}`);
      console.log(`   Plan: ${customer.planContratado || 'N/A'}`);
      console.log(`   Enabled Views: ${customer.enabledViews?.length || 0} vistas`);
      if (customer.enabledViews && customer.enabledViews.length > 0) {
        console.log(`   Vistas: ${customer.enabledViews.join(', ')}`);
      }
    });

    console.log(`\n✅ Total customers: ${customers.length}\n`);

    // 2. Listar todos los users con sus customerIds
    console.log('👤 USERS EN LA BASE DE DATOS:');
    console.log('=' .repeat(60));
    const users = await usersCollection.find({}).toArray();
    
    users.forEach((user, index) => {
      const userId = user._id instanceof ObjectId ? user._id.toString() : String(user._id);
      let customerIdStr = 'N/A';
      let customerIdType = 'N/A';
      
      if (user.customerId) {
        if (user.customerId instanceof ObjectId) {
          customerIdStr = user.customerId.toString();
          customerIdType = 'ObjectId';
        } else {
          customerIdStr = String(user.customerId);
          customerIdType = typeof user.customerId;
        }
      }
      
      console.log(`\n${index + 1}. User:`);
      console.log(`   ID: ${userId}`);
      console.log(`   Email: ${user.email || 'N/A'}`);
      console.log(`   Nombre: ${user.name || 'N/A'}`);
      console.log(`   Role: ${user.role || 'N/A'}`);
      console.log(`   CustomerId: ${customerIdStr} (tipo: ${customerIdType})`);
      
      // Verificar si el customerId del user existe en customers
      if (customerIdStr !== 'N/A' && ObjectId.isValid(customerIdStr)) {
        const customerExists = customers.some(c => {
          const cId = c._id instanceof ObjectId ? c._id.toString() : String(c._id);
          return cId === customerIdStr;
        });
        
        if (customerExists) {
          console.log(`   ✅ CustomerId existe en customers`);
        } else {
          console.log(`   ❌ CustomerId NO existe en customers`);
        }
      }
    });

    console.log(`\n✅ Total users: ${users.length}\n`);

    // 3. Verificar el customerId específico del error
    const problematicCustomerId = '68fa99cf375510920f932510';
    console.log('🔍 VERIFICACIÓN DEL CUSTOMERID DEL ERROR:');
    console.log('=' .repeat(60));
    console.log(`CustomerId del error: ${problematicCustomerId}`);
    console.log(`Es válido ObjectId: ${ObjectId.isValid(problematicCustomerId)}`);
    
    if (ObjectId.isValid(problematicCustomerId)) {
      const customer = await customersCollection.findOne({
        _id: new ObjectId(problematicCustomerId),
      });
      
      if (customer) {
        console.log(`✅ Customer encontrado:`);
        console.log(`   Nombre: ${customer.nombre} ${customer.apellido}`);
        console.log(`   Email: ${customer.email}`);
        console.log(`   Plan: ${customer.planContratado}`);
      } else {
        console.log(`❌ Customer NO encontrado con ese ID`);
        
        // Buscar customers similares
        console.log(`\n🔍 Buscando IDs similares...`);
        customers.forEach(c => {
          const cId = c._id instanceof ObjectId ? c._id.toString() : String(c._id);
          if (cId.substring(0, 20) === problematicCustomerId.substring(0, 20)) {
            console.log(`   ID similar encontrado: ${cId}`);
            console.log(`   Nombre: ${c.nombre} ${c.apellido}`);
            console.log(`   Email: ${c.email}`);
          }
        });
      }
    } else {
      console.log(`❌ El customerId no es un ObjectId válido`);
    }

    // 4. Verificar relaciones users-customers
    console.log(`\n🔗 RELACIONES USERS-CUSTOMERS:`);
    console.log('=' .repeat(60));
    
    for (const user of users) {
      if (user.customerId) {
        let userCustomerId: string;
        if (user.customerId instanceof ObjectId) {
          userCustomerId = user.customerId.toString();
        } else {
          userCustomerId = String(user.customerId);
        }
        
        if (ObjectId.isValid(userCustomerId)) {
          const customer = await customersCollection.findOne({
            _id: new ObjectId(userCustomerId),
          });
          
          if (customer) {
            console.log(`✅ User "${user.email}" → Customer "${customer.nombre} ${customer.apellido}" (${customer.email})`);
          } else {
            console.log(`❌ User "${user.email}" → CustomerId "${userCustomerId}" NO EXISTE`);
          }
        }
      } else {
        console.log(`⚠️  User "${user.email}" NO tiene customerId asignado`);
      }
    }

    console.log('\n✅ Diagnóstico completado\n');

  } catch (error) {
    console.error('❌ Error en diagnóstico:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('✅ Conexión cerrada');
  }
}

// Ejecutar diagnóstico
diagnoseCustomerId().catch((error) => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});
