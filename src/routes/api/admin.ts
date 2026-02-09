import { Router, Request, Response } from 'express';
import { send2FACode, sendPasswordResetEmail, sendWelcomeEmail } from '../../lib/email-service.js';
import { create2FASession, generateResetToken } from '../../lib/two-factor-utils.js';
import { syncKommoAccountIds } from '../../lib/sync-kommo-account-ids.js';

const router = Router();

// Middleware para verificar que el usuario es SuperAdmin
const requireSuperAdmin = async (req: Request, res: Response, next: Function) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    const role = req.headers['x-user-email'] ? 
      (req.cookies?.role || req.headers['x-user-role']) : null;

    // Por ahora, permitir acceso si hay userId (en producción deberías verificar el role en la BD)
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'No autorizado',
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'No autorizado',
    });
  }
};

// Aplicar middleware a todas las rutas
router.use(requireSuperAdmin);

// Probar email de recuperación de contraseña
router.post('/test-email/passwordReset', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email es requerido',
      });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Email inválido',
      });
    }

    // Generar token de prueba (no se guarda en BD, solo para el email)
    const resetToken = generateResetToken();
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Enviar email
    const sent = await sendPasswordResetEmail(email, resetToken, resetUrl);

    if (sent) {
      return res.json({
        success: true,
        message: `Email de recuperación de contraseña enviado a ${email}`,
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Error al enviar el email. Verifica la configuración de SendGrid.',
      });
    }
  } catch (error) {
    console.error('Error en test-email/passwordReset:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al enviar el email',
    });
  }
});

// Probar email de bienvenida
router.post('/test-email/welcome', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email es requerido',
      });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Email inválido',
      });
    }

    // Extraer nombre del email (parte antes del @) para el email de bienvenida
    const name = email.split('@')[0];

    // Enviar email
    const sent = await sendWelcomeEmail(email, name);

    if (sent) {
      return res.json({
        success: true,
        message: `Email de bienvenida enviado a ${email}`,
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Error al enviar el email. Verifica la configuración de SendGrid.',
      });
    }
  } catch (error) {
    console.error('Error en test-email/welcome:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al enviar el email',
    });
  }
});

// Sincronizar IDs de cuentas Kommo desde la API y guardarlos en customers (para webhooks)
router.post('/sync-kommo-account-ids', async (req: Request, res: Response) => {
  try {
    const result = await syncKommoAccountIds();
    return res.json({
      success: true,
      message: `Sincronización completada: ${result.updated} actualizados, ${result.errors} errores`,
      data: result,
    });
  } catch (error: any) {
    console.error('Error al sincronizar account IDs Kommo:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Error al sincronizar IDs de Kommo',
    });
  }
});

// Probar email de 2FA
router.post('/test-email/twoFA', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email es requerido',
      });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Email inválido',
      });
    }

    // Generar código 2FA
    const twoFASession = create2FASession();

    // Enviar email
    const sent = await send2FACode(email, twoFASession.code);

    if (sent) {
      return res.json({
        success: true,
        message: `Código 2FA enviado a ${email}. Código: ${twoFASession.code} (solo para pruebas)`,
        code: twoFASession.code, // Solo para desarrollo/testing
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Error al enviar el email. Verifica la configuración de SendGrid.',
      });
    }
  } catch (error) {
    console.error('Error en test-email/twoFA:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al enviar el email',
    });
  }
});

export default router;
