import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getMongoDb } from '../../lib/mongodb.js';
import type { Customer, CreateCustomerDto, ViewFeature } from '../../lib/customer-types.js';
import { encrypt, decrypt } from '../../lib/encryption-utils.js';

const router = Router();

// Helper para convertir parámetros a string
const getParamAsString = (param: string | string[] | undefined): string | null => {
  if (!param) return null;
  return Array.isArray(param) ? param[0] : param;
};

// Listar todos los customers
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = await getMongoDb();
    const customers = await db.collection<Customer>('customers').find({}).toArray();
    
    return res.json({
      success: true,
      data: customers.map(c => ({
        ...c,
        _id: c._id?.toString(),
      })),
    });
  } catch (error) {
    console.error('Error al obtener customers:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener clientes',
    });
  }
});

// Obtener customer por ID
router.get('/:customerId', async (req: Request, res: Response) => {
  try {
    const customerIdParam = getParamAsString(req.params.customerId);
    
    if (!customerIdParam || !ObjectId.isValid(customerIdParam)) {
      return res.status(400).json({
        success: false,
        error: 'ID de cliente inválido',
      });
    }

    const db = await getMongoDb();
    const customer = await db.collection<Customer>('customers').findOne({
      _id: new ObjectId(customerIdParam),
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado',
      });
    }

    return res.json({
      success: true,
      data: {
        ...customer,
        _id: customer._id?.toString(),
      },
    });
  } catch (error) {
    console.error('Error al obtener customer:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener cliente',
    });
  }
});

// Buscar customer por email
router.get('/by-email', async (req: Request, res: Response) => {
  try {
    const { email } = req.query;
    
    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Email es requerido',
      });
    }

    const db = await getMongoDb();
    const customer = await db.collection<Customer>('customers').findOne({
      email: email.toLowerCase().trim(),
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado',
      });
    }

    return res.json({
      success: true,
      data: {
        ...customer,
        _id: customer._id?.toString(),
      },
    });
  } catch (error) {
    console.error('Error al buscar customer por email:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al buscar cliente',
    });
  }
});

// Crear nuevo customer
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateCustomerDto;
    
    // Validar campos requeridos
    if (!body.nombre || !body.apellido || !body.email) {
      return res.status(400).json({
        success: false,
        error: 'Nombre, apellido y email son requeridos',
      });
    }

    const db = await getMongoDb();
    
    // Verificar si ya existe un customer con ese email
    const existing = await db.collection<Customer>('customers').findOne({
      email: body.email.toLowerCase().trim(),
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe un cliente con ese email',
      });
    }

    // Encriptar credenciales si existen
    const customerData: Customer = {
      nombre: body.nombre,
      apellido: body.apellido,
      email: body.email.toLowerCase().trim(),
      telefono: body.telefono || '',
      pais: body.pais || '',
      cantidadAgentes: body.cantidadAgentes || 0,
      planContratado: body.planContratado || 'Básico',
      fechaInicio: new Date(body.fechaInicio || Date.now()),
      twoFactorAuth: body.twoFactorAuth || false,
      rol: body.rol || 'Cliente',
      enabledViews: body.enabledViews || [],
      customConfig: body.customConfig || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Encriptar credenciales si existen
    if (body.kommoCredentials?.accessToken) {
      customerData.kommoCredentials = {
        baseUrl: body.kommoCredentials.baseUrl,
        accessToken: encrypt(body.kommoCredentials.accessToken),
        integrationId: body.kommoCredentials.integrationId,
        secretKey: body.kommoCredentials.secretKey ? encrypt(body.kommoCredentials.secretKey) : undefined,
      };
    }

    if (body.postgresCredentials?.connectionString) {
      customerData.postgresCredentials = {
        connectionString: encrypt(body.postgresCredentials.connectionString),
      };
    }

    if (body.openAICredentials?.apiKey) {
      customerData.openAICredentials = {
        apiKey: encrypt(body.openAICredentials.apiKey),
        ...(body.openAICredentials.organizationId && { organizationId: body.openAICredentials.organizationId }),
        ...(body.openAICredentials.projectId && { projectId: body.openAICredentials.projectId }),
      };
    }

    const result = await db.collection<Customer>('customers').insertOne(customerData);

    return res.status(201).json({
      success: true,
      data: {
        ...customerData,
        _id: result.insertedId.toString(),
      },
    });
  } catch (error) {
    console.error('Error al crear customer:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al crear cliente',
    });
  }
});

