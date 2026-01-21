// Utilidades del backend (sin dependencias de frontend)

/**
 * Genera una contraseña segura con una longitud especificada
 * @param length - Longitud de la contraseña (por defecto 16)
 * @returns Contraseña segura generada
 */
export function generateSecurePassword(length: number = 16): string {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz'
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const numbers = '0123456789'
  const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?'
  
  const allChars = lowercase + uppercase + numbers + symbols
  
  // Asegurar que la contraseña tenga al menos un carácter de cada tipo
  let password = ''
  password += lowercase[Math.floor(Math.random() * lowercase.length)]
  password += uppercase[Math.floor(Math.random() * uppercase.length)]
  password += numbers[Math.floor(Math.random() * numbers.length)]
  password += symbols[Math.floor(Math.random() * symbols.length)]
  
  // Completar el resto de la contraseña con caracteres aleatorios
  for (let i = password.length; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)]
  }
  
  // Mezclar los caracteres para que no estén siempre en el mismo orden
  return password.split('').sort(() => Math.random() - 0.5).join('')
}
