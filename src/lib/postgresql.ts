import { Pool, PoolClient } from 'pg';
import { decrypt } from './encryption-utils.js';

// Pool global por customerId para reutilizar conexiones
const pools: Map<string, Pool> = new Map();

// Pool por defecto (fallback a variables de entorno)
let defaultPool: Pool | null = null;

/**
 * Obtiene un pool de PostgreSQL para un cliente específico
 */
export async function getPostgresPoolForCustomer(customerId: string): Promise<Pool | null> {
  try {
    // Si ya tenemos un pool para este cliente, lo retornamos
    if (pools.has(customerId)) {
      return pools.get(customerId)!;
    }

    // Obtener credenciales del cliente
    const { getMongoDb } = await import('./mongodb.js');
    const { ObjectId } = await import('mongodb');
    const db = await getMongoDb();
    
    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(customerId)
    });
    
    if (!customer) {
      console.warn(`[PostgreSQL] Cliente ${customerId} no encontrado en la base de datos`);
      return null;
    }

    if (!customer.postgresCredentials) {
      console.warn(`[PostgreSQL] Cliente ${customerId} no tiene credenciales de PostgreSQL configuradas`);
      return null;
    }

    // Desencriptar connection string
    let connectionString: string;
    try {
      connectionString = decrypt(customer.postgresCredentials.connectionString);
    } catch (error: any) {
      console.error(`[PostgreSQL] Error al desencriptar connection string para cliente ${customerId}:`, error.message);
      throw new Error(`Error al desencriptar credenciales de PostgreSQL: ${error.message}`);
    }

    // Crear nuevo pool para este cliente
    const pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Guardar el pool
    pools.set(customerId, pool);

    return pool;
  } catch (error) {
    console.error('Error al obtener pool de PostgreSQL para cliente:', error);
    return null;
  }
}

/**
 * Obtiene el pool de PostgreSQL por defecto (usando variables de entorno)
 */
export function getPostgresPool(): Pool {
  if (defaultPool) {
    return defaultPool;
  }

  // Credenciales hardcodeadas para desarrollo (Academia MAV por defecto)
  const connectionString = process.env.DATABASE_PUBLIC_URL 
    || process.env.DATABASE_URL 
    || 'postgresql://postgres:zUrQI9Q1_QAT~KA8YMiZ5tl~_HYSm~Kn@yamabiko.proxy.rlwy.net:41643/railway';

  defaultPool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  return defaultPool;
}

/**
 * Ejecuta una query en PostgreSQL para un cliente específico
 */
export async function queryPostgresForCustomer<T = any>(
  customerId: string,
  query: string,
  params?: any[]
): Promise<T[]> {
  const pool = await getPostgresPoolForCustomer(customerId);
  
  if (!pool) {
    throw new Error(`No se encontraron credenciales de PostgreSQL para el cliente ${customerId}`);
  }

  try {
    const result = await pool.query(query, params);
    return result.rows;
  } catch (error: any) {
    console.error(`Error ejecutando query para cliente ${customerId}:`, error.message);
    console.error('Query:', query);
    console.error('Params:', params);
    throw error;
  }
}

/**
 * Ejecuta una query en PostgreSQL usando el pool por defecto
 */
export async function queryPostgres<T = any>(
  query: string,
  params?: any[]
): Promise<T[]> {
  const pool = getPostgresPool();
  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Obtiene un cliente de PostgreSQL para un cliente específico
 */
export async function getPostgresClientForCustomer(customerId: string): Promise<PoolClient | null> {
  const pool = await getPostgresPoolForCustomer(customerId);
  if (!pool) {
    return null;
  }
  return pool.connect();
}

/**
 * Obtiene un cliente de PostgreSQL usando el pool por defecto
 */
export async function getPostgresClient(): Promise<PoolClient> {
  const pool = getPostgresPool();
  return pool.connect();
}

/**
 * Cierra el pool de un cliente específico
 */
export async function closePostgresPoolForCustomer(customerId: string): Promise<void> {
  const pool = pools.get(customerId);
  if (pool) {
    await pool.end();
    pools.delete(customerId);
  }
}

/**
 * Cierra el pool por defecto
 */
export async function closePostgresPool(): Promise<void> {
  if (defaultPool) {
    await defaultPool.end();
    defaultPool = null;
  }
}/**
 * Cierra todos los pools
 */
export async function closeAllPostgresPools(): Promise<void> {
  await closePostgresPool();
  for (const [customerId, pool] of pools.entries()) {
    await pool.end();
    pools.delete(customerId);
  }
}