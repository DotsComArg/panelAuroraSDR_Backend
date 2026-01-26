/**
 * Sistema de almacenamiento y sincronización de leads de Kommo en MongoDB
 * 
 * Este módulo gestiona el almacenamiento persistente de leads en la base de datos
 * para evitar tener que hacer llamadas lentas a la API de Kommo cada vez.
 * 
 * Características:
 * - Almacenamiento persistente de leads en MongoDB
 * - Sincronización incremental (solo nuevos/modificados)
 * - Búsquedas rápidas con índices
 * - Actualización en background
 */

import { getMongoDb } from './mongodb.js';
import { ObjectId } from 'mongodb';
import type { KommoLead } from './api-kommo.js';

interface StoredKommoLead extends KommoLead {
  _id?: ObjectId;
  customerId: string;
  syncedAt: Date;
  lastModifiedAt: Date;
}

interface SyncResult {
  totalProcessed: number;
  newLeads: number;
  updatedLeads: number;
  deletedLeads: number;
  errors: number;
  duration: number;
}

/**
 * Inicializa los índices necesarios para búsquedas rápidas
 */
export async function initializeKommoLeadsIndexes(): Promise<void> {
  try {
    const db = await getMongoDb();
    const collection = db.collection('kommo_leads');

    // Índice compuesto para búsquedas por customerId y filtros comunes
    // IMPORTANTE: El índice debe permitir nulls o usar sparse index
    // Primero eliminar el índice existente si tiene problemas
    try {
      await collection.dropIndex('customerId_leadId_unique');
      console.log('[KOMMO STORAGE] Índice antiguo eliminado');
    } catch (error: any) {
      // El índice puede no existir, está bien
      if (!error.message?.includes('index not found')) {
        console.warn('[KOMMO STORAGE] Error al eliminar índice antiguo:', error.message);
      }
    }
    
    // Crear índice sparse que ignora documentos con id null
    await collection.createIndex(
      { customerId: 1, id: 1 },
      { 
        unique: true, 
        name: 'customerId_leadId_unique',
        sparse: true, // Ignora documentos donde id es null o no existe
        partialFilterExpression: { id: { $exists: true, $ne: null } } // Solo indexar documentos con id válido
      }
    );

    // Índices para filtros comunes
    await collection.createIndex({ customerId: 1, pipeline_id: 1 });
    await collection.createIndex({ customerId: 1, status_id: 1 });
    await collection.createIndex({ customerId: 1, responsible_user_id: 1 });
    await collection.createIndex({ customerId: 1, created_at: 1 });
    await collection.createIndex({ customerId: 1, closed_at: 1 });
    await collection.createIndex({ customerId: 1, is_deleted: 1 });
    await collection.createIndex({ customerId: 1, syncedAt: 1 });

    console.log('[KOMMO STORAGE] Índices inicializados correctamente');
  } catch (error) {
    console.error('[KOMMO STORAGE] Error al inicializar índices:', error);
    throw error;
  }
}

/**
 * Sincroniza leads desde la API de Kommo a MongoDB
 * Solo sincroniza leads nuevos o modificados desde la última sincronización
 */
