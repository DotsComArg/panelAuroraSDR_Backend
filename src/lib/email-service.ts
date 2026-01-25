import sgMail from '@sendgrid/mail';

// Inicializar SendGrid con la API key
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn('⚠️ SENDGRID_API_KEY no está configurada. Los emails no se enviarán.');
}

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@aurorasdr.ai';
const FROM_NAME = process.env.SENDGRID_FROM_NAME || 'Aurora SDR';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Envía un email usando SendGrid
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    if (!process.env.SENDGRID_API_KEY) {
      console.error('❌ SENDGRID_API_KEY no está configurada');
      return false;
    }

    const msg = {
      to: options.to,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME,
      },
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, ''), // Convertir HTML a texto plano
    };

    await sgMail.send(msg);
    console.log(`✅ Email enviado a ${options.to}`);
    return true;
  } catch (error: any) {
    console.error('❌ Error al enviar email:', error);
    if (error.response) {
      console.error('Detalles del error:', error.response.body);
    }
    return false;
  }
}

/**
 * Envía un código de verificación 2FA por email
 */
export async function send2FACode(email: string, code: string): Promise<boolean> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background: linear-gradient(135deg, #9333ea 0%, #3b82f6 100%);
          border-radius: 10px;
          padding: 30px;
          color: white;
        }
        .code-box {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          margin: 20px 0;
          font-size: 32px;
          font-weight: bold;
          letter-spacing: 8px;
          font-family: 'Courier New', monospace;
        }
        .footer {
          margin-top: 20px;
          font-size: 12px;
          opacity: 0.8;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔐 Código de Verificación</h1>
        <p>Tu código de verificación de dos factores es:</p>
        <div class="code-box">${code}</div>
        <p>Este código expirará en 10 minutos.</p>
        <p>Si no solicitaste este código, ignora este email.</p>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Aurora SDR. Todos los derechos reservados.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: '🔐 Código de Verificación - Aurora SDR',
    html,
  });
}

/**
 * Envía un email de recuperación de contraseña
 */
export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
  resetUrl: string
): Promise<boolean> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background: linear-gradient(135deg, #9333ea 0%, #3b82f6 100%);
          border-radius: 10px;
          padding: 30px;
          color: white;
        }
        .button {
          display: inline-block;
          background: white;
          color: #9333ea;
          padding: 15px 30px;
          text-decoration: none;
          border-radius: 5px;
          font-weight: bold;
          margin: 20px 0;
        }
        .footer {
          margin-top: 20px;
          font-size: 12px;
          opacity: 0.8;
        }
        .warning {
          background: rgba(255, 255, 255, 0.2);
          padding: 15px;
          border-radius: 5px;
          margin: 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔑 Recuperación de Contraseña</h1>
        <p>Hemos recibido una solicitud para restablecer tu contraseña.</p>
        <p>Haz clic en el siguiente botón para crear una nueva contraseña:</p>
        <div style="text-align: center;">
          <a href="${resetUrl}" class="button">Restablecer Contraseña</a>
        </div>
        <p>O copia y pega este enlace en tu navegador:</p>
        <p style="word-break: break-all; font-size: 12px; opacity: 0.9;">${resetUrl}</p>
        <div class="warning">
          <p><strong>⚠️ Importante:</strong></p>
          <ul>
            <li>Este enlace expirará en 1 hora</li>
            <li>Si no solicitaste este cambio, ignora este email</li>
            <li>Tu contraseña actual seguirá siendo válida</li>
          </ul>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Aurora SDR. Todos los derechos reservados.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: '🔑 Recuperación de Contraseña - Aurora SDR',
    html,
  });
}

/**
 * Envía una notificación genérica
 */
export async function sendNotification(
  email: string,
  title: string,
  message: string,
  type: 'info' | 'success' | 'warning' | 'error' = 'info'
): Promise<boolean> {
  const colors = {
    info: '#3b82f6',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
  };

  const icons = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌',
  };

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background: linear-gradient(135deg, ${colors[type]} 0%, ${colors[type]}dd 100%);
          border-radius: 10px;
          padding: 30px;
          color: white;
        }
        .footer {
          margin-top: 20px;
          font-size: 12px;
          opacity: 0.8;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>${icons[type]} ${title}</h1>
        <p>${message}</p>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Aurora SDR. Todos los derechos reservados.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `${icons[type]} ${title} - Aurora SDR`,
    html,
  });
}

/**
 * Envía un email de confirmación de cambio de contraseña
 */
export async function sendPasswordChangedNotification(email: string): Promise<boolean> {
  return sendNotification(
    email,
    'Contraseña Actualizada',
    'Tu contraseña ha sido actualizada exitosamente. Si no realizaste este cambio, contacta al soporte inmediatamente.',
    'success'
  );
}

/**
 * Envía un email de bienvenida
 */
export async function sendWelcomeEmail(email: string, name: string): Promise<boolean> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .container {
          background: linear-gradient(135deg, #9333ea 0%, #3b82f6 100%);
          border-radius: 10px;
          padding: 30px;
          color: white;
        }
        .footer {
          margin-top: 20px;
          font-size: 12px;
          opacity: 0.8;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎉 ¡Bienvenido a Aurora SDR!</h1>
        <p>Hola ${name},</p>
        <p>Tu cuenta ha sido creada exitosamente. Ya puedes acceder al panel de control.</p>
        <p>Gracias por unirte a nosotros.</p>
        <div class="footer">
          <p>© ${new Date().getFullYear()} Aurora SDR. Todos los derechos reservados.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: '🎉 ¡Bienvenido a Aurora SDR!',
    html,
  });
}
