import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getMongoDb } from '../../lib/mongodb.js';
import type { User } from '../../lib/types.js';
import { verifyPassword } from '../../lib/auth-utils.js';

const router = Router();

interface LoginBody {
  email: string;
  password: string;
  remember?: boolean;
}

router.post('/login', async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<LoginBody>;
    const email = body.email?.toLowerCase().trim();
    const password = body.password;
    const remember = body.remember ?? false;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email y contraseña son requeridos',
      });
    }

    const db = await getMongoDb();

    // Buscar usuario por email O por nombre de usuario (name)
    let user = await db.collection<User>('users').findOne({
      $or: [
        { email: email },
        { name: { $regex: new RegExp(`^${email}$`, 'i') } },
      ],
    });

    // Si no se encuentra, buscar por email del customer asociado
    if (!user) {
      const customer = await db.collection('customers').findOne({ email: email });
      if (customer) {
        user = await db.collection<User>('users').findOne({
          customerId: customer._id?.toString(),
        });
      }
    }

    if (!user || !user.passwordHash) {
      console.error(`[LOGIN] Usuario no encontrado en MongoDB con: ${email}`);
      return res.status(401).json({
        success: false,
        error: 'Credenciales inválidas',
      });
    }

    // Verificar contraseña
    const isValid = verifyPassword(password, user.passwordHash);

    if (!isValid) {
      console.error(`[LOGIN] Contraseña inválida para: ${email}`);
      return res.status(401).json({
        success: false,
        error: 'Credenciales inválidas',
      });
    }

    // Obtener customerId del usuario (CRÍTICO: debe ser del usuario encontrado)
    let customerId: string | undefined = undefined;
    
    if (user.customerId) {
      // El customerId puede estar como ObjectId o string
      const userCustomerId = user.customerId as any;
      if (userCustomerId instanceof ObjectId) {
        customerId = userCustomerId.toString();
      } else {
        customerId = String(userCustomerId).trim();
      }
      console.log(`[LOGIN] ✅ CustomerId obtenido del usuario: ${customerId}`);
    } else {
      // Si el usuario no tiene customerId, es un error
      console.error(`[LOGIN] ❌ Usuario no tiene customerId asociado: ${user.email}`);
      return res.status(400).json({
        success: false,
        error: 'Usuario no tiene un cliente asociado',
      });
    }

    // Cookies de sesión
    const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 24; // 30 días o 1 día

    res.cookie('email', user.email, {
      path: '/',
      maxAge: maxAge * 1000,
      sameSite: 'lax',
      httpOnly: false, // Necesario para que el frontend pueda leerlo
    });

    res.cookie('role', user.role, {
      path: '/',
      maxAge: maxAge * 1000,
      sameSite: 'lax',
      httpOnly: false,
    });

    // Establecer customerId en cookies (CRÍTICO: debe ser el del usuario)
    const cookieOptions: any = {
      path: '/',
      maxAge: maxAge * 1000,
      sameSite: 'lax' as const,
      httpOnly: false, // Necesario para que el frontend pueda leerlo
    };
    
    // En producción, solo usar secure si estamos en HTTPS
    // En Vercel, las cookies funcionan sin secure si el dominio es correcto
    if (process.env.NODE_ENV === 'production' && req.secure) {
      cookieOptions.secure = true;
    }
    
    res.cookie('customerId', customerId, cookieOptions);
    console.log(`[LOGIN] ✅ Cookie customerId establecida: ${customerId}`, {
      customerId,
      options: cookieOptions,
      headers: res.getHeaders(),
    });

    res.cookie('userId', user._id?.toString() || '', {
      path: '/',
      maxAge: maxAge * 1000,
      sameSite: 'lax',
      httpOnly: false,
    });

    console.log(`[LOGIN] ✅ Login exitoso - Usuario: ${user.email}, Role: ${user.role}, CustomerId: ${customerId || 'N/A'}`);

    return res.json({
      success: true,
      data: {
        _id: user._id?.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        customerId: customerId,
        redirectUrl: user.role === 'SuperAdmin' ? '/admin' : '/',
      },
    });
  } catch (error) {
    console.error('Error en login:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al iniciar sesión',
    });
  }
});

export default router;
