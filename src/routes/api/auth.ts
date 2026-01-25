import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getMongoDb } from '../../lib/mongodb.js';
import type { User } from '../../lib/types.js';
import { verifyPassword, hashPassword } from '../../lib/auth-utils.js';
import { send2FACode, sendPasswordResetEmail, sendPasswordChangedNotification } from '../../lib/email-service.js';
import { create2FASession, generateResetToken, verify2FACode } from '../../lib/two-factor-utils.js';

const router = Router();

interface LoginBody {
  email: string;
  password: string;
  remember?: boolean;
  twoFactorCode?: string;
  sessionId?: string; // ID de sesión para 2FA
}

interface TwoFASession {
  userId: string;
  code: string;
  email: string;
  expiresAt: Date;
  verified: boolean;
}

router.post('/login', async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<LoginBody>;
    const email = body.email?.toLowerCase().trim();
    const password = body.password;
    const remember = body.remember ?? false;
    const twoFactorCode = body.twoFactorCode;
    const sessionId = body.sessionId;

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

    // Si el usuario tiene 2FA habilitado
    if (user.twoFactorEnabled) {
      // Si no se proporcionó código 2FA, generar y enviar uno
      if (!twoFactorCode || !sessionId) {
        const twoFASession = create2FASession();
        const sessionDoc = {
          userId: user._id?.toString(),
          code: twoFASession.code,
          email: user.email,
          expiresAt: twoFASession.expiresAt,
          verified: false,
          createdAt: new Date(),
        };

        // Guardar sesión 2FA en la base de datos
        const sessionsCollection = db.collection<TwoFASession>('twoFactorSessions');
        const sessionResult = await sessionsCollection.insertOne(sessionDoc as any);
        const newSessionId = sessionResult.insertedId.toString();

        // Enviar código por email
        await send2FACode(user.email, twoFASession.code);

        return res.json({
          success: true,
          requires2FA: true,
          sessionId: newSessionId,
          message: 'Código de verificación enviado a tu email',
        });
      }

      // Verificar código 2FA
      const sessionsCollection = db.collection<TwoFASession>('twoFactorSessions');
      const session = await sessionsCollection.findOne({
        _id: new ObjectId(sessionId),
        userId: user._id?.toString(),
        verified: false,
      });

      if (!session) {
        return res.status(400).json({
          success: false,
          error: 'Sesión 2FA inválida o expirada',
        });
      }

      // Verificar expiración
      if (new Date() > new Date(session.expiresAt)) {
        await sessionsCollection.deleteOne({ _id: new ObjectId(sessionId) });
        return res.status(400).json({
          success: false,
          error: 'Código de verificación expirado',
        });
      }

      // Verificar código
      if (!verify2FACode(twoFactorCode, session.code)) {
        return res.status(401).json({
          success: false,
          error: 'Código de verificación inválido',
        });
      }

      // Marcar sesión como verificada
      await sessionsCollection.updateOne(
        { _id: new ObjectId(sessionId) },
        { $set: { verified: true } }
      );
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

    // Configuración de cookies común
    const cookieOptions: any = {
      path: '/',
      maxAge: maxAge * 1000,
      sameSite: 'lax' as const,
      httpOnly: false, // Necesario para que el frontend pueda leerlo
    };
    
    // En producción con HTTPS, usar secure
    // En Vercel, verificar si la request viene de HTTPS
    const isSecure = req.secure || 
                     req.headers['x-forwarded-proto'] === 'https' ||
                     process.env.NODE_ENV === 'production';
    
    if (isSecure) {
      cookieOptions.secure = true;
    }

    // Establecer userId PRIMERO (más confiable para identificar al usuario)
    res.cookie('userId', user._id?.toString() || '', cookieOptions);
    console.log(`[LOGIN] ✅ Cookie userId establecida: ${user._id?.toString()}`);

    // Establecer email
    res.cookie('email', user.email, cookieOptions);
    console.log(`[LOGIN] ✅ Cookie email establecida: ${user.email}`);

    // Establecer role
    res.cookie('role', user.role, cookieOptions);
    console.log(`[LOGIN] ✅ Cookie role establecida: ${user.role}`);

    // Establecer customerId (CRÍTICO: debe ser el del usuario encontrado)
    res.cookie('customerId', customerId, cookieOptions);
    console.log(`[LOGIN] ✅ Cookie customerId establecida: ${customerId}`, {
      customerId,
      options: cookieOptions,
      isSecure,
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

// Solicitar recuperación de contraseña
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email es requerido',
      });
    }

    const db = await getMongoDb();
    const user = await db.collection<User>('users').findOne({
      email: email.toLowerCase().trim(),
    });

    // Por seguridad, siempre devolver éxito aunque el usuario no exista
    if (!user) {
      return res.json({
        success: true,
        message: 'Si el email existe, recibirás un enlace de recuperación',
      });
    }

    // Generar token de recuperación
    const resetToken = generateResetToken();
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 1); // Expira en 1 hora

    // Guardar token en la base de datos
    await db.collection<User>('users').updateOne(
      { _id: user._id },
      {
        $set: {
          resetPasswordToken: resetToken,
          resetPasswordExpires: resetExpires,
        },
      }
    );

    // Construir URL de recuperación
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Enviar email
    await sendPasswordResetEmail(user.email, resetToken, resetUrl);

    return res.json({
      success: true,
      message: 'Si el email existe, recibirás un enlace de recuperación',
    });
  } catch (error) {
    console.error('Error en forgot-password:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al procesar la solicitud',
    });
  }
});

// Resetear contraseña
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: 'Token y contraseña son requeridos',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'La contraseña debe tener al menos 8 caracteres',
      });
    }

    const db = await getMongoDb();
    const user = await db.collection<User>('users').findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Token inválido o expirado',
      });
    }

    // Actualizar contraseña
    const newPasswordHash = hashPassword(password);
    await db.collection<User>('users').updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash: newPasswordHash,
          updatedAt: new Date(),
        },
        $unset: {
          resetPasswordToken: '',
          resetPasswordExpires: '',
        },
      }
    );

    // Enviar notificación
    await sendPasswordChangedNotification(user.email);

    return res.json({
      success: true,
      message: 'Contraseña actualizada exitosamente',
    });
  } catch (error) {
    console.error('Error en reset-password:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al resetear la contraseña',
    });
  }
});

// Habilitar/deshabilitar 2FA
router.post('/toggle-2fa', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const { enabled } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'No autorizado',
      });
    }

    const db = await getMongoDb();
    
    // Validar que userId sea un ObjectId válido
    if (!ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        error: 'ID de usuario inválido',
      });
    }

    await db.collection<User>('users').updateOne(
      { _id: new ObjectId(userId) as any },
      {
        $set: {
          twoFactorEnabled: enabled === true,
          updatedAt: new Date(),
        },
      }
    );

    return res.json({
      success: true,
      message: `2FA ${enabled ? 'habilitado' : 'deshabilitado'} exitosamente`,
    });
  } catch (error) {
    console.error('Error en toggle-2fa:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al cambiar estado de 2FA',
    });
  }
});

export default router;
