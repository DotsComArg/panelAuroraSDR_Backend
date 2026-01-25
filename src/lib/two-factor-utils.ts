import crypto from 'crypto';

/**
 * Genera un código de verificación de 6 dígitos
 */
export function generate2FACode(): string {
  // Generar un número aleatorio de 6 dígitos
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  return code;
}

/**
 * Genera un token seguro para recuperación de contraseña
 */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Verifica si un código 2FA es válido (comparación simple)
 * En producción, podrías usar TOTP (Time-based One-Time Password) con librerías como 'otplib'
 */
export function verify2FACode(inputCode: string, storedCode: string): boolean {
  return inputCode === storedCode;
}

/**
 * Genera un código 2FA y lo almacena temporalmente
 * Retorna el código y la fecha de expiración (10 minutos)
 */
export function create2FASession(): {
  code: string;
  expiresAt: Date;
} {
  const code = generate2FACode();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10); // Expira en 10 minutos

  return {
    code,
    expiresAt,
  };
}
