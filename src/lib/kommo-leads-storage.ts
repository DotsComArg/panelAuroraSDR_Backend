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
    // Primero eliminar TODOS los índices antiguos que puedan causar problemas
    const indexesToDrop = [
      'customerId_leadId_unique',
      'customerId_1_leadId_1',  // Índice antiguo que usa leadId
      'customerId_1_id_1'        // Otro posible índice antiguo
    ];
    
    for (const indexName of indexesToDrop) {
      try {
        await collection.dropIndex(indexName);
        console.log(`[KOMMO STORAGE] Índice antiguo eliminado: ${indexName}`);
      } catch (error: any) {
        // El índice puede no existir, está bien
        if (!error.message?.includes('index not found')) {
          console.warn(`[KOMMO STORAGE] Error al eliminar índice ${indexName}:`, error.message);
        }
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
    
    // Si es sincronización completa, limpiar documentos con id/leadId null o inválido primero
    if (forceFullSync) {
      console.log(`[KOMMO STORAGE] Limpiando documentos con id/leadId null o inválido...`);
      const cleanupResult = await collection.deleteMany({
        customerId: cleanCustomerId,
        $or: [
          { id: { $eq: null as any } },
          { id: { $exists: false } },
          { id: { $type: 'null' } },
          { leadId: { $eq: null as any } },  // También limpiar leadId null (índice antiguo)
          { leadId: { $exists: false } },
          { leadId: { $type: 'null' } },
        ],
      } as any);
      if (cleanupResult.deletedCount > 0) {
        console.log(`[KOMMO STORAGE] ✅ ${cleanupResult.deletedCount} documentos con id/leadId inválido eliminados`);
      }
    }
    
    // Obtener el timestamp de la última sincronización
    const lastSync = await collection.findOne(
      { customerId: cleanCustomerId, id: { $ne: null as any, $exists: true } },
      { sort: { syncedAt: -1 }, projection: { syncedAt: 1 } }
    );

    const lastSyncTime = lastSync?.syncedAt 
      ? new Date(lastSync.syncedAt).getTime() 
      : 0;

    // Si es sincronización completa o no hay última sincronización, marcar todos como nuevos
    const isFullSync = forceFullSync || lastSyncTime === 0;
    
    console.log(`[KOMMO STORAGE] LastSyncTime: ${lastSyncTime ? new Date(lastSyncTime).toISOString() : 'Nunca'}`);
    console.log(`[KOMMO STORAGE] IsFullSync: ${isFullSync}`);

    // SIEMPRE limpiar documentos con id/leadId null o inválido antes de procesar
    // Esto previene errores de índice único (tanto el nuevo índice con 'id' como el antiguo con 'leadId')
    console.log(`[KOMMO STORAGE] Limpiando documentos con id/leadId null o inválido para este customerId...`);
    try {
      const cleanupResult = await collection.deleteMany({
        customerId: cleanCustomerId,
        $or: [
          { id: { $eq: null as any } },
          { id: { $exists: false } },
          { id: { $type: 'null' } },
          { id: { $type: 'undefined' } },
          { leadId: { $eq: null as any } },  // También limpiar leadId null (índice antiguo)
          { leadId: { $exists: false } },
          { leadId: { $type: 'null' } },
          { leadId: { $type: 'undefined' } },
        ],
      } as any);
      if (cleanupResult.deletedCount > 0) {
        console.log(`[KOMMO STORAGE] ✅ ${cleanupResult.deletedCount} documentos con id/leadId inválido eliminados`);
      }
    } catch (cleanupError: any) {
      console.warn(`[KOMMO STORAGE] ⚠️  Error al limpiar documentos con id/leadId null:`, cleanupError.message);
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

    // En full sync, no necesitamos cargar leads existentes porque procesaremos todos
    // Esto ahorra tiempo y memoria para grandes volúmenes de datos
    const existingLeadsMap = new Map<number, StoredKommoLead>();
    // Solo cargar leads existentes si NO es full sync (para comparar modificaciones)
    // if (!isFullSync) {
    //   const existingLeads = await collection
    //     .find({ customerId: cleanCustomerId })
    //     .toArray() as StoredKommoLead[];
    //   
    //   existingLeads.forEach((lead: StoredKommoLead) => {
    //     if (lead.id != null && typeof lead.id === 'number' && !isNaN(lead.id) && lead.id > 0) {
    //       existingLeadsMap.set(lead.id, lead);
    //     }
    //   });
    // }

    // Procesar leads en lotes pequeños para máxima confiabilidad
    // Lotes de 50 aseguran que cada operación sea rápida y confiable
    const batchSize = 50;
    const now = new Date();
    
    console.log(`[KOMMO STORAGE] Iniciando procesamiento de ${validLeads.length} leads en lotes de ${batchSize} (${Math.ceil(validLeads.length / batchSize)} lotes totales)`);

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

          // En full sync, siempre procesar todos los leads
          // No necesitamos verificar si existe porque upsert lo maneja
          const leadLastModified = lead.updated_at * 1000; // Convertir a milisegundos

          const storedLead: StoredKommoLead = {
            ...lead,
            customerId: cleanCustomerId, // Asegurar que el customerId esté correctamente asignado
            syncedAt: now,
            lastModifiedAt: new Date(leadLastModified),
          };
          
          // Verificación adicional: asegurar que customerId está presente y es correcto
          if (!storedLead.customerId || storedLead.customerId !== cleanCustomerId) {
            console.error(`[KOMMO STORAGE] ⚠️  ERROR: customerId incorrecto en lead ${lead.id}:`, {
              expected: cleanCustomerId,
              actual: storedLead.customerId,
              leadId: lead.id,
            });
            storedLead.customerId = cleanCustomerId; // Forzar el customerId correcto
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

          // Nota: Los contadores se actualizarán después del bulkWrite basándose en los resultados reales
          // Esto es más preciso que contar antes de saber si realmente se insertó o actualizó
        } catch (error: any) {
          console.error(`[KOMMO STORAGE] Error procesando lead ${lead?.id}:`, error?.message || error);
          errors++;
          // Continuar con el siguiente lead
        }
      }

      // Ejecutar operaciones en lote
      if (operations.length > 0) {
        try {
          const batchNumber = Math.floor(i / batchSize) + 1;
          const totalBatches = Math.ceil(validLeads.length / batchSize);
          const progressPercent = Math.round((batchNumber / totalBatches) * 100);
          console.log(`[KOMMO STORAGE] [${progressPercent}%] Procesando lote ${batchNumber}/${totalBatches}: ${operations.length} operaciones`);
          
          try {
            const bulkResult = await collection.bulkWrite(operations, { 
              ordered: false,
              // Continuar aunque haya errores de duplicados
              writeConcern: { w: 1 }
            });
            
            // Contar nuevos vs actualizados basándonos en los resultados
            // upsertedCount = documentos nuevos insertados
            // modifiedCount = documentos existentes actualizados
            // matchedCount = documentos encontrados (pueden no haber cambiado)
            const actualNew = bulkResult.upsertedCount || 0;
            const actualUpdated = bulkResult.modifiedCount || 0;
            const actualMatched = bulkResult.matchedCount || 0;
            
            newLeads += actualNew;
            updatedLeads += actualUpdated;
            
            // Los leads que coincidieron pero no se modificaron ya están en la BD (éxito)
            const unchangedLeads = actualMatched - actualUpdated;
            
            console.log(`[KOMMO STORAGE] ✅ Lote ${batchNumber}/${totalBatches} completado: ${actualNew} nuevos, ${actualUpdated} actualizados, ${unchangedLeads} sin cambios (ya en BD)`);
          } catch (bulkError: any) {
            // Si hay errores de duplicados o cualquier error en bulkWrite, procesar individualmente
            // Esto es más lento pero más confiable
            const isDuplicateError = bulkError.code === 11000 || bulkError.message?.includes('duplicate');
            const errorType = isDuplicateError ? 'clave duplicada' : 'error general';
            
            console.error(`[KOMMO STORAGE] ⚠️  Error de ${errorType} en bulkWrite lote ${batchNumber}. Procesando individualmente...`);
            console.error(`[KOMMO STORAGE] Error code: ${bulkError.code}, message: ${bulkError.message?.substring(0, 200)}`);
            
            // Siempre limpiar documentos con id/leadId null antes de procesar individualmente
            // Esto previene errores de índice único (tanto el nuevo índice con 'id' como el antiguo con 'leadId')
            console.log(`[KOMMO STORAGE] Limpiando documentos con id/leadId null antes de procesar individualmente...`);
            try {
              const cleanupResult = await collection.deleteMany({
                customerId: cleanCustomerId,
                $or: [
                  { id: { $eq: null as any } },
                  { id: { $exists: false } },
                  { id: { $type: 'null' } },
                  { leadId: { $eq: null as any } },  // También limpiar leadId null (índice antiguo)
                  { leadId: { $exists: false } },
                  { leadId: { $type: 'null' } },
                ],
              } as any);
              if (cleanupResult.deletedCount > 0) {
                console.log(`[KOMMO STORAGE] ✅ ${cleanupResult.deletedCount} documentos con id/leadId null eliminados`);
              }
            } catch (cleanupError: any) {
              console.warn(`[KOMMO STORAGE] ⚠️  Error al limpiar documentos con id/leadId null:`, cleanupError.message);
            }
            
            // Solo procesar individualmente si es error de duplicado o si el error es recuperable
            if (isDuplicateError || bulkError.code === 11000) {
              
              let individualSuccess = 0;
              let individualErrors = 0;
              
              // Procesar cada operación individualmente
              for (let opIndex = 0; opIndex < operations.length; opIndex++) {
                const op = operations[opIndex];
                try {
                  // Verificar que el lead tenga id válido antes de intentar guardarlo
                  const leadId = op.updateOne.filter.id;
                  if (!leadId || leadId === null || leadId === undefined || typeof leadId !== 'number' || isNaN(leadId) || leadId <= 0) {
                    console.error(`[KOMMO STORAGE] ⚠️  Operación ${opIndex + 1}/${operations.length} con id inválido saltada:`, {
                      filter: op.updateOne.filter,
                      leadId,
                      leadIdType: typeof leadId,
                    });
                    individualErrors++;
                    errors++;
                    continue;
                  }

                  // Log cada 10 leads para no saturar
                  if (opIndex % 10 === 0 || opIndex === operations.length - 1) {
                    console.log(`[KOMMO STORAGE] Procesando lead individual ${opIndex + 1}/${operations.length} (ID: ${leadId})...`);
                  }

                  const updateResult = await collection.updateOne(
                    op.updateOne.filter,
                    op.updateOne.update,
                    { upsert: true }
                  );
                  
                  // Actualizar contadores basados en el resultado real
                  if (updateResult.upsertedCount > 0) {
                    newLeads++;
                    individualSuccess++;
                    if (opIndex % 10 === 0) {
                      console.log(`[KOMMO STORAGE] ✅ Lead ${leadId} insertado como nuevo`);
                    }
                  } else if (updateResult.modifiedCount > 0) {
                    updatedLeads++;
                    individualSuccess++;
                    if (opIndex % 10 === 0) {
                      console.log(`[KOMMO STORAGE] ✅ Lead ${leadId} actualizado`);
                    }
                  } else if (updateResult.matchedCount > 0) {
                    // El lead ya existe y no cambió, pero está en la BD (éxito)
                    // No incrementamos updatedLeads porque no hubo cambios, pero sí individualSuccess
                    individualSuccess++;
                    if (opIndex % 10 === 0) {
                      console.log(`[KOMMO STORAGE] ✅ Lead ${leadId} ya existe en BD (sin cambios)`);
                    }
                  } else {
                    // No se insertó ni se encontró - esto es un error
                    console.warn(`[KOMMO STORAGE] ⚠️  Lead ${leadId} no se pudo insertar ni actualizar (matched: ${updateResult.matchedCount}, modified: ${updateResult.modifiedCount}, upserted: ${updateResult.upsertedCount})`);
                    individualErrors++;
                    errors++;
                  }
                } catch (individualError: any) {
                  // Obtener leadId del filter para usar en los logs y operaciones
                  const errorLeadId = op.updateOne.filter.id;
                  
                  if (individualError.code === 11000) {
                    // Si es error de duplicado, puede ser por el índice antiguo con leadId
                    // Primero limpiar documentos con leadId null para este lead específico
                    console.warn(`[KOMMO STORAGE] ⚠️  Error de duplicado para lead ${errorLeadId}. Limpiando documentos problemáticos...`);
                    try {
                      // Eliminar cualquier documento con id o leadId null para este customerId y leadId
                      await collection.deleteMany({
                        customerId: cleanCustomerId,
                        $or: [
                          { id: errorLeadId, leadId: { $eq: null as any } },
                          { leadId: errorLeadId, id: { $eq: null as any } },
                          { id: { $eq: null as any }, leadId: { $eq: null as any } },
                        ],
                      } as any);
                      
                      // Intentar actualizar directamente sin upsert primero
                      const updateResult = await collection.updateOne(
                        op.updateOne.filter,
                        op.updateOne.update
                      );
                      if (updateResult.modifiedCount > 0) {
                        updatedLeads++;
                        individualSuccess++;
                        console.log(`[KOMMO STORAGE] ✅ Lead ${errorLeadId} actualizado después de limpiar duplicados`);
                      } else if (updateResult.matchedCount > 0) {
                        // El documento existe y no cambió, pero está en la BD (éxito)
                        individualSuccess++;
                        console.log(`[KOMMO STORAGE] ✅ Lead ${errorLeadId} ya existe en BD (sin cambios)`);
                      } else {
                        // El documento no existe - intentar insertar con upsert
                        const insertResult = await collection.updateOne(
                          op.updateOne.filter,
                          op.updateOne.update,
                          { upsert: true }
                        );
                        if (insertResult.upsertedCount > 0) {
                          newLeads++;
                          individualSuccess++;
                          console.log(`[KOMMO STORAGE] ✅ Lead ${errorLeadId} insertado después de limpiar duplicados`);
                        } else if (insertResult.modifiedCount > 0) {
                          updatedLeads++;
                          individualSuccess++;
                          console.log(`[KOMMO STORAGE] ✅ Lead ${errorLeadId} actualizado después de limpiar duplicados`);
                        } else if (insertResult.matchedCount > 0) {
                          individualSuccess++;
                          console.log(`[KOMMO STORAGE] ✅ Lead ${errorLeadId} ya existe en BD`);
                        } else {
                          console.warn(`[KOMMO STORAGE] ⚠️  Lead ${errorLeadId} no pudo ser procesado después de múltiples intentos (matched: ${insertResult.matchedCount}, modified: ${insertResult.modifiedCount}, upserted: ${insertResult.upsertedCount})`);
                          individualErrors++;
                        }
                      }
                    } catch (retryError: any) {
                      // Si aún falla, loguear el error completo para debugging
                      console.error(`[KOMMO STORAGE] ❌ Lead ${errorLeadId} no pudo ser procesado después de limpiar duplicados. Error: ${retryError.message}, Code: ${retryError.code}`);
                      individualErrors++;
                    }
                  } else {
                    console.error(`[KOMMO STORAGE] Error individual para lead ${errorLeadId}:`, individualError.message, `Code: ${individualError.code}`);
                    individualErrors++;
                    errors++;
                  }
                }
              }
              
              console.log(`[KOMMO STORAGE] ✅ Procesamiento individual lote ${batchNumber} completado: ${individualSuccess} exitosos, ${individualErrors} saltados/errores`);
              console.log(`[KOMMO STORAGE] 📊 Resumen lote ${batchNumber}: ${newLeads} nuevos totales, ${updatedLeads} actualizados totales hasta ahora`);
            } else {
              // Si no es error de duplicado, intentar procesar individualmente de todas formas
              console.error(`[KOMMO STORAGE] ⚠️  Error no recuperable en bulkWrite lote ${batchNumber}:`, bulkError.message);
              console.warn(`[KOMMO STORAGE] Intentando procesar individualmente como último recurso...`);
              
              // Procesar individualmente como último recurso
              let individualSuccess = 0;
              let individualErrors = 0;
              
              for (const op of operations) {
                try {
                  const leadId = op.updateOne.filter.id;
                  if (!leadId || typeof leadId !== 'number' || isNaN(leadId) || leadId <= 0) {
                    individualErrors++;
                    errors++;
                    continue;
                  }

                  const updateResult = await collection.updateOne(
                    op.updateOne.filter,
                    op.updateOne.update,
                    { upsert: true }
                  );
                  
                  if (updateResult.upsertedCount > 0) {
                    newLeads++;
                    individualSuccess++;
                  } else if (updateResult.modifiedCount > 0) {
                    updatedLeads++;
                    individualSuccess++;
                  } else if (updateResult.matchedCount > 0) {
                    individualSuccess++;
                  } else {
                    individualErrors++;
                    errors++;
                  }
                } catch (individualError: any) {
                  console.warn(`[KOMMO STORAGE] ⚠️  Lead ${op.updateOne.filter.id} falló en procesamiento individual: ${individualError.message?.substring(0, 100)}`);
                  individualErrors++;
                  errors++;
                }
              }
              
              console.log(`[KOMMO STORAGE] ✅ Procesamiento individual de emergencia lote ${batchNumber}: ${individualSuccess} exitosos, ${individualErrors} errores`);
            }
          }
        } catch (unexpectedError: any) {
          // Capturar cualquier error inesperado en el procesamiento del lote completo
          console.error(`[KOMMO STORAGE] ❌ Error inesperado procesando lote ${Math.floor(i / batchSize) + 1}:`, unexpectedError.message);
          console.error(`[KOMMO STORAGE] Stack:`, unexpectedError.stack);
          errors += operations.length;
          // IMPORTANTE: Continuar con el siguiente lote
        }
      }
      
      // Log de progreso cada 10 lotes para no saturar los logs
      if ((i / batchSize) % 10 === 0 || i + batchSize >= validLeads.length) {
        const processed = Math.min(i + batchSize, validLeads.length);
        const progress = Math.round((processed / validLeads.length) * 100);
        console.log(`[KOMMO STORAGE] 📊 Progreso: ${processed}/${validLeads.length} leads procesados (${progress}%)`);
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
    const verifyWithValidId = await collection.countDocuments({ 
      customerId: cleanCustomerId,
      id: { $exists: true, $ne: null, $type: 'number' } as any
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
    console.log(`[KOMMO STORAGE]   - Verificación en BD: ${verifyCount} total, ${verifyActiveCount} activos, ${verifyWithValidId} con id válido`);
    console.log(`[KOMMO STORAGE]   - Resumen de procesamiento: ${newLeads} nuevos, ${updatedLeads} actualizados, ${validLeads.length - newLeads - updatedLeads} ya existían`);
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
