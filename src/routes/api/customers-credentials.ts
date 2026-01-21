import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getMongoDb } from '../../lib/mongodb.js';
import type { Customer } from '../../lib/customer-types.js';
import { encrypt, decrypt } from '../../lib/encryption-utils.js';

const router = Router({ mergeParams: true });

// Helper para convertir parámetros a string
const getParamAsString = (param: string | string[] | undefined): string | null => {
  if (!param) return null;
  return Array.isArray(param) ? param[0] : param;
};

// Obtener credenciales enmascaradas
router.get('/masked', async (req: Request, res: Response) => {
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

    // Función para enmascarar credenciales
    const maskValue = (value: string, visibleChars = 4) => {
      if (!value || value.length <= visibleChars) return '****';
      return value.slice(0, visibleChars) + '*'.repeat(value.length - visibleChars);
    };

    const maskedCredentials: any = {};

    if (customer.kommoCredentials) {
      maskedCredentials.kommo = {
        baseUrl: customer.kommoCredentials.baseUrl,
        hasAccessToken: !!customer.kommoCredentials.accessToken,
        hasSecretKey: !!customer.kommoCredentials.secretKey,
        integrationId: customer.kommoCredentials.integrationId,
      };
    }

    if (customer.postgresCredentials) {
      maskedCredentials.postgres = {
        hasConnectionString: !!customer.postgresCredentials.connectionString,
      };
    }

    if (customer.openAICredentials) {
      maskedCredentials.openAI = {
        hasApiKey: !!customer.openAICredentials.apiKey,
        organizationId: customer.openAICredentials.organizationId,
        projectId: customer.openAICredentials.projectId,
      };
    }

    return res.json({
      success: true,
      data: maskedCredentials,
    });
  } catch (error) {
    console.error('Error al obtener credenciales enmascaradas:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener credenciales',
    });
  }
});

// Desbloquear credenciales con contraseña de administrador (POST para desbloquear)
router.post('/', async (req: Request, res: Response) => {
  try {
    const customerIdParam = getParamAsString(req.params.customerId);
    const body = req.body as { password?: string };
    
    if (!customerIdParam || !ObjectId.isValid(customerIdParam)) {
      return res.status(400).json({
        success: false,
        error: 'ID de cliente inválido',
      });
    }

    // TODO: Validar contraseña de administrador aquí
    // Por ahora, simplemente devolvemos las credenciales desencriptadas
    
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

    const credentials: any = {};

    if (customer.kommoCredentials) {
      credentials.kommo = {
        baseUrl: customer.kommoCredentials.baseUrl,
        accessToken: customer.kommoCredentials.accessToken ? decrypt(customer.kommoCredentials.accessToken) : undefined,
        integrationId: customer.kommoCredentials.integrationId,
        secretKey: customer.kommoCredentials.secretKey ? decrypt(customer.kommoCredentials.secretKey) : undefined,
      };
    }

    if (customer.postgresCredentials) {
      credentials.postgres = {
        connectionString: customer.postgresCredentials.connectionString 
          ? decrypt(customer.postgresCredentials.connectionString) 
          : undefined,
      };
    }

    if (customer.openAICredentials) {
      credentials.openAI = {
        apiKey: customer.openAICredentials.apiKey ? decrypt(customer.openAICredentials.apiKey) : undefined,
        organizationId: customer.openAICredentials.organizationId,
        projectId: customer.openAICredentials.projectId,
      };
    }

    return res.json({
      success: true,
      data: credentials,
    });
  } catch (error) {
    console.error('Error al desbloquear credenciales:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al desbloquear credenciales',
    });
  }
});

// Obtener credenciales (desencriptadas - usar con precaución)
router.get('/', async (req: Request, res: Response) => {
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

    const credentials: any = {};

    if (customer.kommoCredentials) {
      credentials.kommo = {
        baseUrl: customer.kommoCredentials.baseUrl,
        accessToken: customer.kommoCredentials.accessToken ? decrypt(customer.kommoCredentials.accessToken) : undefined,
        integrationId: customer.kommoCredentials.integrationId,
        secretKey: customer.kommoCredentials.secretKey ? decrypt(customer.kommoCredentials.secretKey) : undefined,
      };
    }

    if (customer.postgresCredentials) {
      credentials.postgres = {
        connectionString: customer.postgresCredentials.connectionString 
          ? decrypt(customer.postgresCredentials.connectionString) 
          : undefined,
      };
    }

    if (customer.openAICredentials) {
      credentials.openAI = {
        apiKey: customer.openAICredentials.apiKey ? decrypt(customer.openAICredentials.apiKey) : undefined,
        organizationId: customer.openAICredentials.organizationId,
        projectId: customer.openAICredentials.projectId,
      };
    }

    return res.json({
      success: true,
      data: credentials,
    });
  } catch (error) {
    console.error('Error al obtener credenciales:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener credenciales',
    });
  }
});

// Actualizar credenciales
router.put('/', async (req: Request, res: Response) => {
  try {
    const customerIdParam = getParamAsString(req.params.customerId);
    const body = req.body as {
      kommo?: any;
      postgres?: any;
      openAI?: any;
    };
    
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

    const updateData: Partial<Customer> = {
      updatedAt: new Date(),
    };

    if (body.kommo) {
      const existingKommo = customer.kommoCredentials;
      updateData.kommoCredentials = {
        baseUrl: body.kommo.baseUrl || existingKommo?.baseUrl || '',
        accessToken: body.kommo.accessToken 
          ? encrypt(body.kommo.accessToken) 
          : (existingKommo?.accessToken || ''),
        integrationId: body.kommo.integrationId || existingKommo?.integrationId,
        secretKey: body.kommo.secretKey 
          ? encrypt(body.kommo.secretKey) 
          : existingKommo?.secretKey,
      };
    }

    if (body.postgres) {
      updateData.postgresCredentials = {
        connectionString: body.postgres.connectionString 
          ? encrypt(body.postgres.connectionString) 
          : (customer.postgresCredentials?.connectionString || ''),
      };
    }

    if (body.openAI) {
      const existingOpenAI = customer.openAICredentials;
      updateData.openAICredentials = {
        apiKey: body.openAI.apiKey 
          ? encrypt(body.openAI.apiKey) 
          : (existingOpenAI?.apiKey || ''),
        ...(body.openAI.organizationId && { organizationId: body.openAI.organizationId }),
        ...(body.openAI.projectId && { projectId: body.openAI.projectId }),
        ...(existingOpenAI?.organizationId && !body.openAI.organizationId && { organizationId: existingOpenAI.organizationId }),
        ...(existingOpenAI?.projectId && !body.openAI.projectId && { projectId: existingOpenAI.projectId }),
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
    console.error('Error al actualizar credenciales:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al actualizar credenciales',
    });
  }
});

export default router;
