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

// ⚠️ IMPORTANTE: Las rutas específicas deben ir ANTES de las rutas con parámetros dinámicos
// para evitar que Express capture rutas como "/features" como si fueran "/:customerId"

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
function getDefaultViews(plan: 'Básico' | 'Profesional' | 'Enterprise' | 'Custom'): ViewFeature[] {
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

// Helper para obtener parámetro de query como string
const getQueryParam = (param: any): string | null => {
  if (!param) return null;
  if (Array.isArray(param)) return param[0] || null;
  if (typeof param === 'string') return param;
  return null;
};

// Obtener lista de features disponibles
router.get('/features/list', async (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      data: VALID_VIEWS,
    });
  } catch (error) {
    console.error('Error al obtener features:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener features',
    });
  }
});

// Obtener features habilitadas de un customer específico
router.get('/features', async (req: Request, res: Response) => {
  try {
    const customerIdParam = getQueryParam(req.query.customerId);
    const emailParam = getQueryParam(req.query.email);
    
    console.log('[FEATURES] Request recibido:', {
      customerId: customerIdParam,
      email: emailParam,
      cookies: {
        email: req.cookies?.email,
        customerId: req.cookies?.customerId,
        userId: req.cookies?.userId
      }
    });
    
    const db = await getMongoDb();
    let customer: Customer | null = null;
    
    // Estrategia 1: Buscar por customerId del query
    if (customerIdParam) {
      const cleanCustomerId = customerIdParam.trim();
      console.log('[FEATURES] Intentando buscar por customerId:', cleanCustomerId);
      
      if (ObjectId.isValid(cleanCustomerId)) {
        try {
          customer = await db.collection<Customer>('customers').findOne({
            _id: new ObjectId(cleanCustomerId),
          });
          
          if (customer) {
            console.log('[FEATURES] ✅ Cliente encontrado por customerId:', customer._id?.toString());
          } else {
            console.log('[FEATURES] ⚠️ CustomerId válido pero no encontrado en BD');
          }
        } catch (error) {
          console.error('[FEATURES] Error al buscar por customerId:', error);
        }
      } else {
        console.log('[FEATURES] ⚠️ CustomerId no es un ObjectId válido:', cleanCustomerId);
      }
    }
    
    // Estrategia 2: Si no se encontró, buscar por email del query
    if (!customer && emailParam) {
      const cleanEmail = emailParam.trim().toLowerCase();
      console.log('[FEATURES] Intentando buscar por email:', cleanEmail);
      
      customer = await db.collection<Customer>('customers').findOne({
        email: cleanEmail,
      });
      
      if (customer) {
        console.log('[FEATURES] ✅ Cliente encontrado por email:', customer._id?.toString());
      }
    }
    
    // Estrategia 3: Si no se encontró, buscar por customerId de las cookies
    if (!customer && req.cookies?.customerId) {
      const cookieCustomerId = req.cookies.customerId.trim();
      console.log('[FEATURES] Intentando buscar por customerId de cookies:', cookieCustomerId);
      
      if (ObjectId.isValid(cookieCustomerId)) {
        try {
          customer = await db.collection<Customer>('customers').findOne({
            _id: new ObjectId(cookieCustomerId),
          });
          
          if (customer) {
            console.log('[FEATURES] ✅ Cliente encontrado por customerId de cookies:', customer._id?.toString());
          }
        } catch (error) {
          console.error('[FEATURES] Error al buscar por customerId de cookies:', error);
        }
      }
    }
    
    // Estrategia 4: Si no se encontró, buscar por usuario actual desde cookies
    if (!customer && req.cookies?.email) {
      const userEmail = req.cookies.email.toLowerCase().trim();
      console.log('[FEATURES] Intentando buscar por usuario desde cookies:', userEmail);
      
      try {
        // Buscar usuario primero para obtener su customerId
        const user = await db.collection('users').findOne({
          email: userEmail,
        });
        
        if (user) {
          console.log('[FEATURES] Usuario encontrado:', {
            userId: user._id?.toString(),
            customerId: user.customerId,
            customerIdType: typeof user.customerId,
            customerIdIsObjectId: user.customerId instanceof ObjectId,
            role: user.role
          });
          
          if (user.customerId) {
            // El customerId en users puede estar como string o ObjectId
            let userCustomerId: string;
            
            if (user.customerId instanceof ObjectId) {
              userCustomerId = user.customerId.toString();
            } else if (typeof user.customerId === 'string') {
              userCustomerId = user.customerId.trim();
            } else {
              userCustomerId = String(user.customerId).trim();
            }
            
            console.log('[FEATURES] CustomerId procesado:', userCustomerId, 'Longitud:', userCustomerId.length);
            
            // Intentar buscar directamente con el string
            if (ObjectId.isValid(userCustomerId)) {
              try {
                customer = await db.collection<Customer>('customers').findOne({
                  _id: new ObjectId(userCustomerId),
                });
                
                if (customer) {
                  console.log('[FEATURES] ✅ Cliente encontrado desde usuario:', customer._id?.toString());
                } else {
                  console.log('[FEATURES] ⚠️ CustomerId válido pero no encontrado en customers');
                  
                  // Intentar buscar todos los customers para debug
                  const allCustomers = await db.collection<Customer>('customers').find({}).toArray();
                  console.log('[FEATURES] DEBUG: Total customers en BD:', allCustomers.length);
                  allCustomers.forEach(c => {
                    console.log('[FEATURES]   - Customer ID:', c._id?.toString(), 'Email:', c.email);
                  });
                }
              } catch (error) {
                console.error('[FEATURES] Error al buscar customer con ObjectId:', error);
              }
            } else {
              console.log('[FEATURES] ⚠️ CustomerId del usuario no es un ObjectId válido:', userCustomerId);
            }
          } else {
            console.log('[FEATURES] ⚠️ Usuario no tiene customerId asignado');
          }
        } else {
          console.log('[FEATURES] ⚠️ Usuario no encontrado en BD con email:', userEmail);
        }
      } catch (error) {
        console.error('[FEATURES] Error al buscar por usuario:', error);
      }
    }
    
    // Estrategia 5: Si no se encontró, buscar por email del usuario en customers directamente
    if (!customer && req.cookies?.email) {
      const userEmail = req.cookies.email.toLowerCase().trim();
      console.log('[FEATURES] Intentando buscar customer directamente por email:', userEmail);
      
      customer = await db.collection<Customer>('customers').findOne({
        email: userEmail,
      });
      
      if (customer) {
        console.log('[FEATURES] ✅ Cliente encontrado por email del usuario:', customer._id?.toString());
      }
    }
    
    // Verificar que existe
    if (!customer) {
      console.error('[FEATURES] ❌ Cliente no encontrado después de todas las estrategias');
      
      // Debug: Listar todos los customers disponibles
      try {
        const allCustomers = await db.collection<Customer>('customers').find({}).toArray();
        console.log('[FEATURES] DEBUG: Total customers en BD:', allCustomers.length);
        allCustomers.forEach(c => {
          console.log('[FEATURES]   - Customer ID:', c._id?.toString(), 'Email:', c.email, 'Nombre:', c.nombre);
        });
      } catch (debugError) {
        console.error('[FEATURES] Error al listar customers para debug:', debugError);
      }
      
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado',
      });
    }
    
    console.log('[FEATURES] ✅ Cliente encontrado:', {
      id: customer._id?.toString(),
      nombre: customer.nombre,
      apellido: customer.apellido,
      email: customer.email,
      plan: customer.planContratado,
      enabledViews: customer.enabledViews?.length || 0
    });
    
    // Obtener vistas: usar enabledViews si existe y tiene elementos, sino usar defaults según plan
    const enabledViews = customer.enabledViews && customer.enabledViews.length > 0
      ? customer.enabledViews.filter(view => VALID_VIEWS.includes(view)) // Filtrar inválidos
      : getDefaultViews(customer.planContratado || 'Básico');
    
    console.log('[FEATURES] Vistas a devolver:', enabledViews);
    
    return res.json({
      success: true,
      data: {
        enabledViews: enabledViews,
      },
    });
  } catch (error) {
    console.error('[FEATURES] ❌ Error al obtener features del customer:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
    });
  }
});

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

