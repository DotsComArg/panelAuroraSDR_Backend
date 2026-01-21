import crypto from "crypto"

// Clave de encriptación desde variables de entorno
// IMPORTANTE: Debe ser una cadena hexadecimal de 64 caracteres (32 bytes)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY

if (!ENCRYPTION_KEY) {
  console.warn(
    "⚠️  ENCRYPTION_KEY no está configurada. " +
    "Las credenciales no se podrán encriptar/desencriptar correctamente. " +
    "Configura ENCRYPTION_KEY en tu archivo .env con una clave hexadecimal de 64 caracteres."
  )
}

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16 // Para GCM, el IV es de 16 bytes
const AUTH_TAG_LENGTH = 16 // GCM produce un tag de autenticación de 16 bytes

/**
 * Encripta un texto usando AES-256-GCM
 * @param text Texto a encriptar
 * @returns Texto encriptado en formato base64 (IV:AuthTag:EncryptedData)
 */
export function encrypt(text: string): string {
  if (!ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY no está configurada. No se puede encriptar.")
  }

  try {
    // Asegurarnos de que la clave tenga 32 bytes (256 bits)
    // Si la clave es más corta, la completamos o truncamos
    let keyHex = ENCRYPTION_KEY
    if (keyHex.length < 64) {
      // Si es muy corta, la repetimos o generamos un hash
      keyHex = crypto.createHash("sha256").update(keyHex).digest("hex")
    }
    const key = Buffer.from(keyHex.slice(0, 64), "hex").slice(0, 32)
    
    // Generar IV aleatorio
    const iv = crypto.randomBytes(IV_LENGTH)
    
    // Crear cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
    
    // Encriptar
    let encrypted = cipher.update(text, "utf8", "hex")
    encrypted += cipher.final("hex")
    
    // Obtener el tag de autenticación
    const authTag = cipher.getAuthTag()
    
    // Combinar IV, authTag y datos encriptados
    const combined = Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, "hex"),
    ])
    
    return combined.toString("base64")
  } catch (error) {
    console.error("Error al encriptar:", error)
    throw new Error("Error al encriptar datos")
  }
}

/**
 * Desencripta un texto encriptado con AES-256-GCM
 * @param encryptedText Texto encriptado en formato base64
 * @returns Texto desencriptado
 */
export function decrypt(encryptedText: string): string {
  if (!ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY no está configurada. No se puede desencriptar.")
  }

  try {
    // Asegurarnos de que la clave tenga 32 bytes (256 bits)
    // Si la clave es más corta, la completamos o truncamos
    let keyHex = ENCRYPTION_KEY
    if (keyHex.length < 64) {
      // Si es muy corta, la repetimos o generamos un hash
      keyHex = crypto.createHash("sha256").update(keyHex).digest("hex")
    }
    const key = Buffer.from(keyHex.slice(0, 64), "hex").slice(0, 32)
    
    // Decodificar de base64
    const combined = Buffer.from(encryptedText, "base64")
    
    // Extraer IV, authTag y datos encriptados
    const iv = combined.slice(0, IV_LENGTH)
    const authTag = combined.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
    const encrypted = combined.slice(IV_LENGTH + AUTH_TAG_LENGTH)
    
    // Crear decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    
    // Desencriptar
    let decrypted = decipher.update(encrypted, undefined, "utf8")
    decrypted += decipher.final("utf8")
    
    return decrypted
  } catch (error) {
    console.error("Error al desencriptar:", error)
    throw new Error("Error al desencriptar datos")
  }
}

