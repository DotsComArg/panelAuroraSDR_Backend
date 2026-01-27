import { Router, Request, Response } from 'express';
import { getKommoCredentialsForCustomer, createKommoClient } from '../../lib/api-kommo.js';
import { 
  getKommoLeadsFromDb, 
  syncKommoLeads,
  getLastSyncTime 
} from '../../lib/kommo-leads-storage.js';
import { getMongoDb } from '../../lib/mongodb.js';

const router = Router();

// Helper para obtener parámetro de query como string
const getQueryParam = (param: any): string | null => {
  if (!param) return null;
  if (Array.isArray(param)) return param[0] || null;
  if (typeof param === 'string') return param;
  return null;
};

// Obtener métricas generales del dashboard
router.get('/', async (req: Request, res: Response) => {
  try {
    const daysParam = getQueryParam(req.query.days);
    const days = daysParam ? parseInt(daysParam, 10) : 30;

    // Por ahora devolvemos datos mock/dummy con la estructura correcta
    // TODO: Implementar lógica real para obtener métricas de PostgreSQL
    return res.json({
      success: true,
      totalLeads: 0,
      activeLeads: 0,
      closedLeads: 0,
      conversionRate: 0,
      averageResponseTime: 0,
      totalActivities: 0,
      activitiesByType: {},
      leadsByStatus: {},
      trends: [],
      period: days,
      generales: {
        respuestasAutomaticasCorrectas: 0,
        porcentajeRespuestasCorrectas: 0,
      },
    });
  } catch (error) {
    console.error('Error al obtener métricas:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener métricas',
    });
  }
});

// Obtener métricas de ubicaciones
router.get('/locations', async (req: Request, res: Response) => {
  try {
    const daysParam = getQueryParam(req.query.days);
    const days = daysParam ? parseInt(daysParam, 10) : 30;

    // Por ahora devolvemos datos mock/dummy con la estructura correcta
    // TODO: Implementar lógica real para obtener métricas de ubicaciones
    return res.json({
      success: true,
      total: 0,
      locations: [], // Array vacío pero presente para evitar errores
      dataSource: 'kommo',
    });
  } catch (error) {
    console.error('Error al obtener métricas de ubicaciones:', error);
    return res.status(500).json({
      success: false,
      error: 'Error al obtener métricas de ubicaciones',
    });
  }
});

// ==================== RUTAS DE KOMMO ====================

// Obtener estadísticas generales de Kommo
router.get('/kommo', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);
    const refresh = getQueryParam(req.query.refresh) === 'true';

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    // Limpiar customerId
    const cleanCustomerId = customerId.trim();
    
    console.log(`[KOMMO API] Obteniendo estadísticas para customerId: ${cleanCustomerId}, refresh: ${refresh}`);

    // Obtener credenciales del cliente
    const credentials = await getKommoCredentialsForCustomer(cleanCustomerId);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    // Si no se solicita refresh, intentar obtener estadísticas desde MongoDB primero (más rápido)
    // Si no hay datos, devolver estadísticas vacías en lugar de cargar desde API (evita demoras)
    if (!refresh) {
      const { getKommoLeadsFromDb } = await import('../../lib/kommo-leads-storage.js');
      const { leads: dbLeads, totalAll } = await getKommoLeadsFromDb(cleanCustomerId, {});
      
      // Si hay datos en BD, calcular estadísticas desde ahí (más rápido)
      if (dbLeads.length > 0 && totalAll > 0) {
        const kommoClient = createKommoClient(credentials);
        const stats = await kommoClient.getFilteredLeadsStats(dbLeads);
        
        // Asegurar que el total incluya todos los leads (incluyendo eliminados si están en BD)
        // Si totalAll es mayor que el total calculado, usar totalAll
        if (totalAll > stats.totals.total) {
          stats.totals.total = totalAll;
        }
        
        return res.json({
          success: true,
          data: stats,
        });
      } else {
        // Si no hay datos en BD, devolver estadísticas vacías (NO cargar desde API automáticamente)
        // El usuario debe hacer clic en "Actualizar" para sincronizar
        return res.json({
          success: true,
          data: {
            totals: {
              total: 0,
              won: 0,
              lost: 0,
              active: 0,
            },
            pipelines: [],
            users: [],
            tags: [],
            conversionRate: 0,
            lossRate: 0,
          },
          needsSync: true, // Indicar que necesita sincronización
        });
      }
    }

    // SOLO si se solicita refresh explícitamente, obtener desde API
    const kommoClient = createKommoClient(credentials);
    const stats = await kommoClient.getLeadsStats();

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al obtener estadísticas:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener estadísticas de Kommo',
    });
  }
});

// Obtener usuarios de Kommo
router.get('/kommo/users', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    console.log(`[KOMMO API] Obteniendo usuarios para customerId: ${customerId}`);

    const credentials = await getKommoCredentialsForCustomer(customerId);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    const kommoClient = createKommoClient(credentials);
    const users = await kommoClient.getUsers();

    return res.json({
      success: true,
      data: { users },
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al obtener usuarios:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener usuarios de Kommo',
    });
  }
});