export async function syncKommoLeads(
  customerId: string,
  leads: KommoLead[],
  forceFullSync: boolean = false
): Promise<SyncResult> {
  const startTime = Date.now();
  const db = await getMongoDb();
  const collection = db.collection<StoredKommoLead>('kommo_leads');

  let newLeads = 0;
  let updatedLeads = 0;
  let deletedLeads = 0;
  let errors = 0;

  try {
    // Limpiar customerId para asegurar coincidencia exacta
    const cleanCustomerId = customerId.trim();
    
    console.log(`[KOMMO STORAGE] ==========================================`);
    console.log(`[KOMMO STORAGE] Iniciando syncKommoLeads`);
    console.log(`[KOMMO STORAGE] CustomerId: "${cleanCustomerId}" (length: ${cleanCustomerId.length})`);
    console.log(`[KOMMO STORAGE] Total leads a procesar: ${leads.length}`);
    console.log(`[KOMMO STORAGE] ForceFullSync: ${forceFullSync}`);
    
    // Si es sincronización completa, limpiar documentos con id null o inválido primero
    if (forceFullSync) {
      console.log(`[KOMMO STORAGE] Limpiando documentos con id null o inválido...`);
      const cleanupResult = await collection.deleteMany({
        customerId: cleanCustomerId,
        $or: [
          { id: null },
          { id: { $exists: false } },
          { id: { $type: 'null' } },
        ],
      });
      if (cleanupResult.deletedCount > 0) {
        console.log(`[KOMMO STORAGE] ✅ ${cleanupResult.deletedCount} documentos con id inválido eliminados`);
      }
    }
    
    // Obtener el timestamp de la última sincronización
    const lastSync = await collection.findOne(
      { customerId: cleanCustomerId, id: { $ne: null, $exists: true } },
      { sort: { syncedAt: -1 }, projection: { syncedAt: 1 } }
    );

    const lastSyncTime = lastSync?.syncedAt 
      ? new Date(lastSync.syncedAt).getTime() 
      : 0;

    // Si es sincronización completa o no hay última sincronización, marcar todos como nuevos
    const isFullSync = forceFullSync || lastSyncTime === 0;
    
    console.log(`[KOMMO STORAGE] LastSyncTime: ${lastSyncTime ? new Date(lastSyncTime).toISOString() : 'Nunca'}`);
    console.log(`[KOMMO STORAGE] IsFullSync: ${isFullSync}`);

    // SIEMPRE limpiar documentos con id null o inválido antes de procesar
    // Esto previene errores de índice único
    console.log(`[KOMMO STORAGE] Limpiando documentos con id null o inválido para este customerId...`);
    try {
      const cleanupResult = await collection.deleteMany({
        customerId: cleanCustomerId,
        $or: [
          { id: null },
          { id: { $exists: false } },
          { id: { $type: 'null' } },
          { id: { $type: 'undefined' } },
        ],
      });
      if (cleanupResult.deletedCount > 0) {
        console.log(`[KOMMO STORAGE] ✅ ${cleanupResult.deletedCount} documentos con id inválido eliminados`);
      }
    } catch (cleanupError: any) {
      console.warn(`[KOMMO STORAGE] ⚠️  Error al limpiar documentos con id null:`, cleanupError.message);
      // Continuar de todas formas
    }

    // PRIMERO: Filtrar leads inválidos (sin id o id null/undefined/NaN)
    // Esto es crítico porque el índice único requiere que todos los leads tengan un id válido
    const validLeads = leads.filter(lead => {
      if (!lead) {
        console.warn(`[KOMMO STORAGE] ⚠️  Lead nulo o undefined detectado`);
        errors++;
        return false;
      }
      
      if (lead.id === null || lead.id === undefined || typeof lead.id !== 'number' || isNaN(lead.id) || lead.id <= 0) {
        console.warn(`[KOMMO STORAGE] ⚠️  Lead inválido detectado (sin id válido):`, {
          hasId: !!lead?.id,
          idType: typeof lead?.id,
          idValue: lead?.id,
          name: lead?.name,
          isNaN: typeof lead?.id === 'number' ? isNaN(lead.id) : 'N/A',
        });
        errors++;
        return false;
      }
      return true;
    });

    console.log(`[KOMMO STORAGE] Leads válidos después del filtrado: ${validLeads.length} de ${leads.length} totales`);
    if (validLeads.length < leads.length) {
      console.warn(`[KOMMO STORAGE] ⚠️  ${leads.length - validLeads.length} leads fueron descartados por no tener id válido`);
    }

    // Crear un mapa de leads existentes para comparación rápida
    const existingLeadsMap = new Map<number, StoredKommoLead>();
    if (!isFullSync) {
      const existingLeads = await collection
        .find({ customerId: cleanCustomerId })
        .toArray() as StoredKommoLead[];
      
      existingLeads.forEach((lead: StoredKommoLead) => {
        if (lead.id != null && typeof lead.id === 'number' && !isNaN(lead.id) && lead.id > 0) {
          existingLeadsMap.set(lead.id, lead);
        }
      });
    }

    // Procesar leads en lotes para mejor rendimiento
    const batchSize = 500;
    const now = new Date();

    for (let i = 0; i < validLeads.length; i += batchSize) {
      const batch = validLeads.slice(i, i + batchSize);
      const operations: any[] = [];

      for (const lead of batch) {
        try {
          // Validación adicional: asegurar que el id es válido
          if (!lead.id || typeof lead.id !== 'number' || isNaN(lead.id) || lead.id <= 0) {
            console.error(`[KOMMO STORAGE] ⚠️  Lead sin id válido en el lote:`, {
              id: lead.id,
              idType: typeof lead.id,
              name: lead.name,
            });
            errors++;
            continue;
          }

          const existingLead = existingLeadsMap.get(lead.id);
          const leadLastModified = lead.updated_at * 1000; // Convertir a milisegundos

          // Determinar si el lead es nuevo o modificado
          const isNew = !existingLead;
          const isModified = existingLead && 
            (leadLastModified > existingLead.lastModifiedAt.getTime() || 
             lead.is_deleted !== existingLead.is_deleted);

          if (isNew || isModified || isFullSync) {
            const storedLead: StoredKommoLead = {
              ...lead,
              customerId: cleanCustomerId, // Asegurar que el customerId esté correctamente asignado
              syncedAt: now,
              lastModifiedAt: new Date(leadLastModified),
            };

            // Verificar que el customerId se esté asignando correctamente
            if (storedLead.customerId !== cleanCustomerId) {
              console.error(`[KOMMO STORAGE] ⚠️  ERROR: customerId no coincide! Esperado: "${cleanCustomerId}", Obtenido: "${storedLead.customerId}"`);
            }

            // Verificar que el id esté presente y sea válido antes de crear la operación
            if (!storedLead.id || storedLead.id === null || storedLead.id === undefined || typeof storedLead.id !== 'number' || isNaN(storedLead.id) || storedLead.id <= 0) {
              console.error(`[KOMMO STORAGE] ⚠️  ERROR: Lead sin id válido después de procesar:`, {
                name: storedLead.name,
                customerId: storedLead.customerId,
                id: storedLead.id,
                idType: typeof storedLead.id,
              });
              errors++;
              continue;
            }

            operations.push({
              updateOne: {
                filter: { customerId: cleanCustomerId, id: lead.id },
                update: { $set: storedLead },
                upsert: true,
              },
            });

            if (isNew) {
              newLeads++;
            } else if (isModified) {
              updatedLeads++;
            }
          }
        } catch (error) {
          console.error(`[KOMMO STORAGE] Error procesando lead ${lead?.id}:`, error);
          errors++;
        }
      }

      // Ejecutar operaciones en lote
      if (operations.length > 0) {
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(validLeads.length / batchSize);
        console.log(`[KOMMO STORAGE] Ejecutando bulkWrite para lote ${batchNumber}/${totalBatches}: ${operations.length} operaciones`);
        try {
          const bulkResult = await collection.bulkWrite(operations, { ordered: false });
          console.log(`[KOMMO STORAGE] BulkWrite lote ${batchNumber} completado: ${bulkResult.insertedCount} insertados, ${bulkResult.modifiedCount} modificados, ${bulkResult.upsertedCount} upserted`);
        } catch (bulkError: any) {
          // Si hay errores de duplicados, intentar procesar individualmente
          if (bulkError.code === 11000) {
            console.error(`[KOMMO STORAGE] ⚠️  Error de clave duplicada en bulkWrite lote ${batchNumber}. Procesando individualmente...`);
            
            // Primero, limpiar documentos con id null si es necesario
            if (bulkError.message?.includes('leadId: null') || bulkError.message?.includes('id: null')) {
              console.log(`[KOMMO STORAGE] Limpiando documentos con id null antes de procesar individualmente...`);
              try {
                const cleanupResult = await collection.deleteMany({
                  customerId: cleanCustomerId,
                  $or: [
                    { id: null },
                    { id: { $exists: false } },
                    { id: { $type: 'null' } },
                  ],
                });
                if (cleanupResult.deletedCount > 0) {
                  console.log(`[KOMMO STORAGE] ✅ ${cleanupResult.deletedCount} documentos con id null eliminados`);
                }
              } catch (cleanupError: any) {
                console.warn(`[KOMMO STORAGE] ⚠️  Error al limpiar documentos con id null:`, cleanupError.message);
              }
            }
            
            let individualSuccess = 0;
            let individualErrors = 0;
            
            // Procesar cada operación individualmente
            for (const op of operations) {
              try {
                // Verificar que el lead tenga id válido antes de intentar guardarlo
                const leadId = op.updateOne.filter.id;
                if (!leadId || leadId === null || leadId === undefined || typeof leadId !== 'number' || isNaN(leadId) || leadId <= 0) {
                  console.error(`[KOMMO STORAGE] ⚠️  Operación con id inválido saltada:`, {
                    filter: op.updateOne.filter,
                    leadId,
                    leadIdType: typeof leadId,
                  });
                  individualErrors++;
                  errors++;
                  continue;
                }

                await collection.updateOne(
                  op.updateOne.filter,
                  op.updateOne.update,
                  { upsert: true }
                );
                individualSuccess++;
              } catch (individualError: any) {
                if (individualError.code === 11000) {
                  // Si es error de duplicado, simplemente continuar (el lead ya existe)
                  console.warn(`[KOMMO STORAGE] ⚠️  Lead ${op.updateOne.filter.id} ya existe, saltando...`);
                  individualErrors++;
                  // No incrementar errors porque es un duplicado esperado
                } else {
                  console.error(`[KOMMO STORAGE] Error individual para lead ${op.updateOne.filter.id}:`, individualError.message);
                  individualErrors++;
                  errors++;
                }
              }
            }
            
            console.log(`[KOMMO STORAGE] Procesamiento individual lote ${batchNumber}: ${individualSuccess} exitosos, ${individualErrors} errores`);
          } else {
            console.error(`[KOMMO STORAGE] Error en bulkWrite lote ${batchNumber}:`, bulkError.message);
            // Continuar con el siguiente lote en lugar de lanzar error
            console.warn(`[KOMMO STORAGE] Continuando con el siguiente lote...`);
            errors += operations.length;
          }
        }
      }
    }

    // Marcar como eliminados los leads que ya no están en la API
    // Solo si es sincronización completa
    if (isFullSync) {
      const apiLeadIds = new Set(validLeads.map(l => l.id).filter(id => id != null));
      console.log(`[KOMMO STORAGE] Marcando como eliminados leads que ya no están en la API. IDs válidos: ${apiLeadIds.size}`);
      const deletedResult = await collection.updateMany(
        {
          customerId: cleanCustomerId,
          id: { $nin: Array.from(apiLeadIds) },
          is_deleted: { $ne: true } as any,
        },
        {
          $set: {
            is_deleted: true,
            syncedAt: now,
            lastModifiedAt: now,
          },
        }
      );
      deletedLeads = deletedResult.modifiedCount;
      console.log(`[KOMMO STORAGE] ${deletedLeads} leads marcados como eliminados`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Verificar cuántos leads hay realmente en la BD después de la sincronización
    const verifyCount = await collection.countDocuments({ customerId: cleanCustomerId });
    const verifyActiveCount = await collection.countDocuments({ 
      customerId: cleanCustomerId, 
      is_deleted: { $ne: true } as any 
    });

    console.log(`[KOMMO STORAGE] ==========================================`);
    console.log(`[KOMMO STORAGE] Sincronización completada para customerId "${cleanCustomerId}":`);
    console.log(`[KOMMO STORAGE]   - Total recibidos: ${leads.length}`);
    console.log(`[KOMMO STORAGE]   - Total válidos procesados: ${validLeads.length}`);
    console.log(`[KOMMO STORAGE]   - Nuevos leads: ${newLeads}`);
    console.log(`[KOMMO STORAGE]   - Leads actualizados: ${updatedLeads}`);
    console.log(`[KOMMO STORAGE]   - Leads eliminados: ${deletedLeads}`);
    console.log(`[KOMMO STORAGE]   - Errores: ${errors}`);
    console.log(`[KOMMO STORAGE]   - Duración: ${duration}s`);
    console.log(`[KOMMO STORAGE]   - Verificación en BD: ${verifyCount} total, ${verifyActiveCount} activos`);
    console.log(`[KOMMO STORAGE] ==========================================`);

    return {
      totalProcessed: validLeads.length, // Usar validLeads en lugar de leads
      newLeads,
      updatedLeads,
      deletedLeads,
      errors,
      duration: parseFloat(duration),
    };
  } catch (error) {
    console.error('[KOMMO STORAGE] Error en sincronización:', error);
    throw error;
  }
}

/**
 * Obtiene leads desde MongoDB con filtros
 */
export async function getKommoLeadsFromDb(
  customerId: string,
  filters: {
    dateFrom?: number;
    dateTo?: number;
    closedDateFrom?: number;
    closedDateTo?: number;
    dateField?: 'created_at' | 'closed_at';
    responsibleUserId?: number;
    pipelineId?: number;
    statusId?: number;
    tagIds?: number[];
    limit?: number;
    skip?: number;
  } = {}
): Promise<{ leads: KommoLead[]; total: number; totalAll: number }> {
  try {
    const db = await getMongoDb();
    const collection = db.collection<StoredKommoLead>('kommo_leads');

    // Limpiar customerId para asegurar coincidencia exacta
    const cleanCustomerId = customerId.trim();
    
    console.log(`[KOMMO STORAGE] Buscando leads para customerId: "${cleanCustomerId}" (length: ${cleanCustomerId.length})`);
    
    // Primero, verificar cuántos leads hay en total para este customerId
    const sampleLead = await collection.findOne({ customerId: cleanCustomerId });
    if (sampleLead) {
      console.log(`[KOMMO STORAGE] Lead de muestra encontrado con customerId: "${sampleLead.customerId}" (length: ${sampleLead.customerId.length})`);
    } else {
      // Si no encuentra, intentar buscar todos los customerIds únicos para debug
      const distinctCustomerIds = await collection.distinct('customerId');
      console.log(`[KOMMO STORAGE] No se encontraron leads. CustomerIds únicos en BD:`, distinctCustomerIds.slice(0, 5));
    }

    // Construir query
    const query: any = { 
      customerId: cleanCustomerId, 
      is_deleted: { $ne: true } as any 
    };

    // Filtros de fecha
    const dateField = filters.dateField || 'created_at';
    if (filters.dateFrom || filters.dateTo) {
      query[dateField] = {};
      if (filters.dateFrom) query[dateField].$gte = filters.dateFrom;
      if (filters.dateTo) query[dateField].$lte = filters.dateTo;
    }

    // Filtro de fecha de cierre
    if (filters.closedDateFrom || filters.closedDateTo) {
      query.closed_at = {};
      if (filters.closedDateFrom) query.closed_at.$gte = filters.closedDateFrom;
      if (filters.closedDateTo) query.closed_at.$lte = filters.closedDateTo;
    }

    // Filtros adicionales
    if (filters.responsibleUserId) {
      query.responsible_user_id = filters.responsibleUserId;
    }
    if (filters.pipelineId) {
      query.pipeline_id = filters.pipelineId;
    }
    if (filters.statusId) {
      query.status_id = filters.statusId;
    }

    // Filtro de etiquetas (si el lead tiene alguna de las etiquetas especificadas)
    if (filters.tagIds && filters.tagIds.length > 0) {
      query['_embedded.tags.id'] = { $in: filters.tagIds };
    }

    // Obtener total ANTES de aplicar filtro de is_deleted (para incluir todos los leads)
    const totalAllLeads = await collection.countDocuments({ customerId: cleanCustomerId });
    
    // Obtener total de leads activos (sin eliminados) para la respuesta
    const total = await collection.countDocuments(query);

    // Aplicar paginación
    let cursor = collection.find(query);
    
    if (filters.skip) {
      cursor = cursor.skip(filters.skip);
    }
    
    if (filters.limit) {
      cursor = cursor.limit(filters.limit);
    }

    // Ordenar por fecha de creación descendente (más recientes primero)
    cursor = cursor.sort({ created_at: -1 });

    const leads = await cursor.toArray();

    // Remover campos internos antes de devolver
    const cleanLeads: KommoLead[] = leads.map(lead => {
      const { _id, customerId, syncedAt, lastModifiedAt, ...cleanLead } = lead;
      return cleanLead as KommoLead;
    });

    return { 
      leads: cleanLeads, 
      total, // Total de leads activos (sin eliminados) - para paginación
      totalAll: totalAllLeads // Total de TODOS los leads (incluyendo eliminados) - para estadísticas
    };
  } catch (error) {
    console.error('[KOMMO STORAGE] Error al obtener leads de BD:', error);
    throw error;
  }
}

/**
 * Obtiene el timestamp de la última sincronización
 */
export async function getLastSyncTime(customerId: string): Promise<Date | null> {
  try {
    const db = await getMongoDb();
    const collection = db.collection<StoredKommoLead>('kommo_leads');

    // Limpiar customerId para asegurar coincidencia exacta
    const cleanCustomerId = customerId.trim();

    const lastSync = await collection.findOne(
      { customerId: cleanCustomerId },
      { sort: { syncedAt: -1 }, projection: { syncedAt: 1 } }
    );

    return lastSync?.syncedAt || null;
  } catch (error) {
    console.error('[KOMMO STORAGE] Error al obtener última sincronización:', error);
    return null;
  }
}

/**
 * Limpia leads antiguos eliminados (opcional, para mantener la BD limpia)
 */
export async function cleanupDeletedLeads(
  customerId: string,
  olderThanDays: number = 30
): Promise<number> {
  try {
    const db = await getMongoDb();
    const collection = db.collection<StoredKommoLead>('kommo_leads');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await collection.deleteMany({
      customerId,
      is_deleted: true,
      syncedAt: { $lt: cutoffDate },
    });

    console.log(`[KOMMO STORAGE] Limpieza: ${result.deletedCount} leads eliminados antiguos eliminados`);
    return result.deletedCount;
  } catch (error) {
    console.error('[KOMMO STORAGE] Error en limpieza:', error);
    return 0;
  }
}
