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
    await collection.createIndex(
      { customerId: 1, id: 1 },
      { unique: true, name: 'customerId_leadId_unique' }
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
    // Obtener el timestamp de la última sincronización
    const lastSync = await collection.findOne(
      { customerId },
      { sort: { syncedAt: -1 }, projection: { syncedAt: 1 } }
    );

    const lastSyncTime = lastSync?.syncedAt 
      ? new Date(lastSync.syncedAt).getTime() 
      : 0;

    // Si es sincronización completa o no hay última sincronización, marcar todos como nuevos
    const isFullSync = forceFullSync || lastSyncTime === 0;

    // Crear un mapa de leads existentes para comparación rápida
    const existingLeadsMap = new Map<number, StoredKommoLead>();
    if (!isFullSync) {
      const existingLeads = await collection
        .find({ customerId })
        .toArray() as StoredKommoLead[];
      
      existingLeads.forEach((lead: StoredKommoLead) => {
        existingLeadsMap.set(lead.id, lead);
      });
    }

    // Procesar leads en lotes para mejor rendimiento
    const batchSize = 500;
    const now = new Date();

    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);
      const operations: any[] = [];

      for (const lead of batch) {
        try {
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
              customerId,
              syncedAt: now,
              lastModifiedAt: new Date(leadLastModified),
            };

            operations.push({
              updateOne: {
                filter: { customerId, id: lead.id },
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
          console.error(`[KOMMO STORAGE] Error procesando lead ${lead.id}:`, error);
          errors++;
        }
      }

      // Ejecutar operaciones en lote
      if (operations.length > 0) {
        await collection.bulkWrite(operations, { ordered: false });
      }
    }

    // Marcar como eliminados los leads que ya no están en la API
    // Solo si es sincronización completa
    if (isFullSync) {
      const apiLeadIds = new Set(leads.map(l => l.id));
      const deletedResult = await collection.updateMany(
        {
          customerId,
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
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`[KOMMO STORAGE] Sincronización completada para customerId ${customerId}:`, {
      totalProcessed: leads.length,
      newLeads,
      updatedLeads,
      deletedLeads,
      errors,
      duration: `${duration}s`,
    });

    return {
      totalProcessed: leads.length,
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
): Promise<{ leads: KommoLead[]; total: number }> {
  try {
    const db = await getMongoDb();
    const collection = db.collection<StoredKommoLead>('kommo_leads');

    // Construir query
    const query: any = { 
      customerId, 
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

    // Obtener total antes de aplicar paginación
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

    return { leads: cleanLeads, total };
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

    const lastSync = await collection.findOne(
      { customerId },
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
