import crypto from "crypto"

// Genera un hash seguro de contraseña usando PBKDF2
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex")
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex")

  return `${salt}:${hash}`
}

// Verifica una contraseña contra un hash almacenado
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, originalHash] = storedHash.split(":")
  if (!salt || !originalHash) return false

  const hashToVerify = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex")

  try {
    return crypto.timingSafeEqual(
      Buffer.from(originalHash, "hex"),
      Buffer.from(hashToVerify, "hex"),
    )
  } catch {
    return false
  }
}


