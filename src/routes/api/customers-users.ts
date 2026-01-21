import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getMongoDb } from '../../lib/mongodb.js';
import type { User, CustomerRole } from '../../lib/types.js';
import { hashPassword } from '../../lib/auth-utils.js';

const router = Router({ mergeParams: true });

// Helper para convertir parámetros a string
const getParamAsString = (param: string | string[] | undefined): string | null => {
  if (!param) return null;
  return Array.isArray(param) ? param[0] : param;
};

// Obtener usuarios de un customer
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
    const users = await db.collection<User>('users')
      .find({ customerId: customerIdParam })
      .toArray();

    return res.json({
      success: true,
      data: users.map(u => ({
        ...u,
        _id: u._id?.toString(),
        passwordHash: undefined, // No enviar el hash de contraseña
      })),
    });
  } catch (error) {
    console.error('Error al obtener usuarios del customer:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener usuarios',
    });
  }
});

// Crear usuario para un customer
router.post('/', async (req: Request, res: Response) => {
  try {
    const customerIdParam = getParamAsString(req.params.customerId);
    const body = req.body as {
      email: string;
      name: string;
      password: string;
      customerRole?: CustomerRole;
      isActive?: boolean;
    };
    
    if (!customerIdParam || !ObjectId.isValid(customerIdParam)) {
      return res.status(400).json({
        success: false,
        error: 'ID de cliente inválido',
      });
    }

    if (!body.email || !body.name || !body.password) {
      return res.status(400).json({
        success: false,
        error: 'Email, nombre y contraseña son requeridos',
      });
    }

    const db = await getMongoDb();
    
    // Verificar que el customer existe
    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(customerIdParam),
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado',
      });
    }

    // Verificar si ya existe un usuario con ese email
    const existing = await db.collection<User>('users').findOne({
      email: body.email.toLowerCase().trim(),
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe un usuario con ese email',
      });
    }

    const user: User = {
      email: body.email.toLowerCase().trim(),
      name: body.name,
      role: 'Cliente',
      customerId: customerIdParam,
      customerRole: body.customerRole || 'Employee',
      isActive: body.isActive !== undefined ? body.isActive : true,
      passwordHash: hashPassword(body.password),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection<User>('users').insertOne(user);

    return res.status(201).json({
      success: true,
      data: {
        ...user,
        _id: result.insertedId.toString(),
        passwordHash: undefined,
      },
    });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al crear usuario',
    });
  }
});

// Actualizar usuario de un customer
router.put('/:userId', async (req: Request, res: Response) => {
  try {
    const customerIdParam = getParamAsString(req.params.customerId);
    const userIdParam = getParamAsString(req.params.userId);
    const body = req.body as {
      email?: string;
      name?: string;
      password?: string;
      customerRole?: CustomerRole;
      isActive?: boolean;
    };
    
    if (!customerIdParam || !userIdParam || !ObjectId.isValid(customerIdParam) || !ObjectId.isValid(userIdParam)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido',
      });
    }

    const db = await getMongoDb();
    
    // Verificar que el usuario pertenece al customer
    const existingUser = await db.collection<User>('users').findOne({
      _id: new ObjectId(userIdParam),
      customerId: customerIdParam as any,
    } as any);

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado',
      });
    }

    const updateData: Partial<User> = {
      updatedAt: new Date(),
    };

    if (body.email) updateData.email = body.email.toLowerCase().trim();
    if (body.name) updateData.name = body.name;
    if (body.password) updateData.passwordHash = hashPassword(body.password);
    if (body.customerRole) updateData.customerRole = body.customerRole;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    // Verificar si el email ya está en uso por otro usuario
    if (body.email && body.email !== existingUser.email) {
      const emailExists = await db.collection<User>('users').findOne({
        email: body.email.toLowerCase().trim(),
        _id: { $ne: new ObjectId(userIdParam) } as any,
      } as any);

      if (emailExists) {
        return res.status(400).json({
          success: false,
          error: 'Ya existe un usuario con ese email',
        });
      }
    }

    const result = await db.collection<User>('users').findOneAndUpdate(
      { _id: new ObjectId(userIdParam), customerId: customerIdParam as any } as any,
      { $set: updateData },
      { returnDocument: 'after' }
    );

    return res.json({
      success: true,
      data: {
        ...result,
        _id: result?._id?.toString(),
        passwordHash: undefined,
      },
    });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al actualizar usuario',
    });
  }
});

// Eliminar usuario de un customer
router.delete('/:userId', async (req: Request, res: Response) => {
  try {
    const customerIdParam = getParamAsString(req.params.customerId);
    const userIdParam = getParamAsString(req.params.userId);
    
    if (!customerIdParam || !userIdParam || !ObjectId.isValid(customerIdParam) || !ObjectId.isValid(userIdParam)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido',
      });
    }

    const db = await getMongoDb();
    
    // Verificar que el usuario pertenece al customer
    const user = await db.collection<User>('users').findOne({
      _id: new ObjectId(userIdParam),
      customerId: customerIdParam as any,
    } as any);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado',
      });
    }

    await db.collection<User>('users').deleteOne({
      _id: new ObjectId(userIdParam),
    });

    return res.json({
      success: true,
      message: 'Usuario eliminado correctamente',
    });
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al eliminar usuario',
    });
  }
});

export default router;