// Actualizar customer
router.put('/:customerId', async (req: Request, res: Response) => {
  try {
    const customerIdParam = getParamAsString(req.params.customerId);
    const body = req.body as Partial<CreateCustomerDto>;
    
    if (!customerIdParam || !ObjectId.isValid(customerIdParam)) {
      return res.status(400).json({
        success: false,
        error: 'ID de cliente inválido',
      });
    }

    const db = await getMongoDb();
    const existing = await db.collection<Customer>('customers').findOne({
      _id: new ObjectId(customerIdParam),
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado',
      });
    }

    const updateData: Partial<Customer> = {
      updatedAt: new Date(),
    };

    if (body.nombre) updateData.nombre = body.nombre;
    if (body.apellido) updateData.apellido = body.apellido;
    if (body.email) updateData.email = body.email.toLowerCase().trim();
    if (body.telefono !== undefined) updateData.telefono = body.telefono;
    if (body.pais !== undefined) updateData.pais = body.pais;
    if (body.cantidadAgentes !== undefined) updateData.cantidadAgentes = body.cantidadAgentes;
    if (body.planContratado) updateData.planContratado = body.planContratado;
    if (body.fechaInicio) updateData.fechaInicio = new Date(body.fechaInicio);
    if (body.twoFactorAuth !== undefined) updateData.twoFactorAuth = body.twoFactorAuth;
    if (body.rol) updateData.rol = body.rol;
    if (body.enabledViews) updateData.enabledViews = body.enabledViews;
    if (body.customConfig) updateData.customConfig = body.customConfig;

    // Manejar credenciales
    if (body.kommoCredentials) {
      updateData.kommoCredentials = {
        baseUrl: body.kommoCredentials.baseUrl,
        accessToken: encrypt(body.kommoCredentials.accessToken),
        integrationId: body.kommoCredentials.integrationId,
        secretKey: body.kommoCredentials.secretKey ? encrypt(body.kommoCredentials.secretKey) : undefined,
      };
    }

    if (body.postgresCredentials?.connectionString) {
      updateData.postgresCredentials = {
        connectionString: encrypt(body.postgresCredentials.connectionString),
      };
    }

    if (body.openAICredentials?.apiKey) {
      const existingOpenAI = existing.openAICredentials;
      updateData.openAICredentials = {
        apiKey: encrypt(body.openAICredentials.apiKey),
        ...(body.openAICredentials.organizationId && { organizationId: body.openAICredentials.organizationId }),
        ...(body.openAICredentials.projectId && { projectId: body.openAICredentials.projectId }),
        ...(existingOpenAI?.organizationId && !body.openAICredentials.organizationId && { organizationId: existingOpenAI.organizationId }),
        ...(existingOpenAI?.projectId && !body.openAICredentials.projectId && { projectId: existingOpenAI.projectId }),
      };
    }

    const result = await db.collection<Customer>('customers').findOneAndUpdate(
      { _id: new ObjectId(customerIdParam) },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    return res.json({
      success: true,
      data: {
        ...result,
        _id: result?._id?.toString(),
      },
    });
  } catch (error) {
    console.error('Error al actualizar customer:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al actualizar cliente',
    });
  }
});

// Eliminar customer
router.delete('/:customerId', async (req: Request, res: Response) => {
  try {
    const customerIdParam = getParamAsString(req.params.customerId);
    
    if (!customerIdParam || !ObjectId.isValid(customerIdParam)) {
      return res.status(400).json({
        success: false,
        error: 'ID de cliente inválido',
      });
    }

    const db = await getMongoDb();
    const customer = await db.collection<Customer>('customers').findOne({
      _id: new ObjectId(customerIdParam),
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado',
      });
    }

    // Eliminar el customer
    await db.collection<Customer>('customers').deleteOne({
      _id: new ObjectId(customerIdParam),
    });

    // También eliminar usuarios asociados
    await db.collection('users').deleteMany({
      customerId: customerIdParam,
    });

    return res.json({
      success: true,
      message: 'Cliente eliminado correctamente',
    });
  } catch (error) {
    console.error('Error al eliminar customer:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al eliminar cliente',
    });
  }
});

// Obtener lista de features disponibles
router.get('/features/list', async (req: Request, res: Response) => {
  try {
    const features: ViewFeature[] = [
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

    return res.json({
      success: true,
      data: features,
    });
  } catch (error) {
    console.error('Error al obtener features:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener features',
    });
  }
});

// Helper para obtener parámetro de query como string
const getQueryParam = (param: any): string | null => {
  if (!param) return null;
  if (Array.isArray(param)) return param[0] || null;
  if (typeof param === 'string') return param;
  return null;
};

// Obtener features habilitadas de un customer específico
router.get('/features', async (req: Request, res: Response) => {
  try {
    const customerIdParam = getQueryParam(req.query.customerId);
    const emailParam = getQueryParam(req.query.email);
    
    const db = await getMongoDb();
    let customer: Customer | null = null;

    // Buscar por customerId
    if (customerIdParam) {
      if (ObjectId.isValid(customerIdParam)) {
        customer = await db.collection<Customer>('customers').findOne({
          _id: new ObjectId(customerIdParam),
        });
      } else {
        return res.status(400).json({
          success: false,
          error: 'ID de cliente inválido',
        });
      }
    }
    // Buscar por email
    else if (emailParam) {
      customer = await db.collection<Customer>('customers').findOne({
        email: emailParam.toLowerCase().trim(),
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Se requiere customerId o email',
      });
    }
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado',
      });
    }

    // Devolver las vistas/features habilitadas
    return res.json({
      success: true,
      data: {
        _id: customer._id?.toString(),
        enabledViews: customer.enabledViews || [],
      },
    });
  } catch (error) {
    console.error('Error al obtener features del customer:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener features',
    });
  }
});

export default router;