// Obtener pipelines de Kommo
router.get('/kommo/pipelines', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    console.log(`[KOMMO API] Obteniendo pipelines para customerId: ${customerId}`);

    const credentials = await getKommoCredentialsForCustomer(customerId);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    const kommoClient = createKommoClient(credentials);
    const pipelines = await kommoClient.getPipelines();

    return res.json({
      success: true,
      data: { pipelines },
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al obtener pipelines:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener pipelines de Kommo',
    });
  }
});

// Obtener etiquetas de Kommo
router.get('/kommo/tags', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    console.log(`[KOMMO API] Obteniendo etiquetas para customerId: ${customerId}`);

    const credentials = await getKommoCredentialsForCustomer(customerId);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    const kommoClient = createKommoClient(credentials);
    const tags = await kommoClient.getTags();

    return res.json({
      success: true,
      data: { tags },
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al obtener etiquetas:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener etiquetas de Kommo',
    });
  }
});

// Obtener leads de Kommo (desde BD, mucho más rápido)
router.get('/kommo/leads', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);
    const refresh = getQueryParam(req.query.refresh) === 'true';
    const sync = getQueryParam(req.query.sync) === 'true'; // Nuevo parámetro para sincronizar a BD

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    // Limpiar customerId (eliminar espacios y caracteres extra)
    const cleanCustomerId = customerId.trim();
    
    console.log(`[KOMMO API] Obteniendo leads para customerId: ${cleanCustomerId}, refresh: ${refresh}, sync: ${sync}`);
    console.log(`[KOMMO API] CustomerId length: ${cleanCustomerId.length}, type: ${typeof cleanCustomerId}`);

    // Si se solicita refresh, obtener desde API de Kommo
    let apiLeads: any[] = [];
    if (refresh) {
      console.log(`[KOMMO API] Obteniendo leads desde API de Kommo para customerId: ${cleanCustomerId}...`);
      
      const credentials = await getKommoCredentialsForCustomer(cleanCustomerId);
      if (!credentials) {
        return res.status(404).json({
          success: false,
          error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
        });
      }

      const kommoClient = createKommoClient(credentials);
      
      // Obtener todos los leads desde la API
      apiLeads = await kommoClient.getLeadsWithFilters({});
      
      console.log(`[KOMMO API] Leads obtenidos desde API: ${apiLeads.length}`);
      
      // Solo sincronizar a BD si se solicita explícitamente (sync=true)
      if (sync) {
        console.log(`[KOMMO API] Sincronizando leads a BD para customerId: ${cleanCustomerId}...`);
        await syncKommoLeads(cleanCustomerId, apiLeads, true);
        console.log(`[KOMMO API] Sincronización completada. Leads sincronizados: ${apiLeads.length}`);
      } else {
        console.log(`[KOMMO API] Leads obtenidos desde API pero NO sincronizados a BD (sync=false)`);
      }
    }

    // Si se obtuvo desde API (refresh=true), devolver esos leads directamente
    if (refresh && apiLeads.length > 0) {
      // Si no se especifica paginación o se solicita explícitamente todos, devolver todos los leads
      const page = parseInt(getQueryParam(req.query.page) || '1', 10);
      const limitParam = getQueryParam(req.query.limit);
      const limit = limitParam ? parseInt(limitParam, 10) : apiLeads.length; // Si no hay limit, devolver todos
      
      // Si el limit es mayor o igual al total, devolver todos
      const paginatedLeads = limit >= apiLeads.length 
        ? apiLeads 
        : apiLeads.slice((page - 1) * limit, page * limit);
      
      console.log(`[KOMMO API] Devolviendo ${paginatedLeads.length} de ${apiLeads.length} leads desde API`);
      
      return res.json({
        success: true,
        data: { 
          leads: paginatedLeads,
          total: apiLeads.length,
          page,
          limit,
          totalPages: Math.ceil(apiLeads.length / limit),
          lastSync: null,
          needsSync: false,
        },
      });
    }

    // Si no se solicitó refresh, obtener desde BD (más rápido)
    // Construir filtros desde query params
    const filters: any = {};

    // Filtros de fecha
    const dateFrom = getQueryParam(req.query.dateFrom);
    const dateTo = getQueryParam(req.query.dateTo);
    const closedDateFrom = getQueryParam(req.query.closedDateFrom);
    const closedDateTo = getQueryParam(req.query.closedDateTo);
    const dateField = getQueryParam(req.query.dateField) as 'created_at' | 'closed_at' | undefined;

    if (dateFrom) filters.dateFrom = parseInt(dateFrom, 10);
    if (dateTo) filters.dateTo = parseInt(dateTo, 10);
    if (closedDateFrom) filters.closedDateFrom = parseInt(closedDateFrom, 10);
    if (closedDateTo) filters.closedDateTo = parseInt(closedDateTo, 10);
    if (dateField) filters.dateField = dateField;

    // Filtros de usuario, pipeline, status
    const responsibleUserId = getQueryParam(req.query.responsibleUserId);
    const pipelineId = getQueryParam(req.query.pipelineId);
    const statusId = getQueryParam(req.query.statusId);

    if (responsibleUserId) filters.responsibleUserId = parseInt(responsibleUserId, 10);
    if (pipelineId) filters.pipelineId = parseInt(pipelineId, 10);
    if (statusId) filters.statusId = parseInt(statusId, 10);

    // Filtros de etiquetas (puede ser múltiple)
    const tagIds = req.query.tagIds;
    if (tagIds) {
      if (Array.isArray(tagIds)) {
        filters.tagIds = tagIds.map(id => parseInt(String(id), 10));
      } else {
        filters.tagIds = [parseInt(String(tagIds), 10)];
      }
    }

    // Paginación
    const page = parseInt(getQueryParam(req.query.page) || '1', 10);
    const limit = parseInt(getQueryParam(req.query.limit) || '50', 10);
    filters.skip = (page - 1) * limit;
    filters.limit = limit;

    // Obtener leads desde BD (MUCHO más rápido)
    const { leads, total, totalAll } = await getKommoLeadsFromDb(cleanCustomerId, filters);
    
    console.log(`[KOMMO API] Leads encontrados: ${leads.length}, total: ${total}, totalAll: ${totalAll}`);

    // Obtener última sincronización
    const lastSync = await getLastSyncTime(cleanCustomerId);

    // Si no hay datos y no se solicitó refresh, indicar que necesita sincronización
    const needsSync = total === 0 && !refresh && !lastSync;

    return res.json({
      success: true,
      data: { 
        leads,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        lastSync: lastSync?.toISOString() || null,
        needsSync, // Flag para indicar que necesita sincronización
      },
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al obtener leads:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener leads de Kommo',
    });
  }
});

