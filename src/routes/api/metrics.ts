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
    
    console.log(`[KOMMO FULL SYNC] Iniciando sincronización completa inicial para customerId: ${cleanCustomerId}`);

    const credentials = await getKommoCredentialsForCustomer(cleanCustomerId);
    if (!credentials) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado o no tiene credenciales de Kommo configuradas',
      });
    }

    // Responder inmediatamente y procesar en background
    res.json({
      success: true,
      message: 'Sincronización completa iniciada. Esto puede tardar varios minutos dependiendo de la cantidad de leads.',
    });
    
    // Procesar en background
    (async () => {
      try {
        const kommoClient = createKommoClient(credentials);
        
        console.log(`[KOMMO FULL SYNC] Obteniendo todos los leads con todos sus campos (etiquetas, contactos, empresas, etc.)...`);
        
        // Obtener todos los leads con todos los campos relacionados
        // El método getLeadsWithFilters ya incluye with=contacts,companies
        const apiLeads = await kommoClient.getLeadsWithFilters({});
        
        console.log(`[KOMMO FULL SYNC] Leads obtenidos desde API: ${apiLeads.length}. Iniciando guardado en MongoDB...`);
        
        // Sincronizar con forceFullSync=true para asegurar que todos los campos se guarden
        const result = await syncKommoLeads(cleanCustomerId, apiLeads, true);
        
        console.log(`[KOMMO FULL SYNC] ✅ Sincronización completa exitosa para customerId ${cleanCustomerId}:`, {
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
        console.log(`[KOMMO FULL SYNC] Verificación: ${total} leads encontrados en BD para customerId ${cleanCustomerId}`);
      } catch (error: any) {
        console.error(`[KOMMO FULL SYNC] ❌ Error en sincronización completa para customerId ${cleanCustomerId}:`, error);
        console.error('[KOMMO FULL SYNC] Stack trace:', error.stack);
      }
    })();

  } catch (error: any) {
    console.error('[KOMMO FULL SYNC] Error al iniciar sincronización completa:', error);
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
  try {
    console.log('[KOMMO WEBHOOK] Recibida petición de webhook');
    console.log('[KOMMO WEBHOOK] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[KOMMO WEBHOOK] Body:', JSON.stringify(req.body, null, 2));
    
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
    
    let customerId: string | null = null;
    
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
      console.log(`[KOMMO WEBHOOK] Sincronizando ${leadsToSync.length} leads actualizados`);
      await syncKommoLeads(customerId, leadsToSync, false);
      console.log(`[KOMMO WEBHOOK] ✅ ${leadsToSync.length} leads sincronizados exitosamente`);
    }

    // Responder rápidamente a Kommo (200 OK)
    // Kommo espera una respuesta rápida, por eso procesamos en background si es necesario
    res.status(200).json({
      success: true,
      message: `Webhook procesado: ${leadsToSync.length} leads actualizados, ${leadsToDelete.length} eliminados`,
      processed: leadsToSync.length,
      deleted: leadsToDelete.length,
    });

  } catch (error: any) {
    console.error('[KOMMO WEBHOOK] Error al procesar webhook:', error);
    console.error('[KOMMO WEBHOOK] Stack:', error.stack);
    // Responder 200 para que Kommo no reintente en caso de errores temporales
    // pero loguear el error para debugging
    return res.status(200).json({
      success: false,
      error: error.message || 'Error al procesar webhook',
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
