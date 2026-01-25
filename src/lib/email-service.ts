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
 * Genera el HTML del logo de Aurora para los emails
 */
function getAuroraLogo(): string {
  return `
    <div style="text-align: center; margin-bottom: 30px;">
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 346.81 100" style="max-width: 200px; height: auto; margin: 0 auto;">
        <defs>
          <style>
            .cls-1 { stroke: url(#Degradado_sin_nombre_143); }
            .cls-1, .cls-2, .cls-3, .cls-4, .cls-5, .cls-6, .cls-7, .cls-8, .cls-9, .cls-10 {
              fill: none;
              stroke-miterlimit: 10;
              stroke-width: .5px;
            }
            .cls-2 { stroke: url(#Degradado_sin_nombre_143-5); }
            .cls-3 { stroke: url(#Degradado_sin_nombre_143-3); }
            .cls-4 { stroke: url(#Degradado_sin_nombre_143-7); }
            .cls-5 { stroke: url(#Degradado_sin_nombre_143-9); }
            .cls-6 { stroke: url(#Degradado_sin_nombre_143-8); }
            .cls-7 { stroke: url(#Degradado_sin_nombre_143-6); }
            .cls-8 { stroke: url(#Degradado_sin_nombre_143-10); }
            .cls-9 { stroke: url(#Degradado_sin_nombre_143-4); }
            .cls-10 { stroke: url(#Degradado_sin_nombre_143-2); }
          </style>
          <linearGradient id="Degradado_sin_nombre_143" x1="10.56" y1="42.86" x2="72.96" y2="42.86" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#241d7c"/>
            <stop offset=".5" stop-color="#4b3dfd"/>
            <stop offset="1" stop-color="#241d7c"/>
          </linearGradient>
          <linearGradient id="Degradado_sin_nombre_143-2" x1="12.57" y1="42.47" x2="70.95" y2="42.47" xlink:href="#Degradado_sin_nombre_143"/>
          <linearGradient id="Degradado_sin_nombre_143-3" x1="14.57" y1="42.08" x2="68.94" y2="42.08" xlink:href="#Degradado_sin_nombre_143"/>
          <linearGradient id="Degradado_sin_nombre_143-4" x1="16.58" y1="41.69" x2="66.93" y2="41.69" xlink:href="#Degradado_sin_nombre_143"/>
          <linearGradient id="Degradado_sin_nombre_143-5" x1="18.59" y1="41.31" x2="64.92" y2="41.31" xlink:href="#Degradado_sin_nombre_143"/>
          <linearGradient id="Degradado_sin_nombre_143-6" x1="20.59" y1="40.93" x2="62.91" y2="40.93" xlink:href="#Degradado_sin_nombre_143"/>
          <linearGradient id="Degradado_sin_nombre_143-7" x1="22.59" y1="40.56" x2="60.91" y2="40.56" xlink:href="#Degradado_sin_nombre_143"/>
          <linearGradient id="Degradado_sin_nombre_143-8" x1="24.59" y1="40.19" x2="58.9" y2="40.19" xlink:href="#Degradado_sin_nombre_143"/>
          <linearGradient id="Degradado_sin_nombre_143-9" x1="26.58" y1="39.83" x2="56.91" y2="39.83" xlink:href="#Degradado_sin_nombre_143"/>
          <linearGradient id="Degradado_sin_nombre_143-10" x1="28.55" y1="39.48" x2="54.92" y2="39.48" xlink:href="#Degradado_sin_nombre_143"/>
        </defs>
        <g>
          <path class="cls-1" d="M41.72,38.1c-11.14.26-9.96,23.7-17.19,29.21-1.94,1.47-14.21,1.49-13.71.33l21.66-50.45c.35-.67.92-.84,1.71-.97,1.58-.25,13.69-.15,16.24.2.26.04.95.45,1.04.67,7.19,17.2,14,33.59,21.19,50.79,1,2.39-11.73,2.21-13.72.34-7.58-7.12-7.03-30.36-17.22-30.12Z"/>
          <path class="cls-10" d="M41.7,39.01c-10.16.23-9.55,21.45-16.37,26.48-1.9,1.4-13.01,1.25-12.5.06l20.2-47.15c.33-.63.87-.79,1.61-.91,1.47-.23,12.65-.12,15.15.18.32.04,1.02.46,1.13.72,6.73,16.11,13.03,31.35,19.72,47.41.95,2.29-10.56,2.29-12.51.54-7.21-6.5-7.17-27.54-16.43-27.32Z"/>
          <path class="cls-3" d="M41.69,39.92c-9.18.2-9.16,19.2-15.55,23.75-1.86,1.32-11.81,1.01-11.29-.22l18.74-43.84c.31-.59.81-.74,1.51-.85,1.36-.21,11.62-.11,14.07.16.38.04,1.08.46,1.21.78,6.27,15.01,12.06,29.12,18.26,44.02.91,2.19-9.4,2.37-11.3.74-6.84-5.87-7.3-24.71-15.65-24.53Z"/>
          <path class="cls-9" d="M41.67,40.82c-8.2.17-8.76,16.94-14.74,21.02-1.82,1.24-10.61.77-10.08-.5l17.28-40.54c.29-.55.76-.69,1.41-.8,1.25-.2,10.58-.09,12.98.14.45.04,1.15.47,1.3.83,5.82,13.92,11.1,26.88,16.8,40.64.86,2.09-8.24,2.44-10.09.94-6.46-5.25-7.44-21.89-14.87-21.73Z"/>
          <path class="cls-2" d="M41.65,41.73c-7.23.15-8.38,14.67-13.92,18.3-1.78,1.17-9.42.53-8.87-.78l15.82-37.24c.27-.51.7-.64,1.31-.74,1.14-.18,9.54-.09,11.89.11.51.04,1.21.47,1.39.89,5.36,12.82,10.13,24.64,15.34,37.25.82,1.98-7.07,2.52-8.88,1.14-6.07-4.64-7.57-19.07-14.09-18.93Z"/>
          <path class="cls-7" d="M41.63,42.64c-6.25.12-7.99,12.4-13.1,15.57-1.75,1.08-8.22.29-7.66-1.05l14.36-33.94c.25-.47.65-.59,1.21-.68,1.03-.16,8.51-.08,10.8.09.57.04,1.28.48,1.47.94,4.9,11.72,9.17,22.41,13.88,33.86.77,1.88-5.9,2.59-7.66,1.34-5.68-4.04-7.71-16.24-13.3-16.14Z"/>
          <path class="cls-4" d="M41.62,43.55c-5.27.09-7.62,10.12-12.28,12.84-1.71,1-7.02.04-6.45-1.33l12.9-30.63c.23-.43.6-.54,1.11-.62.92-.14,7.47-.08,9.72.07.63.04,1.34.48,1.56,1,4.44,10.63,8.2,20.17,12.42,30.48.73,1.78-4.73,2.66-6.45,1.54-5.27-3.44-7.84-13.42-12.52-13.34Z"/>
          <path class="cls-6" d="M41.6,44.46c-4.29.06-7.25,7.82-11.46,10.12-1.68.91-5.83-.2-5.24-1.61l11.44-27.33c.21-.39.54-.49,1.01-.57.81-.13,6.43-.08,8.63.05.7.04,1.41.49,1.64,1.05,3.98,9.53,7.23,17.94,10.96,27.09.68,1.68-3.56,2.73-5.24,1.73-4.86-2.86-7.98-10.6-11.74-10.55Z"/>
          <path class="cls-5" d="M41.58,45.36c-3.32.03-6.88,5.52-10.64,7.39-1.65.82-4.63-.44-4.03-1.89l9.98-24.03c.19-.35.49-.44.91-.51.7-.11,5.4-.08,7.54.03.76.04,1.47.49,1.73,1.11,3.52,8.43,6.27,15.7,9.5,23.71.64,1.58-2.38,2.79-4.03,1.93-4.45-2.29-8.11-7.78-10.95-7.75Z"/>
          <path class="cls-8" d="M41.56,46.27c-2.34,0-6.52,3.2-9.83,4.66-1.63.72-3.43-.68-2.82-2.16l8.52-20.72c.17-.31.43-.39.8-.45.59-.09,4.36-.08,6.46,0,.82.04,1.54.5,1.82,1.16,3.07,7.34,5.3,13.46,8.04,20.32.59,1.48-1.2,2.84-2.82,2.13-4.03-1.75-8.25-4.95-10.17-4.95Z"/>
        </g>
        <g>
          <path d="M116.93,16.89h-5.02c-.82,0-1.42.67-1.42,1.42v31.11c0,7.42-4.87,13.19-12.59,13.19s-12.44-5.85-12.44-13.34v-30.96c0-.75-.6-1.42-1.42-1.42h-5.02c-.75,0-1.42.67-1.42,1.42v31.48c0,11.39,8.54,20.31,20.31,20.31s20.46-8.92,20.46-20.31v-31.48c0-.75-.67-1.42-1.42-1.42Z"/>
          <path d="M170.37,32.93c0-8.92-7.34-16.04-16.34-16.04h-20.39c-.82,0-1.42.67-1.42,1.42v49.62c0,.75.6,1.42,1.42,1.42h4.87c.75,0,1.42-.67,1.42-1.42v-19.11h11.32l9.97,19.86c.15.3.6.67,1.2.67h5.85c1.27,0,1.8-1.2,1.27-2.17l-10.27-19.04c6.52-2.62,11.09-8.32,11.09-15.22ZM153.43,42.37h-13.34v-18.21h13.34c4.87,0,9.14,4.05,9.14,8.92,0,5.17-4.27,9.29-9.14,9.29Z"/>
          <path d="M205.14,16.14c-14.99,0-26.91,12.07-26.91,27.06s11.92,26.91,26.91,26.91,26.98-11.92,26.98-26.91-11.99-27.06-26.98-27.06ZM205.14,62.61c-10.64,0-19.41-8.69-19.41-19.41s8.77-19.56,19.41-19.56,19.49,8.92,19.49,19.56-8.77,19.41-19.49,19.41Z"/>
          <path d="M280.99,32.93c0-8.92-7.35-16.04-16.34-16.04h-20.39c-.82,0-1.42.67-1.42,1.42v49.62c0,.75.6,1.42,1.42,1.42h4.87c.75,0,1.42-.67,1.42-1.42v-19.11h11.32l9.97,19.86c.15.3.6.67,1.2.67h5.85c1.27,0,1.8-1.2,1.27-2.17l-10.27-19.04c6.52-2.62,11.09-8.32,11.09-15.22ZM264.06,42.37h-13.34v-18.21h13.34c4.87,0,9.14,4.05,9.14,8.92,0,5.17-4.27,9.29-9.14,9.29Z"/>
          <path d="M334.81,67.41l-22.86-50.44c-.22-.45-.9-.82-1.27-.82h-.75c-.38,0-1.05.37-1.27.82l-23.01,50.44c-.45.97.15,1.95,1.27,1.95h4.72c.9,0,1.5-.6,1.72-1.12,1.5-3.45,3.07-6.82,4.57-10.27h24.51l4.65,10.27c.3.67.82,1.12,1.72,1.12h4.72c1.12,0,1.72-.97,1.27-1.95ZM300.86,51.52l9.14-20.54h.38l9.22,20.54h-18.74Z"/>
          <path d="M292.95,81.07c-1.13-.4-1.42-.53-1.77-.78-.4-.28-.63-.74-.63-1.27,0-1.06.78-1.8,1.87-1.8.71,0,1.32.3,1.64.78.18.31.25.58.26,1.14h1.39c-.05-1.92-1.32-3.16-3.28-3.16s-3.29,1.27-3.29,3.14c0,.84.3,1.57.86,2.09.5.45.93.66,2.23,1.11,1.74.58,2.23,1.03,2.23,1.99,0,1.11-.88,1.87-2.12,1.87s-1.89-.66-1.95-1.92h-1.32v.23c0,.53.12.99.38,1.44.58.99,1.54,1.49,2.95,1.49,2.07,0,3.48-1.29,3.48-3.19,0-.74-.26-1.44-.75-1.95-.45-.48-1.01-.78-2.18-1.19Z"/>
          <path d="M300.86,76.17h-2.93v11.04h2.68c1.61,0,2.88-.41,3.84-1.27,1.13-1.01,1.74-2.55,1.74-4.42,0-3.33-2-5.35-5.33-5.35ZM303.27,85.19c-.79.63-1.59.83-3.46.83h-.5v-8.67h1.49c2.53,0,3.95,1.52,3.95,4.19,0,1.64-.5,2.86-1.49,3.66Z"/>
          <path d="M313.49,82.16c1.03-.55,1.59-1.54,1.59-2.78,0-2-1.42-3.21-3.77-3.21h-3.01v11.04h1.39v-4.63l4.29,4.63h1.77l-4.29-4.58c1.01-.07,1.51-.18,2.04-.46ZM309.68,81.64v-4.27h1.62c1.52,0,2.35.74,2.35,2.12s-.91,2.15-2.58,2.15h-1.39Z"/>
          <path d="M318.09,85.62c-.5,0-.86.36-.86.86s.36.86.86.86.86-.36.86-.84c0-.51-.36-.88-.86-.88Z"/>
          <path d="M324.25,76.17l-4.15,11.04h1.44l1.01-2.55h4.95l.91,2.55h1.56l-4.05-11.04h-1.65ZM322.95,83.47l2.09-5.54,2.02,5.54h-4.1Z"/>
          <rect x="331.41" y="76.17" width="1.39" height="11.04"/>
          <path d="M46.38,60.69c-2.08-1.15-3.69-2.99-4.56-5.21l-.06-.15c-.17-.42-.76-.42-.93,0l-.06.15c-.87,2.21-2.48,4.06-4.56,5.21-.34.19-.34.68,0,.87,2.08,1.15,3.69,2.99,4.56,5.21l.06.15c.17.42.76.42.93,0l.06-.15c.87-2.21,2.48-4.06,4.56-5.21.34-.19.34-.68,0-.87Z"/>
        </g>
      </svg>
    </div>
  `;
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
        ${getAuroraLogo()}
        <h1>Código de Verificación</h1>
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
    subject: 'Código de Verificación - Aurora SDR',
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
        ${getAuroraLogo()}
        <h1>Recuperación de Contraseña</h1>
        <p>Hemos recibido una solicitud para restablecer tu contraseña.</p>
        <p>Haz clic en el siguiente botón para crear una nueva contraseña:</p>
        <div style="text-align: center;">
          <a href="${resetUrl}" class="button">Restablecer Contraseña</a>
        </div>
        <p>O copia y pega este enlace en tu navegador:</p>
        <p style="word-break: break-all; font-size: 12px; opacity: 0.9;">${resetUrl}</p>
        <div class="warning">
          <p><strong>Importante:</strong></p>
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
    subject: 'Recuperación de Contraseña - Aurora SDR',
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
    info: '',
    success: '',
    warning: '',
    error: '',
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
        ${getAuroraLogo()}
        <h1>${title}</h1>
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
    subject: `${title} - Aurora SDR`,
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
        ${getAuroraLogo()}
        <h1>¡Bienvenido a Aurora SDR!</h1>
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
    subject: '¡Bienvenido a Aurora SDR!',
    html,
  });
}