// Endpoint para sincronización inicial completa - trae TODOS los leads con TODOS sus campos
router.post('/kommo/leads/full-sync', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId || req.body?.customerId);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    // Limpiar customerId
    const cleanCustomerId = customerId.trim();
    
    console.log(`[KOMMO FULL SYNC] ==========================================`);
    console.log(`[KOMMO FULL SYNC] Iniciando sincronización completa inicial`);
    console.log(`[KOMMO FULL SYNC] CustomerId: ${cleanCustomerId}`);
    console.log(`[KOMMO FULL SYNC] Timestamp: ${new Date().toISOString()}`);
    console.log(`[KOMMO FULL SYNC] ==========================================`);

    const credentials = await getKommoCredentialsForCustomer(cleanCustomerId);
    if (!credentials) {
      console.error(`[KOMMO FULL SYNC] ❌ No se encontraron credenciales para customerId: ${cleanCustomerId}`);
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    console.log(`[KOMMO FULL SYNC] ✅ Credenciales obtenidas correctamente`);
    console.log(`[KOMMO FULL SYNC] BaseUrl: ${credentials.baseUrl}`);
    console.log(`[KOMMO FULL SYNC] HasAccessToken: ${!!credentials.accessToken}`);

    // Limpiar documentos con id/leadId null ANTES de empezar (importante para evitar errores de índice único)
    // También eliminar el índice antiguo si existe
    console.log(`[KOMMO FULL SYNC] Limpiando índices antiguos y documentos con id/leadId null en la BD...`);
    try {
      const { getMongoDb } = await import('../../lib/mongodb.js');
      const db = await getMongoDb();
      const collection = db.collection('kommo_leads');
      
      // Eliminar índices antiguos que puedan causar problemas
      const indexesToDrop = ['customerId_1_leadId_1', 'customerId_1_id_1'];
      for (const indexName of indexesToDrop) {
        try {
          await collection.dropIndex(indexName);
          console.log(`[KOMMO FULL SYNC] ✅ Índice antiguo eliminado: ${indexName}`);
        } catch (error: any) {
          if (!error.message?.includes('index not found')) {
            console.warn(`[KOMMO FULL SYNC] ⚠️  Error al eliminar índice ${indexName}:`, error.message);
          }
        }
      }
      
      // Limpiar documentos con id/leadId null PERO solo si AMBOS son null
      // NO eliminar si solo uno es null, porque puede ser un lead válido con el otro campo presente
      const cleanupResult = await collection.deleteMany({
        customerId: cleanCustomerId,
        $and: [
          {
            $or: [
              { id: { $eq: null as any } },
              { id: { $exists: false } },
              { id: { $type: 'null' } },
            ],
          },
          {
            $or: [
              { leadId: { $eq: null as any } },
              { leadId: { $exists: false } },
              { leadId: { $type: 'null' } },
            ],
          },
        ],
      } as any);
      if (cleanupResult.deletedCount > 0) {
        console.log(`[KOMMO FULL SYNC] ✅ ${cleanupResult.deletedCount} documentos con id/leadId null eliminados`);
      }
    } catch (cleanupError: any) {
      console.warn(`[KOMMO FULL SYNC] ⚠️  Error al limpiar documentos con id/leadId null:`, cleanupError.message);
      // Continuar de todas formas
    }

    // IMPORTANTE: En Vercel, las funciones serverless se detienen después de responder
    // Por lo tanto, debemos procesar TODO antes de responder, pero de forma optimizada
    // Usaremos el endpoint /kommo/leads/sync?forceFullSync=true para procesamiento en background
    // Este endpoint está diseñado específicamente para eso
    try {
      const kommoClient = createKommoClient(credentials);
      
      console.log(`[KOMMO FULL SYNC] Cliente de Kommo creado`);
      console.log(`[KOMMO FULL SYNC] Obteniendo todos los leads con todos sus campos (etiquetas, contactos, empresas, etc.)...`);
      console.log(`[KOMMO FULL SYNC] ⏳ Esto puede tardar varios minutos para grandes volúmenes de datos...`);
      
      // Obtener todos los leads con todos los campos relacionados
      // El método getLeadsWithFilters ya incluye with=contacts,companies
      const apiLeads = await kommoClient.getLeadsWithFilters({});
      
      console.log(`[KOMMO FULL SYNC] ✅ Leads obtenidos desde API: ${apiLeads.length}`);
      console.log(`[KOMMO FULL SYNC] Iniciando guardado en MongoDB en lotes de 50...`);
      console.log(`[KOMMO FULL SYNC] CustomerId que se usará: "${cleanCustomerId}" (length: ${cleanCustomerId.length})`);
      
      // Verificar que tenemos leads antes de sincronizar
      if (apiLeads.length === 0) {
        console.warn(`[KOMMO FULL SYNC] ⚠️  No se obtuvieron leads desde la API`);
        return res.json({
          success: true,
          message: 'No se encontraron leads en Kommo para sincronizar',
          totalProcessed: 0,
        });
      }

      // Sincronizar con forceFullSync=true para asegurar que todos los campos se guarden
      // PROCESAR TODO ANTES DE RESPONDER para evitar que Vercel detenga el proceso
      console.log(`[KOMMO FULL SYNC] Llamando a syncKommoLeads con forceFullSync=true...`);
      console.log(`[KOMMO FULL SYNC] Procesando ${apiLeads.length} leads en lotes de 50 (aprox. ${Math.ceil(apiLeads.length / 50)} lotes)...`);
      console.log(`[KOMMO FULL SYNC] ⚠️  NOTA: Este proceso puede tardar varios minutos. El frontend puede mostrar timeout, pero el backend continuará procesando.`);
      
      const startTime = Date.now();
      const result = await syncKommoLeads(cleanCustomerId, apiLeads, true);
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
      
      console.log(`[KOMMO FULL SYNC] ✅ Sincronización completada exitosamente en ${totalTime}s:`, {
        totalProcessed: result.totalProcessed,
        newLeads: result.newLeads,
        updatedLeads: result.updatedLeads,
        deletedLeads: result.deletedLeads,
        errors: result.errors,
        duration: `${result.duration}s`,
      });
      
      // Verificar que los leads se guardaron correctamente
      const { getKommoLeadsFromDb } = await import('../../lib/kommo-leads-storage.js');
      const { total, totalAll } = await getKommoLeadsFromDb(cleanCustomerId, { limit: 1 });
      console.log(`[KOMMO FULL SYNC] Verificación en BD:`);
      console.log(`[KOMMO FULL SYNC]   - Total activos: ${total}`);
      console.log(`[KOMMO FULL SYNC]   - Total todos: ${totalAll}`);
      console.log(`[KOMMO FULL SYNC] ==========================================`);

      // Responder SOLO después de que todo se haya procesado
      return res.json({
        success: true,
        message: `Sincronización completa finalizada exitosamente. ${result.totalProcessed} leads procesados en ${totalTime}s`,
        data: {
          totalProcessed: result.totalProcessed,
          newLeads: result.newLeads,
          updatedLeads: result.updatedLeads,
          deletedLeads: result.deletedLeads,
          errors: result.errors,
          duration: result.duration,
          totalInDb: total,
          totalAllInDb: totalAll,
        },
      });
    } catch (syncError: any) {
      console.error(`[KOMMO FULL SYNC] ❌ Error durante la sincronización:`, syncError);
      console.error(`[KOMMO FULL SYNC] Error message: ${syncError.message}`);
      console.error(`[KOMMO FULL SYNC] Stack trace:`, syncError.stack);
      console.log(`[KOMMO FULL SYNC] ==========================================`);
      
      return res.status(500).json({
        success: false,
        error: syncError.message || 'Error durante la sincronización',
        details: process.env.NODE_ENV === 'development' ? syncError.stack : undefined,
      });
    }

  } catch (error: any) {
    console.error('[KOMMO FULL SYNC] ❌ Error al iniciar sincronización completa:', error);
    console.error('[KOMMO FULL SYNC] Stack trace:', error.stack);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al iniciar sincronización completa',
    });
  }
});

