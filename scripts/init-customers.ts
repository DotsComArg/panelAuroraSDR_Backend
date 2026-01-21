import { MongoClient, ObjectId } from 'mongodb';
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

async function initCustomers() {
  console.log('🔄 Inicializando base de datos de customers...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Conectado a MongoDB\n');

    const db = client.db(DB_NAME);
    const customersCollection = db.collection('customers');
    const usersCollection = db.collection('users');

    // Verificar si ya existen customers
    const existingCount = await customersCollection.countDocuments();
    if (existingCount > 0) {
      console.log(`⚠️  Ya existen ${existingCount} customers en la base de datos.`);
      console.log('   ¿Deseas continuar? Esto agregará más customers.');
      console.log('   Para limpiar y reiniciar, ejecuta primero: npm run clean-customers\n');
    }

    // Customer 1: Aurora SDR IA (Owner)
    const ownerCustomer = {
      nombre: 'Aurora',
      apellido: 'SDR IA',
      email: 'admin@aurorasdr.ai',
      telefono: '+1 555-0100',
      pais: 'Argentina',
      cantidadAgentes: 100, // Sin límite para owners
      planContratado: 'Custom',
      fechaInicio: new Date('2024-01-01'),
      twoFactorAuth: true,
      rol: 'Owner',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Customer 2: Academia MAV (Cliente) - Vistas estándar
    const clientCustomer = {
      nombre: 'Academia',
      apellido: 'MAV',
      email: 'contacto@academiamav.com',
      telefono: '+52 55-1234-5678',
      pais: 'México',
      cantidadAgentes: 1,
      planContratado: 'Profesional',
      fechaInicio: new Date('2024-02-15'),
      twoFactorAuth: false,
      rol: 'Cliente',
      // Vistas estándar para Academia MAV
      enabledViews: ['dashboard', 'agentes', 'ubicaciones', 'analiticas', 'equipo', 'configuracion'],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Customer 3: HubsAutos (Cliente) - Con vistas específicas de autos
    const hubsAutosCustomer = {
      nombre: 'Hubs',
      apellido: 'Autos',
      email: 'hubautos@hubsautos.com',
      telefono: '+1 555-0200',
      pais: 'Estados Unidos',
      cantidadAgentes: 2,
      planContratado: 'Enterprise',
      fechaInicio: new Date('2024-03-01'),
      twoFactorAuth: false,
      rol: 'Cliente',
      // Vistas específicas: incluye las estándar + consultas de vehículos
      enabledViews: [
        'dashboard',
        'agentes',
        'ubicaciones',
        'consultas',    // Vista específica de HubsAutos (consultas de vehículos)
        'analiticas',
        'equipo',
        'configuracion'
      ],
      customConfig: {
        industry: 'automotive',
        features: {
          vehicleManagement: true,
          inventoryTracking: true,
          salesReporting: true
        }
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Insertar customers (solo si no existen)
    console.log('📝 Insertando/Verificando customers...\n');

    // Owner
    let ownerResult;
    const existingOwner = await customersCollection.findOne({ email: ownerCustomer.email });
    if (!existingOwner) {
      ownerResult = await customersCollection.insertOne(ownerCustomer);
      console.log(`✅ Owner creado: ${ownerResult.insertedId}`);
      console.log(`   - Nombre: ${ownerCustomer.nombre} ${ownerCustomer.apellido}`);
      console.log(`   - Email: ${ownerCustomer.email}`);
      console.log(`   - Rol: ${ownerCustomer.rol}\n`);
    } else {
      ownerResult = { insertedId: existingOwner._id };
      console.log(`ℹ️ Owner ya existe: ${existingOwner._id}`);
      console.log(`   - Email: ${ownerCustomer.email}\n`);
    }

    // Academia MAV
    let clientResult;
    const existingClient = await customersCollection.findOne({ email: clientCustomer.email });
    if (!existingClient) {
      clientResult = await customersCollection.insertOne(clientCustomer);
      console.log(`✅ Cliente creado: ${clientResult.insertedId}`);
      console.log(`   - Nombre: ${clientCustomer.nombre} ${clientCustomer.apellido}`);
      console.log(`   - Email: ${clientCustomer.email}`);
      console.log(`   - Rol: ${clientCustomer.rol}`);
      console.log(`   - Agentes: ${clientCustomer.cantidadAgentes}`);
      console.log(`   - Plan: ${clientCustomer.planContratado}`);
      console.log(`   - Vistas: ${clientCustomer.enabledViews?.join(', ')}\n`);
    } else {
      clientResult = { insertedId: existingClient._id };
      console.log(`ℹ️ Cliente Academia MAV ya existe: ${existingClient._id}`);
      console.log(`   - Email: ${clientCustomer.email}\n`);
    }

    // HubsAutos
    let hubsAutosResult;
    const existingHubsAutos = await customersCollection.findOne({ email: hubsAutosCustomer.email });
    if (!existingHubsAutos) {
      hubsAutosResult = await customersCollection.insertOne(hubsAutosCustomer);
      console.log(`✅ Cliente HubsAutos creado: ${hubsAutosResult.insertedId}`);
      console.log(`   - Nombre: ${hubsAutosCustomer.nombre} ${hubsAutosCustomer.apellido}`);
      console.log(`   - Email: ${hubsAutosCustomer.email}`);
      console.log(`   - Rol: ${hubsAutosCustomer.rol}`);
      console.log(`   - Agentes: ${hubsAutosCustomer.cantidadAgentes}`);
      console.log(`   - Plan: ${hubsAutosCustomer.planContratado}`);
      console.log(`   - Vistas: ${hubsAutosCustomer.enabledViews?.join(', ')}\n`);
    } else {
      hubsAutosResult = { insertedId: existingHubsAutos._id };
      console.log(`ℹ️ Cliente HubsAutos ya existe: ${existingHubsAutos._id}`);
      console.log(`   - Email: ${hubsAutosCustomer.email}`);
      // Actualizar las vistas si no las tiene
      if (!existingHubsAutos.enabledViews || !existingHubsAutos.enabledViews.includes('consultas')) {
        await customersCollection.updateOne(
          { _id: existingHubsAutos._id },
          { $set: { enabledViews: hubsAutosCustomer.enabledViews, customConfig: hubsAutosCustomer.customConfig, updatedAt: new Date() } }
        );
        console.log(`   ✅ Vistas actualizadas: ${hubsAutosCustomer.enabledViews?.join(', ')}\n`);
      } else {
        console.log(`   - Vistas: ${existingHubsAutos.enabledViews?.join(', ')}\n`);
      }
    }

    // Crear índices de customers
    console.log('🔍 Creando índices...');
    await customersCollection.createIndex({ email: 1 }, { unique: true });
    await customersCollection.createIndex({ rol: 1 });
    await customersCollection.createIndex({ createdAt: -1 });
    console.log('✅ Índices de customers creados\n');

    // Crear usuarios asociados si no existen
    console.log('👤 Creando usuarios por defecto...\n');

    const existingAdminUser = await usersCollection.findOne({ email: ownerCustomer.email });
    if (!existingAdminUser) {
      const adminUser = {
        email: ownerCustomer.email.toLowerCase(),
        name: `${ownerCustomer.nombre} ${ownerCustomer.apellido}`.trim(),
        role: 'SuperAdmin',
        passwordHash: hashPassword('admin'),
        customerId: (ownerResult.insertedId as ObjectId).toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const adminUserResult = await usersCollection.insertOne(adminUser);
      console.log(`✅ Usuario SuperAdmin creado: ${adminUserResult.insertedId}`);
      console.log(`   - Email: ${adminUser.email}`);
      console.log('   - Password: admin\n');
    } else {
      console.log('ℹ️ Usuario SuperAdmin ya existe, se omite creación.\n');
    }

    const existingClientUser = await usersCollection.findOne({ email: clientCustomer.email });
    if (!existingClientUser) {
      const clientUser = {
        email: clientCustomer.email.toLowerCase(),
        name: `${clientCustomer.nombre} ${clientCustomer.apellido}`.trim(),
        role: 'Cliente',
        passwordHash: hashPassword('cliente'),
        customerId: (clientResult.insertedId as ObjectId).toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const clientUserResult = await usersCollection.insertOne(clientUser);
      console.log(`✅ Usuario Cliente (Academia MAV) creado: ${clientUserResult.insertedId}`);
      console.log(`   - Email: ${clientUser.email}`);
      console.log('   - Password: cliente\n');
    } else {
      console.log('ℹ️ Usuario Cliente (Academia MAV) ya existe, se omite creación.\n');
    }

    // Crear usuario para HubsAutos (el email del usuario puede ser diferente al del customer)
    const hubsAutosUserEmail = 'hubautos';
    const existingHubsAutosUser = await usersCollection.findOne({ email: hubsAutosUserEmail });
    if (!existingHubsAutosUser) {
      const hubsAutosUser = {
        email: hubsAutosUserEmail.toLowerCase(),
        name: `${hubsAutosCustomer.nombre} ${hubsAutosCustomer.apellido}`.trim(),
        role: 'Cliente',
        passwordHash: hashPassword('hubautos123!'),
        customerId: (hubsAutosResult.insertedId as ObjectId).toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const hubsAutosUserResult = await usersCollection.insertOne(hubsAutosUser);
      console.log(`✅ Usuario Cliente (HubsAutos) creado: ${hubsAutosUserResult.insertedId}`);
      console.log(`   - Email: ${hubsAutosUser.email}`);
      console.log('   - Password: hubautos123!\n');
    } else {
      console.log('ℹ️ Usuario Cliente (HubsAutos) ya existe, se omite creación.\n');
    }

    // Índices de users
    console.log('🔍 Creando índices de users...');
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    await usersCollection.createIndex({ role: 1 });
    console.log('✅ Índices de users creados\n');

    console.log('🎉 Base de datos inicializada correctamente!');
    console.log('\n📊 Resumen:');
    console.log(`   - Total customers: ${await customersCollection.countDocuments()}`);
    console.log(`   - Owners: ${await customersCollection.countDocuments({ rol: 'Owner' })}`);
    console.log(`   - Clientes: ${await customersCollection.countDocuments({ rol: 'Cliente' })}`);

  } catch (error) {
    console.error('❌ Error al inicializar customers:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n✅ Conexión cerrada');
  }
}

initCustomers();