// Obtener customer actual del usuario logueado (DEBE ir antes de /:customerId)
router.get('/current', async (req: Request, res: Response) => {
  try {
    const db = await getMongoDb();
    let customer: Customer | null = null;

    console.log('[CURRENT] Obteniendo cliente actual:', {
      email: req.cookies?.email,
      customerId: req.cookies?.customerId,
      userId: req.cookies?.userId
    });

    // Estrategia 1 (PREFERIDA): Buscar por usuario actual desde cookies para obtener su customerId
    if (req.cookies?.email) {
      const userEmail = req.cookies.email.toLowerCase().trim();
      console.log('[CURRENT] Intentando buscar por usuario desde cookies:', userEmail);
      
      try {
        // Buscar usuario primero para obtener su customerId
        const user = await db.collection('users').findOne({
          email: userEmail,
        });
        
        if (user) {
          console.log('[CURRENT] Usuario encontrado:', {
            userId: user._id?.toString(),
            customerId: user.customerId,
            role: user.role
          });
          
          if (user.customerId) {
            // El customerId en users puede estar como string o ObjectId
            let userCustomerId: string;
            const userCustomerIdRaw = user.customerId as any;
            
            if (userCustomerIdRaw instanceof ObjectId) {
              userCustomerId = userCustomerIdRaw.toString();
            } else if (typeof userCustomerIdRaw === 'string') {
              userCustomerId = userCustomerIdRaw.trim();
            } else {
              userCustomerId = String(userCustomerIdRaw).trim();
            }
            
            console.log('[CURRENT] CustomerId del usuario:', userCustomerId);
            
            if (ObjectId.isValid(userCustomerId)) {
              customer = await db.collection<Customer>('customers').findOne({
                _id: new ObjectId(userCustomerId),
              });
              
              if (customer) {
                console.log('[CURRENT] ✅ Cliente encontrado desde usuario:', customer._id?.toString());
              } else {
                console.error('[CURRENT] ⚠️ CustomerId del usuario no existe en customers:', userCustomerId);
              }
            } else {
              console.error('[CURRENT] ⚠️ CustomerId del usuario no es un ObjectId válido:', userCustomerId);
            }
          } else {
            console.error('[CURRENT] ⚠️ Usuario no tiene customerId asignado');
          }
        } else {
          console.error('[CURRENT] ⚠️ Usuario no encontrado en BD con email:', userEmail);
        }
      } catch (error) {
        console.error('[CURRENT] Error al buscar por usuario:', error);
      }
    } else {
      console.error('[CURRENT] ⚠️ No hay email en cookies');
    }

    // Estrategia 2 (FALLBACK): Si no se encontró, buscar por customerId de las cookies
    if (!customer && req.cookies?.customerId) {
      const cookieCustomerId = req.cookies.customerId.trim();
      console.log('[CURRENT] Fallback: Intentando buscar por customerId de cookies:', cookieCustomerId);
      
      if (ObjectId.isValid(cookieCustomerId)) {
        try {
          customer = await db.collection<Customer>('customers').findOne({
            _id: new ObjectId(cookieCustomerId),
          });
          
          if (customer) {
            console.log('[CURRENT] ✅ Cliente encontrado por customerId de cookies (fallback):', customer._id?.toString());
          }
        } catch (error) {
          console.error('[CURRENT] Error al buscar por customerId de cookies:', error);
        }
      }
    }

    // Estrategia 3 (ÚLTIMO FALLBACK): Si no se encontró, buscar por email del usuario en customers directamente
    if (!customer && req.cookies?.email) {
      const userEmail = req.cookies.email.toLowerCase().trim();
      console.log('[CURRENT] Último fallback: Intentando buscar customer directamente por email:', userEmail);
      
      customer = await db.collection<Customer>('customers').findOne({
        email: userEmail,
      });
      
      if (customer) {
        console.log('[CURRENT] ✅ Cliente encontrado por email del usuario (último fallback):', customer._id?.toString());
      }
    }

    if (!customer) {
      console.error('[CURRENT] ❌ Cliente no encontrado para el usuario actual después de todas las estrategias');
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado',
      });
    }

    console.log('[CURRENT] ✅ Cliente actual:', {
      id: customer._id?.toString(),
      nombre: customer.nombre,
      apellido: customer.apellido,
      email: customer.email
    });

    return res.json({
      success: true,
      data: {
        ...customer,
        _id: customer._id?.toString(),
      },
    });
  } catch (error) {
    console.error('[CURRENT] ❌ Error al obtener cliente actual:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener cliente',
    });
  }
});

// Buscar customer por email (DEBE ir antes de /:customerId)
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

// Obtener customer por ID (DEBE ir después de todas las rutas específicas)
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

export default router;