// Endpoint para sincronizar leads en background (sincronización incremental)
router.post('/kommo/leads/sync', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId || req.body?.customerId);
    const forceFullSync = getQueryParam(req.query.forceFullSync || req.body?.forceFullSync) === 'true';

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    // Limpiar customerId
    const cleanCustomerId = customerId.trim();
    
    console.log(`[KOMMO API] Iniciando sincronización de leads para customerId: ${cleanCustomerId}`);

    const credentials = await getKommoCredentialsForCustomer(cleanCustomerId);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    // Iniciar la obtención de leads ANTES de responder para asegurar que el proceso se ejecute
    // En Vercel/serverless, necesitamos que el proceso async se inicie antes de enviar la respuesta
    console.log(`[KOMMO API] Iniciando proceso de sincronización para customerId: ${cleanCustomerId}`);
    
    const kommoClient = createKommoClient(credentials);
    
    // Iniciar la obtención de leads (esto puede tardar, pero al menos se inicia el proceso)
    const leadsPromise = kommoClient.getLeadsWithFilters({});
    
    // Responder inmediatamente después de iniciar el proceso
    res.json({
      success: true,
      message: 'Sincronización iniciada. Los leads se están guardando en la base de datos.',
    });
    
    // Continuar con la sincronización en background
    (async () => {
      try {
        console.log(`[KOMMO API] Esperando leads desde API de Kommo...`);
        const apiLeads = await leadsPromise;
        
        console.log(`[KOMMO API] Leads obtenidos desde API: ${apiLeads.length}. Iniciando guardado en MongoDB...`);
        
        const result = await syncKommoLeads(cleanCustomerId, apiLeads, forceFullSync);
        
        console.log(`[KOMMO API] ✅ Sincronización completada exitosamente para customerId ${cleanCustomerId}:`, {
          totalProcessed: result.totalProcessed,
          newLeads: result.newLeads,
          updatedLeads: result.updatedLeads,
          deletedLeads: result.deletedLeads,
          errors: result.errors,
          duration: `${result.duration}s`,
        });
        
        // Verificar que los leads se guardaron correctamente
        const { getKommoLeadsFromDb } = await import('../../lib/kommo-leads-storage.js');
        const { total } = await getKommoLeadsFromDb(cleanCustomerId, { limit: 1 });
        console.log(`[KOMMO API] Verificación: ${total} leads encontrados en BD para customerId ${cleanCustomerId}`);
      } catch (error: any) {
        console.error(`[KOMMO API] ❌ Error en sincronización para customerId ${cleanCustomerId}:`, error);
        console.error('[KOMMO API] Stack trace:', error.stack);
      }
    })();

  } catch (error: any) {
    console.error('[KOMMO API] Error al iniciar sincronización:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al iniciar sincronización',
    });
  }
});

