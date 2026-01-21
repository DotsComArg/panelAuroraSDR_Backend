/**
 * Helpers para obtener customerId de las requests y usar PostgreSQL por cliente
 */

import { queryPostgres, queryPostgresForCustomer } from './postgresql';

/**
 * Obtiene el customerId de una request (desde cookies, headers o query params)
 */
export function getCustomerIdFromRequest(request: Request): string | null {
  // Intentar desde query params
  const url = new URL(request.url);
  const customerIdFromQuery = url.searchParams.get('customerId');
  if (customerIdFromQuery) {
    return customerIdFromQuery;
  }

  // Intentar desde headers
  const customerIdFromHeader = request.headers.get('x-customer-id') || 
                                request.headers.get('customer-id');
  if (customerIdFromHeader) {
    return customerIdFromHeader;
  }

  // Intentar desde cookies
  const cookieHeader = request.headers.get('cookie') || '';
  const customerIdMatch = cookieHeader.match(/customerId=([^;]+)/);
  if (customerIdMatch) {
    return customerIdMatch[1];
  }

  return null;
}

/**
 * Ejecuta una query en PostgreSQL intentando usar las credenciales del cliente,
 * o fallback al pool por defecto
 */
export async function queryPostgresWithCustomer<T = any>(
  request: Request,
  query: string,
  params?: any[]
): Promise<T[]> {
  const customerId = getCustomerIdFromRequest(request);

  if (customerId) {
    try {
      // Intentar usar credenciales del cliente
      const result = await queryPostgresForCustomer<T>(customerId, query, params);
      return result;
    } catch (error: any) {
      // Si el error es porque no hay credenciales, usar fallback
      if (error.message?.includes('No se encontraron credenciales') || 
          error.message?.includes('no tiene credenciales')) {
        console.warn(`[PostgreSQL] Cliente ${customerId} no tiene credenciales configuradas, usando pool por defecto`);
        // Continuar con fallback
      } else {
        // Para otros errores, re-lanzar
        console.error(`[PostgreSQL] Error al usar credenciales del cliente ${customerId}:`, error.message);
        throw error;
      }
    }
  } else {
    console.warn('[PostgreSQL] No se encontró customerId en la request, usando pool por defecto');
  }

  // Usar pool por defecto
  return await queryPostgres<T>(query, params);
}