// Endpoint para webhook de Kommo - recibe actualizaciones de leads
// Kommo envía webhooks cuando hay cambios en leads, contactos, etc.
// Documentación: https://www.kommo.com/developers/content/webhooks/
router.post('/kommo/webhook', async (req: Request, res: Response) => {
  const webhookLogId = new Date().toISOString() + '_' + Math.random().toString(36).substr(2, 9);
  const startTime = Date.now();
  let customerId: string | null = null;
  let success = false;
  let errorMessage: string | null = null;
  let processedLeads = 0;
  let deletedLeads = 0;
  
  try {
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Recibida petición de webhook`);
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Headers:`, JSON.stringify(req.headers, null, 2));
    console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Body:`, JSON.stringify(req.body, null, 2));
    
    // Kommo envía los datos en el body
    const webhookData = req.body;
    
    // Kommo puede enviar diferentes tipos de webhooks
    // Estructura típica: { account: { id: ... }, leads: { add: [...], update: [...], delete: [...] } }
    if (!webhookData) {
      console.warn('[KOMMO WEBHOOK] Body vacío o inválido');
      return res.status(400).json({
        success: false,
        error: 'Body vacío o inválido',
      });
    }

    // Extraer accountId del webhook
    // Kommo puede enviarlo en diferentes lugares según el tipo de webhook
    const accountId = webhookData.account?.id || 
                     webhookData.account_id || 
                     webhookData.accountId ||
                     req.headers['x-account-id'] as string;

    if (!accountId) {
      console.warn('[KOMMO WEBHOOK] No se encontró accountId en el webhook');
      // Intentar extraer de la URL base si está disponible
      console.log('[KOMMO WEBHOOK] Intentando buscar customerId por otros métodos...');
    }

    // Buscar el customerId por accountId de Kommo o por URL base
    const db = await getMongoDb();
    const { ObjectId } = await import('mongodb');
    const customers = await db.collection('customers').find({}).toArray();
    
    // Si tenemos accountId, buscar por él
    if (accountId) {
      for (const customer of customers) {
        if (customer.kommoCredentials) {
          const baseUrl = customer.kommoCredentials.baseUrl || '';
          // La URL de Kommo es típicamente: https://{accountId}.kommo.com
          const urlMatch = baseUrl.match(/https?:\/\/([^.]+)\.kommo\.com/i);
          if (urlMatch && urlMatch[1] === accountId.toString()) {
            customerId = customer._id.toString();
            break;
          }
        }
      }
    }
    
    // Si no encontramos por accountId, intentar buscar por cualquier cliente con credenciales de Kommo
    // y usar el primero que tenga (útil para desarrollo/testing)
    if (!customerId) {
      for (const customer of customers) {
        if (customer.kommoCredentials) {
          customerId = customer._id.toString();
          console.log(`[KOMMO WEBHOOK] Usando customerId encontrado: ${customerId} (sin accountId específico)`);
          break;
        }
      }
    }

    if (!customerId) {
      console.warn(`[KOMMO WEBHOOK] No se encontró cliente con credenciales de Kommo`);
      // Responder 200 para que Kommo no reintente, pero loguear el error
      return res.status(200).json({
        success: false,
        message: 'Cliente no encontrado para este webhook',
      });
    }

    console.log(`[KOMMO WEBHOOK] Procesando webhook para customerId: ${customerId}`);

    // Procesar los eventos del webhook
    // Kommo envía eventos en diferentes formatos según el tipo
    const leadsEvents = webhookData.leads || {};
    const leadsToAdd = leadsEvents.add || [];
    const leadsToUpdate = leadsEvents.update || [];
    const leadsToDelete = leadsEvents.delete || [];
    
    // También puede venir directamente como array
    const allLeadsEvents = Array.isArray(webhookData.leads) ? webhookData.leads : [];
    
    // Combinar todos los eventos de leads
    const allLeadIds = new Set<number>();
    
    [...leadsToAdd, ...leadsToUpdate, ...allLeadsEvents].forEach((lead: any) => {
      const leadId = lead.id || lead.lead_id;
      if (leadId) allLeadIds.add(leadId);
    });
    
    // Procesar leads eliminados
    leadsToDelete.forEach((leadId: number) => {
      allLeadIds.add(leadId);
    });

    if (allLeadIds.size === 0) {
      console.log('[KOMMO WEBHOOK] No hay eventos de leads para procesar');
      return res.status(200).json({
        success: true,
        message: 'Webhook recibido pero no hay eventos de leads para procesar',
      });
    }

    console.log(`[KOMMO WEBHOOK] Procesando ${allLeadIds.size} leads: ${Array.from(allLeadIds).join(', ')}`);

    // Obtener credenciales del cliente
    const credentials = await getKommoCredentialsForCustomer(customerId);
    if (!credentials) {
      console.error(`[KOMMO WEBHOOK] No se encontraron credenciales para customerId: ${customerId}`);
      return res.status(200).json({
        success: false,
        message: 'Credenciales no encontradas',
      });
    }

    const kommoClient = createKommoClient(credentials);
    
    // Procesar cada lead
    let leadsToSync: any[] = [];
    
    for (const leadId of allLeadIds) {
      try {
        // Si es un lead eliminado, marcarlo como eliminado en BD
        if (leadsToDelete.includes(leadId)) {
          const db = await getMongoDb();
          await db.collection('kommo_leads').updateOne(
            { customerId: customerId.trim(), id: leadId },
            { $set: { is_deleted: true, syncedAt: new Date(), lastModifiedAt: new Date() } }
          );
          console.log(`[KOMMO WEBHOOK] Lead ${leadId} marcado como eliminado`);
          continue;
        }

        // Obtener el lead completo desde la API de Kommo
        const leadResponse: any = await kommoClient.authenticatedRequest(
          `/leads/${leadId}?with=contacts,companies`
        );
        
        if (leadResponse && leadResponse._embedded && leadResponse._embedded.leads) {
          const lead = leadResponse._embedded.leads[0];
          if (lead) {
            leadsToSync.push(lead);
          }
        } else if (leadResponse && leadResponse.id) {
          // A veces Kommo devuelve el lead directamente
          leadsToSync.push(leadResponse);
        }
      } catch (error: any) {
        console.error(`[KOMMO WEBHOOK] Error al obtener lead ${leadId}:`, error.message);
        // Continuar con el siguiente lead
      }
    }

    // Si hay leads para actualizar, sincronizarlos
    if (leadsToSync.length > 0) {
      console.log(`[KOMMO WEBHOOK] [${webhookLogId}] Sincronizando ${leadsToSync.length} leads actualizados`);
      await syncKommoLeads(customerId, leadsToSync, false);
      console.log(`[KOMMO WEBHOOK] [${webhookLogId}] ✅ ${leadsToSync.length} leads sincronizados exitosamente`);
      processedLeads = leadsToSync.length;
    }
    
    deletedLeads = leadsToDelete.length;
    success = true;

    // Guardar log del webhook
    const duration = Date.now() - startTime;
    await saveWebhookLog({
      logId: webhookLogId,
      customerId: customerId!,
      accountId: accountId?.toString() || null,
      success: true,
      processedLeads,
      deletedLeads,
      duration,
      headers: req.headers,
      body: webhookData,
      response: {
        success: true,
        message: `Webhook procesado: ${processedLeads} leads actualizados, ${deletedLeads} eliminados`,
        processed: processedLeads,
        deleted: deletedLeads,
      },
      timestamp: new Date(),
    });

    // Responder rápidamente a Kommo (200 OK)
    // Kommo espera una respuesta rápida, por eso procesamos en background si es necesario
    res.status(200).json({
      success: true,
      message: `Webhook procesado: ${processedLeads} leads actualizados, ${deletedLeads} eliminados`,
      processed: processedLeads,
      deleted: deletedLeads,
    });

  } catch (error: any) {
    console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Error al procesar webhook:`, error);
    console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Stack:`, error.stack);
    
    errorMessage = error.message || 'Error al procesar webhook';
    success = false;

    // Guardar log del error
    const duration = Date.now() - startTime;
    try {
      await saveWebhookLog({
        logId: webhookLogId,
        customerId: customerId || 'unknown',
        accountId: accountId?.toString() || null,
        success: false,
        processedLeads: 0,
        deletedLeads: 0,
        duration,
        headers: req.headers,
        body: req.body,
        error: errorMessage,
        stack: error.stack,
        timestamp: new Date(),
      });
    } catch (logError) {
      console.error(`[KOMMO WEBHOOK] [${webhookLogId}] Error al guardar log:`, logError);
    }

    // Responder 200 para que Kommo no reintente en caso de errores temporales
    // pero loguear el error para debugging
    return res.status(200).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Función helper para guardar logs de webhooks
async function saveWebhookLog(logData: {
  logId: string;
  customerId: string;
  accountId: string | null;
  success: boolean;
  processedLeads: number;
  deletedLeads: number;
  duration: number;
  headers: any;
  body: any;
  response?: any;
  error?: string;
  stack?: string;
  timestamp: Date;
}) {
  try {
    const db = await getMongoDb();
    const logsCollection = db.collection('kommo_webhook_logs');
    
    // Limitar el tamaño del body y headers para no exceder límites de MongoDB
    const limitedBody = JSON.stringify(logData.body).substring(0, 50000); // Máximo 50KB
    const limitedHeaders = JSON.stringify(logData.headers).substring(0, 10000); // Máximo 10KB
    
    await logsCollection.insertOne({
      ...logData,
      body: limitedBody,
      headers: limitedHeaders,
      createdAt: logData.timestamp,
    });
    
    // Limpiar logs antiguos (mantener solo los últimos 1000)
    const totalLogs = await logsCollection.countDocuments();
    if (totalLogs > 1000) {
      const logsToDelete = totalLogs - 1000;
      const oldestLogs = await logsCollection
        .find({})
        .sort({ createdAt: 1 })
        .limit(logsToDelete)
        .toArray();
      
      if (oldestLogs.length > 0) {
        const idsToDelete = oldestLogs.map(log => log._id);
        await logsCollection.deleteMany({ _id: { $in: idsToDelete } });
        console.log(`[KOMMO WEBHOOK] Limpiados ${logsToDelete} logs antiguos`);
      }
    }
  } catch (error: any) {
    console.error('[KOMMO WEBHOOK] Error al guardar log:', error);
  }
}

// Endpoint para obtener logs de webhooks
router.get('/kommo/webhook/logs', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);
    const limit = parseInt(getQueryParam(req.query.limit) || '50', 10);
    const skip = parseInt(getQueryParam(req.query.skip) || '0', 10);
    
    const db = await getMongoDb();
    const logsCollection = db.collection('kommo_webhook_logs');
    
    // Construir query
    const query: any = {};
    if (customerId) {
      query.customerId = customerId.trim();
    }
    
    // Obtener logs ordenados por fecha descendente (más recientes primero)
    const logs = await logsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .toArray();
    
    // Contar total
    const total = await logsCollection.countDocuments(query);
    
    // Obtener información de clientes para enriquecer los logs
    const customers = await db.collection('customers').find({}).toArray();
    const customersMap = new Map(customers.map(c => [c._id.toString(), c]));
    
    // Enriquecer logs con información del cliente
    const enrichedLogs = logs.map((log: any) => {
      const customer = customersMap.get(log.customerId);
      return {
        ...log,
        customerName: customer ? `${customer.nombre || ''} ${customer.apellido || ''}`.trim() : 'Cliente desconocido',
        customerEmail: customer?.email || null,
      };
    });
    
    return res.json({
      success: true,
      data: enrichedLogs,
      total,
      limit,
      skip,
    });
  } catch (error: any) {
    console.error('[KOMMO WEBHOOK] Error al obtener logs:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al obtener logs de webhooks',
    });
  }
});

// Endpoint para verificar customerIds de leads y clientes
router.get('/kommo/leads/check-customer-ids', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.query.customerId);
    
    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    const cleanCustomerId = customerId.trim();
    const db = await getMongoDb();
    const { ObjectId } = await import('mongodb');

    // Verificar si el cliente existe
    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(cleanCustomerId)
    });

    // Obtener todos los customerIds únicos de los leads
    const kommoLeadsCollection = db.collection('kommo_leads');
    const distinctCustomerIds = await kommoLeadsCollection.distinct('customerId');
    
    // Contar leads por customerId
    const leadsByCustomerId: any = {};
    for (const cid of distinctCustomerIds) {
      const count = await kommoLeadsCollection.countDocuments({ customerId: cid });
      leadsByCustomerId[cid] = count;
    }

    // Verificar si hay leads con el customerId del usuario
    const leadsForCurrentCustomer = await kommoLeadsCollection.countDocuments({ 
      customerId: cleanCustomerId 
    });

    return res.json({
      success: true,
      data: {
        currentCustomerId: cleanCustomerId,
        customerExists: !!customer,
        customerName: customer?.nombre || customer?.email || 'No encontrado',
        leadsForCurrentCustomer,
        allCustomerIdsInLeads: distinctCustomerIds,
        leadsByCustomerId,
      },
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al verificar customerIds:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al verificar customerIds',
    });
  }
});

// Endpoint para restaurar leads marcados como eliminados
// Útil cuando se marcaron incorrectamente como eliminados durante una sincronización incompleta
router.post('/kommo/leads/restore-deleted', async (req: Request, res: Response) => {
  try {
    const customerId = getQueryParam(req.body?.customerId || req.query.customerId);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: 'customerId es requerido',
      });
    }

    const cleanCustomerId = customerId.trim();

    console.log(`[KOMMO API] Restaurando leads marcados como eliminados para customerId: ${cleanCustomerId}`);

    const db = await getMongoDb();
    const collection = db.collection('kommo_leads');

    // Contar leads marcados como eliminados
    const deletedCount = await collection.countDocuments({ 
      customerId: cleanCustomerId, 
      is_deleted: true 
    });
    
    console.log(`[KOMMO API] Leads marcados como eliminados encontrados: ${deletedCount}`);

    if (deletedCount === 0) {
      return res.json({
        success: true,
        message: 'No se encontraron leads marcados como eliminados',
        restored: 0,
      });
    }

    // Restaurar todos los leads marcados como eliminados
    const result = await collection.updateMany(
      { 
        customerId: cleanCustomerId, 
        is_deleted: true 
      },
      { 
        $set: { 
          is_deleted: false,
          syncedAt: new Date(),
        } 
      }
    );

    console.log(`[KOMMO API] Restauración completada: ${result.modifiedCount} leads restaurados`);

    return res.json({
      success: true,
      message: `Restauración completada: ${result.modifiedCount} leads restaurados`,
      restored: result.modifiedCount,
      totalDeleted: deletedCount,
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al restaurar leads:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al restaurar leads marcados como eliminados',
    });
  }
});

// Endpoint para migrar/actualizar customerId de leads existentes
// Útil cuando los leads fueron sincronizados con un customerId incorrecto
router.post('/kommo/leads/migrate-customer-id', async (req: Request, res: Response) => {
  try {
    const oldCustomerId = getQueryParam(req.body?.oldCustomerId || req.query.oldCustomerId);
    const newCustomerId = getQueryParam(req.body?.newCustomerId || req.query.newCustomerId);

    if (!oldCustomerId || !newCustomerId) {
      return res.status(400).json({
        success: false,
        error: 'oldCustomerId y newCustomerId son requeridos',
      });
    }

    const cleanOldCustomerId = oldCustomerId.trim();
    const cleanNewCustomerId = newCustomerId.trim();

    console.log(`[KOMMO API] Migrando leads de customerId "${cleanOldCustomerId}" a "${cleanNewCustomerId}"`);

    const db = await getMongoDb();
    const collection = db.collection('kommo_leads');

    // Contar leads con el customerId antiguo
    const countOld = await collection.countDocuments({ customerId: cleanOldCustomerId });
    console.log(`[KOMMO API] Leads encontrados con customerId antiguo: ${countOld}`);

    if (countOld === 0) {
      return res.json({
        success: true,
        message: 'No se encontraron leads con el customerId antiguo',
        migrated: 0,
      });
    }

    // Actualizar todos los leads
    const result = await collection.updateMany(
      { customerId: cleanOldCustomerId },
      { $set: { customerId: cleanNewCustomerId } }
    );

    console.log(`[KOMMO API] Migración completada: ${result.modifiedCount} leads actualizados`);

    return res.json({
      success: true,
      message: `Migración completada: ${result.modifiedCount} leads actualizados`,
      migrated: result.modifiedCount,
    });
  } catch (error: any) {
    console.error('[KOMMO API] Error al migrar customerId:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al migrar customerId de leads',
    });
  }
});

export default router;
