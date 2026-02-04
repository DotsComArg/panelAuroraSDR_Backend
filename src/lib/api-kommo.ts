/**
 * Cliente de API de Kommo (AmoCRM)
 * Documentación: https://www.kommo.com/developers/
 */

import { decrypt } from './encryption-utils.js'

const KOMMO_BASE_URL = process.env.KOMMO_BASE_URL || ''
const KOMMO_INTEGRATION_ID = process.env.KOMMO_INTEGRATION_ID || ''
const KOMMO_SECRET_KEY = process.env.KOMMO_SECRET_KEY || ''
const KOMMO_ACCESS_TOKEN = process.env.KOMMO_ACCESS_TOKEN || '' // Token directo si ya lo tienes

interface KommoAccessToken {
  token_type: string
  expires_in: number
  access_token: string
  refresh_token: string
}

export interface KommoLead {
  id: number
  name: string
  price: number
  responsible_user_id: number
  group_id: number
  status_id: number
  pipeline_id: number
  date_create: number
  date_close: number | null
  created_by: number
  updated_by: number
  created_at: number
  updated_at: number
  closed_at: number | null
  closest_task_at: number | null
  is_deleted: boolean
  custom_fields_values: any[]
  score: number | null
  account_id: number
  labor_cost: number | null
  _links: {
    self: {
      href: string
    }
  }
  _embedded?: {
    tags?: Array<{ id: number; name: string }>
  }
}

interface KommoPipeline {
  id: number
  name: string
  sort: number
  is_main: boolean
  is_unsorted_on: boolean
  is_archive: boolean
  account_id: number
  _links: {
    self: {
      href: string
    }
  }
  _embedded?: {
    statuses?: KommoStatus[]
  }
}

interface KommoStatus {
  id: number
  name: string
  sort: number
  is_editable: boolean
  pipeline_id: number
  color: string
  type: number // 0 = open, 1 = won, 2 = lost
  account_id: number
}

interface KommoLeadsResponse {
  _page: number
  _links: {
    self: {
      href: string
    }
    first?: {
      href: string
    }
    prev?: {
      href: string
    }
    next?: {
      href: string
    }
    last?: {
      href: string
    }
  }
  _embedded: {
    leads: KommoLead[]
  }
}

interface KommoPipelinesResponse {
  _page: number
  _links: {
    self: {
      href: string
    }
  }
  _embedded: {
    pipelines: KommoPipeline[]
  }
}

interface KommoUser {
  id: number
  name: string
  email: string
  lang: string
  rights: {
    leads: {
      view: string
      add: string
      edit: string
      delete: string
      export: string
    }
  }
  _links: {
    self: {
      href: string
    }
  }
}

interface KommoUsersResponse {
  _page: number
  _links: {
    self: {
      href: string
    }
  }
  _embedded: {
    users: KommoUser[]
  }
}

interface KommoLeadsFilter {
  dateFrom?: number // Timestamp Unix en segundos
  dateTo?: number // Timestamp Unix en segundos
  closedDateFrom?: number // Timestamp Unix en segundos - fecha de cierre desde
  closedDateTo?: number // Timestamp Unix en segundos - fecha de cierre hasta
  responsibleUserId?: number
  pipelineId?: number
  statusId?: number
  tagIds?: number[] // IDs de etiquetas para filtrar
  dateField?: 'created_at' | 'closed_at' // Campo de fecha a usar para filtrado
}

interface KommoCredentials {
  baseUrl: string
  accessToken: string // Token desencriptado
  integrationId?: string
  secretKey?: string
}

class KommoApiClient {
  private accessToken: string | null = null
  private tokenExpiresAt: number = 0
  private baseUrl: string = ''
  private credentials: KommoCredentials | null = null
  private lastRequestTime: number = 0
  private readonly REQUEST_DELAY_MS = 200 // Delay mínimo entre peticiones (200ms)
  private readonly MAX_RETRIES = 3
  private readonly INITIAL_RETRY_DELAY = 1000 // 1 segundo

  /**
   * Configura las credenciales del cliente
   */
  setCredentials(credentials: KommoCredentials) {
    // Normalizar baseUrl antes de guardarlo
    let baseUrl = credentials.baseUrl?.trim() || ''
    if (baseUrl) {
      // Remover trailing slash
      baseUrl = baseUrl.replace(/\/+$/, '')
      // Asegurar que tenga protocolo
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        baseUrl = `https://${baseUrl}`
      }
    }
    
    this.credentials = {
      ...credentials,
      baseUrl: baseUrl,
    }
    this.baseUrl = baseUrl
    this.accessToken = null // Resetear token para usar nuevas credenciales
    
    console.log('[KOMMO] Credenciales configuradas:', {
      baseUrl: this.baseUrl,
      hasAccessToken: !!this.credentials.accessToken,
      accessTokenLength: this.credentials.accessToken?.length || 0,
    })
  }

  /**
   * Obtiene un access token
   * Kommo requiere un access token que se obtiene mediante OAuth2 authorization_code flow
   * Si ya tienes un access token, puedes configurarlo en KOMMO_ACCESS_TOKEN
   */
  private async getAccessToken(): Promise<string> {
    // Si tenemos credenciales del cliente, usarlas
    if (this.credentials?.accessToken) {
      // Si tenemos un token válido en memoria, lo retornamos
      if (this.accessToken && Date.now() < this.tokenExpiresAt) {
        return this.accessToken
      }
      
      this.accessToken = this.credentials.accessToken
      // Asumimos que el token es válido por 24 horas (ajustar según necesidad)
      this.tokenExpiresAt = Date.now() + 24 * 60 * 60 * 1000
      return this.accessToken
    }

    // Si tenemos un token válido en memoria, lo retornamos
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken
    }

    // Si hay un access token configurado directamente en .env, lo usamos
    if (KOMMO_ACCESS_TOKEN) {
      this.accessToken = KOMMO_ACCESS_TOKEN
      // Asumimos que el token es válido por 24 horas (ajustar según necesidad)
      this.tokenExpiresAt = Date.now() + 24 * 60 * 60 * 1000
      return this.accessToken
    }

    // Si no hay token directo, intentamos obtener uno usando authorization_code
    // NOTA: Esto requiere un código de autorización previo obtenido manualmente
    // Para integraciones server-to-server, es mejor obtener el access token manualmente
    // y configurarlo en KOMMO_ACCESS_TOKEN
    
    throw new Error(
      'No se encontró access token de Kommo. ' +
      'Por favor, obtén un access token desde el panel de Kommo y configúralo en KOMMO_ACCESS_TOKEN en el archivo .env. ' +
      'O usa el flujo de autorización OAuth2 para obtenerlo automáticamente.'
    )
  }

  /**
   * Obtiene la URL base de Kommo (normalizada)
   */
  private getBaseUrl(): string {
    let baseUrl = ''
    
    if (this.credentials?.baseUrl) {
      baseUrl = this.credentials.baseUrl
    } else if (KOMMO_BASE_URL) {
      baseUrl = KOMMO_BASE_URL
    }
    
    if (!baseUrl) {
      return ''
    }
    
    // Normalizar la URL base
    // Remover trailing slash
    baseUrl = baseUrl.trim().replace(/\/+$/, '')
    
    // Asegurar que tenga protocolo
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      baseUrl = `https://${baseUrl}`
    }
    
    return baseUrl
  }

  /**
   * Espera el tiempo necesario para respetar el rate limiting
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime
    
    if (timeSinceLastRequest < this.REQUEST_DELAY_MS) {
      const waitTime = this.REQUEST_DELAY_MS - timeSinceLastRequest
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }
    
    this.lastRequestTime = Date.now()
  }

  /**
   * Realiza una petición autenticada a la API de Kommo con retry y rate limiting
   */
  async authenticatedRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    retryCount: number = 0
  ): Promise<T> {
    // Esperar antes de hacer la petición para respetar rate limiting
    await this.waitForRateLimit()

    const token = await this.getAccessToken()
    const baseUrl = this.getBaseUrl()
    
    if (!baseUrl) {
      throw new Error('No se configuró la URL base de Kommo')
    }
    
    // Asegurar que el endpoint comience con /
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    const url = `${baseUrl}/api/v4${normalizedEndpoint}`

    console.log('[KOMMO API] Realizando petición:', {
      url,
      endpoint: normalizedEndpoint,
      baseUrl,
      hasToken: !!token,
      tokenLength: token?.length || 0,
      retryCount,
    })

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      // Manejar error 429 (Too Many Requests) con retry
      if (response.status === 429) {
        if (retryCount < this.MAX_RETRIES) {
          const retryDelay = this.INITIAL_RETRY_DELAY * Math.pow(2, retryCount) // Backoff exponencial
          console.warn(`[KOMMO API] Rate limit alcanzado (429). Reintentando en ${retryDelay}ms... (intento ${retryCount + 1}/${this.MAX_RETRIES})`)
          
          // Esperar antes de reintentar
          await new Promise(resolve => setTimeout(resolve, retryDelay))
          
          // Reintentar la petición
          return this.authenticatedRequest<T>(endpoint, options, retryCount + 1)
        } else {
          const errorText = await response.text()
          console.error('[KOMMO API] Error 429 después de múltiples reintentos:', {
            url,
            status: response.status,
            retryCount,
          })
          throw new Error(`Error en API de Kommo: ${response.status} - Rate limit excedido después de ${this.MAX_RETRIES} reintentos`)
        }
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[KOMMO API] Error en petición:', {
          url,
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        })
        throw new Error(`Error en API de Kommo: ${response.status} - ${errorText}`)
      }

      return response.json() as Promise<T>
    } catch (error: any) {
      // Si es un error de red o timeout, también podemos reintentar
      if (retryCount < this.MAX_RETRIES && !error.message?.includes('429')) {
        const retryDelay = this.INITIAL_RETRY_DELAY * Math.pow(2, retryCount)
        console.warn(`[KOMMO API] Error de red. Reintentando en ${retryDelay}ms... (intento ${retryCount + 1}/${this.MAX_RETRIES})`)
        
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        return this.authenticatedRequest<T>(endpoint, options, retryCount + 1)
      }
      
      throw error
    }
  }

  /**
   * Obtiene todos los leads (con paginación y rate limiting)
   */
  async getAllLeads(): Promise<KommoLead[]> {
    // Usar getLeadsWithFilters sin filtros para mantener consistencia
    return this.getLeadsWithFilters({})
  }

  /**
   * Obtiene leads con filtros (fecha y usuario responsable) con rate limiting
   */
  async getLeadsWithFilters(filters: KommoLeadsFilter): Promise<KommoLead[]> {
    const allLeads: KommoLead[] = []
    let page = 1
    let hasMore = true
    let totalPagesProcessed = 0

    // Construir query parameters base
    const baseParams: string[] = []
    baseParams.push('limit=250')
    // Incluir todos los datos relacionados: contactos, empresas, etiquetas (custom_fields_values vienen en el lead por defecto)
    baseParams.push('with=contacts,companies,tags')

    // Agregar filtros de fecha
    // Kommo usa formato timestamp Unix en segundos
    // Si se especifica dateField, usar ese campo; si no, usar created_at por defecto
    const dateField = filters.dateField || 'created_at'
    
    if (filters.dateFrom) {
      baseParams.push(`filter[${dateField}][from]=${filters.dateFrom}`)
    }
    if (filters.dateTo) {
      baseParams.push(`filter[${dateField}][to]=${filters.dateTo}`)
    }
    
    // Filtros específicos para fecha de cierre (tienen prioridad si están presentes)
    if (filters.closedDateFrom) {
      baseParams.push(`filter[closed_at][from]=${filters.closedDateFrom}`)
    }
    if (filters.closedDateTo) {
      baseParams.push(`filter[closed_at][to]=${filters.closedDateTo}`)
    }

    // Agregar filtro de usuario responsable
    if (filters.responsibleUserId) {
      baseParams.push(`filter[responsible_user_id][]=${filters.responsibleUserId}`)
    }

    // Agregar filtro de pipeline
    if (filters.pipelineId) {
      baseParams.push(`filter[pipeline_id][]=${filters.pipelineId}`)
    }

    // Agregar filtro de status
    if (filters.statusId) {
      baseParams.push(`filter[status_id][]=${filters.statusId}`)
    }

    // Agregar filtro de etiquetas
    if (filters.tagIds && filters.tagIds.length > 0) {
      filters.tagIds.forEach(tagId => {
        baseParams.push(`filter[tags][]=${tagId}`)
      })
    }

    const hasFilters = !!(filters.dateFrom || filters.dateTo || filters.closedDateFrom || filters.closedDateTo || filters.responsibleUserId || filters.pipelineId || filters.statusId || (filters.tagIds && filters.tagIds.length > 0))
    const filterDescription = hasFilters 
      ? `con filtros: ${JSON.stringify(filters)}`
      : 'sin filtros (todos los leads)'
    
    console.log(`[KOMMO LEADS] Obteniendo leads ${filterDescription}...`)

    while (hasMore) {
      // Construir query string con página actual
      const queryString = [...baseParams, `page=${page}`].join('&')
      
      try {
        const response: KommoLeadsResponse = await this.authenticatedRequest(
          `/leads?${queryString}`
        )

        if (response._embedded?.leads) {
          const leadsInPage = response._embedded.leads.length
          allLeads.push(...response._embedded.leads)
          totalPagesProcessed++
          console.log(`[KOMMO LEADS] Página ${page}: ${leadsInPage} leads (Total acumulado: ${allLeads.length})`)
        } else {
          console.warn(`[KOMMO LEADS] Página ${page}: No se encontraron leads en la respuesta`)
        }

        // Verificar si hay más páginas
        hasMore = !!response._links?.next
        page++
        
        // Agregar un pequeño delay adicional entre páginas para evitar rate limiting
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      } catch (error: any) {
        // Si es un error 429 después de los reintentos, detener la paginación
        if (error.message?.includes('429') || error.message?.includes('Rate limit')) {
          console.error(`[KOMMO LEADS] Rate limit excedido al obtener leads ${filterDescription}. Deteniendo paginación en página ${page}.`)
          console.error(`[KOMMO LEADS] Leads obtenidos hasta ahora: ${allLeads.length} en ${totalPagesProcessed} páginas`)
          throw error
        }
        // Si hay un error en la primera página, lanzarlo
        if (page === 1) {
          console.error(`[KOMMO LEADS] Error en la primera página al obtener leads ${filterDescription}:`, error)
          throw error
        }
        // Si hay un error en páginas siguientes, detener la paginación pero no lanzar error
        console.warn(`[KOMMO LEADS] Error al obtener página ${page} de leads ${filterDescription}:`, error)
        console.warn(`[KOMMO LEADS] Deteniendo paginación. Leads obtenidos hasta ahora: ${allLeads.length} en ${totalPagesProcessed} páginas`)
        hasMore = false
      }
    }

    console.log(`[KOMMO LEADS] Finalizado: ${allLeads.length} leads obtenidos en ${totalPagesProcessed} páginas ${filterDescription}`)
    return allLeads
  }

  /**
   * Obtiene un lead por ID con todos sus campos (custom_fields_values completos, contactos, empresas).
   * Usado en sincronización completa para asegurar que traemos toda la data (fuente, UTM, etc.).
   */
  async getLeadById(id: number): Promise<KommoLead | null> {
    try {
      const response = await this.authenticatedRequest<{ _embedded?: { leads?: KommoLead[] } } & KommoLead>(
        `/leads/${id}?with=contacts,companies,tags`
      );
      if (response._embedded?.leads?.[0]) {
        return response._embedded.leads[0];
      }
      if (response.id) {
        return response as KommoLead;
      }
      return null;
    } catch (error: any) {
      console.warn(`[KOMMO LEADS] Error al obtener lead ${id} completo:`, error?.message || error);
      return null;
    }
  }

  /**
   * Obtiene todos los leads y luego enriquece cada uno con GET /leads/:id para traer
   * todos los campos personalizados (custom_fields_values completos: fuente, UTM, etc.).
   * Usar en sincronización completa para tener toda la data necesaria para métricas.
   */
  async getLeadsWithFullDetails(): Promise<KommoLead[]> {
    const listLeads = await this.getLeadsWithFilters({});
    if (listLeads.length === 0) return [];

    const BATCH_SIZE = 3;
    const DELAY_MS = 450;
    const enriched: KommoLead[] = [];

    console.log(`[KOMMO LEADS] Enriqueciendo ${listLeads.length} leads con datos completos (custom_fields_values, etc.)...`);

    for (let i = 0; i < listLeads.length; i += BATCH_SIZE) {
      const batch = listLeads.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((lead) => this.getLeadById(lead.id))
      );
      for (let j = 0; j < results.length; j++) {
        enriched.push(results[j] ?? batch[j]);
      }
      if (i + BATCH_SIZE < listLeads.length) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }

    console.log(`[KOMMO LEADS] ✅ ${enriched.length} leads con datos completos listos para guardar`);
    return enriched;
  }

  /**
   * Obtiene todos los usuarios de Kommo
   */
  async getUsers(): Promise<KommoUser[]> {
    try {
      const response: KommoUsersResponse = await this.authenticatedRequest('/users')
      return response._embedded?.users || []
    } catch (error: any) {
      console.error('Error al obtener usuarios de Kommo:', error)
      // Si hay un error, retornar array vacío en lugar de lanzar excepción
      // para que la UI pueda manejar el error de forma más elegante
      throw error
    }
  }

  /**
   * Obtiene todas las etiquetas (tags) de Kommo
   * Extrae las etiquetas únicas de todos los leads
   */
  async getTags(): Promise<Array<{ id: number; name: string }>> {
    try {
      // Obtener todos los leads para extraer las etiquetas
      const allLeads = await this.getAllLeads()
      const tagsMap = new Map<number, { id: number; name: string }>()
      
      allLeads.forEach(lead => {
        if (lead._embedded?.tags) {
          lead._embedded.tags.forEach(tag => {
            if (!tagsMap.has(tag.id)) {
              tagsMap.set(tag.id, tag)
            }
          })
        }
      })
      
      // Convertir el Map a un array y ordenar por nombre
      const tags = Array.from(tagsMap.values()).sort((a, b) => 
        a.name.localeCompare(b.name)
      )
      
      console.log(`[KOMMO TAGS] ${tags.length} etiquetas únicas encontradas`)
      return tags
    } catch (error: any) {
      console.error('Error al obtener etiquetas de Kommo:', error)
      throw error
    }
  }

  /**
   * Obtiene todos los pipelines con sus statuses (con rate limiting por lotes)
   */
  async getPipelines(): Promise<KommoPipeline[]> {
    const response: KommoPipelinesResponse = await this.authenticatedRequest(
      '/leads/pipelines'
    )

    const pipelines = response._embedded?.pipelines || []
    
    // Procesar pipelines en lotes para evitar demasiadas peticiones simultáneas
    const BATCH_SIZE = 5 // Procesar 5 pipelines a la vez
    const pipelinesWithStatuses: KommoPipeline[] = []

    for (let i = 0; i < pipelines.length; i += BATCH_SIZE) {
      const batch = pipelines.slice(i, i + BATCH_SIZE)
      
      // Procesar el lote en paralelo
      const batchResults = await Promise.all(
        batch.map(async (pipeline) => {
          try {
            const statusesResponse = await this.authenticatedRequest<{
              _embedded: { statuses: KommoStatus[] }
            }>(`/leads/pipelines/${pipeline.id}/statuses`)
            
            return {
              ...pipeline,
              _embedded: {
                ...pipeline._embedded,
                statuses: statusesResponse._embedded?.statuses || [],
              },
            }
          } catch (error: any) {
            console.error(`Error al obtener statuses del pipeline ${pipeline.id}:`, error)
            // Retornar el pipeline sin statuses en caso de error
            return pipeline
          }
        })
      )
      
      pipelinesWithStatuses.push(...batchResults)
      
      // Agregar un delay entre lotes para evitar rate limiting
      if (i + BATCH_SIZE < pipelines.length) {
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }

    return pipelinesWithStatuses
  }

  /**
   * Identifica statuses ganados y perdidos para un conjunto de pipelines
   * Esta función centraliza la lógica de identificación para que sea consistente
   */
  private identifyWonLostStatuses(pipelines: KommoPipeline[]): { wonStatusIds: Set<number>, lostStatusIds: Set<number> } {
    const wonStatusIds = new Set<number>()
    const lostStatusIds = new Set<number>()

    pipelines.forEach((pipeline) => {
      const statuses = pipeline._embedded?.statuses || []
      if (statuses.length === 0) return

      // Ordenar statuses por sort (orden en el pipeline)
      const sortedStatuses = [...statuses].sort((a, b) => a.sort - b.sort)

      // REGLA IMPORTANTE: Las últimas dos etapas suelen ser Ganados y Perdidos
      // Identificar las últimas dos etapas primero
      if (sortedStatuses.length >= 2) {
        const lastStatus = sortedStatuses[sortedStatuses.length - 1]
        const secondLastStatus = sortedStatuses[sortedStatuses.length - 2]
        
        // PRIMERO: Identificar por tipo (MÁS CONFIABLE)
        if (lastStatus.type === 1) {
          wonStatusIds.add(lastStatus.id)
        } else if (lastStatus.type === 2) {
          lostStatusIds.add(lastStatus.id)
        }
        
        if (secondLastStatus.type === 1) {
          wonStatusIds.add(secondLastStatus.id)
        } else if (secondLastStatus.type === 2) {
          lostStatusIds.add(secondLastStatus.id)
        }
        
        // SEGUNDO: Si no tienen tipo definido, usar nombres y posición
        // La última etapa suele ser "perdida" y la penúltima "ganada"
        // Soporta nombres en español e inglés
        if (!wonStatusIds.has(lastStatus.id) && !lostStatusIds.has(lastStatus.id)) {
          const lastStatusNameLower = lastStatus.name.toLowerCase().trim()
          
          // Buscar palabras clave de "ganado" o "perdido" (español e inglés)
          if (
            lastStatusNameLower.includes('cierre exitoso') ||
            lastStatusNameLower.includes('closed - won') ||
            lastStatusNameLower.includes('closed won') ||
            lastStatusNameLower.includes('closed-won') ||
            lastStatusNameLower.includes('logrado') ||
            lastStatusNameLower.includes('exito') ||
            lastStatusNameLower.includes('éxito') ||
            lastStatusNameLower.includes('ganado') ||
            (lastStatusNameLower.includes('won') && !lastStatusNameLower.includes('lost'))
          ) {
            wonStatusIds.add(lastStatus.id)
          } else if (
            lastStatusNameLower.includes('cierre perdido') ||
            lastStatusNameLower.includes('closed - lost') ||
            lastStatusNameLower.includes('closed lost') ||
            lastStatusNameLower.includes('closed-lost') ||
            lastStatusNameLower.includes('perdido') ||
            lastStatusNameLower.includes('perdida') ||
            lastStatusNameLower.includes('ventas perdido') ||
            (lastStatusNameLower.includes('lost') && !lastStatusNameLower.includes('won'))
          ) {
            lostStatusIds.add(lastStatus.id)
          } else {
            // Por defecto, la última etapa es PERDIDA
            lostStatusIds.add(lastStatus.id)
          }
        }
        
        if (!wonStatusIds.has(secondLastStatus.id) && !lostStatusIds.has(secondLastStatus.id)) {
          const secondLastStatusNameLower = secondLastStatus.name.toLowerCase().trim()
          
          if (
            secondLastStatusNameLower.includes('cierre exitoso') ||
            secondLastStatusNameLower.includes('closed - won') ||
            secondLastStatusNameLower.includes('closed won') ||
            secondLastStatusNameLower.includes('closed-won') ||
            secondLastStatusNameLower.includes('logrado') ||
            secondLastStatusNameLower.includes('exito') ||
            secondLastStatusNameLower.includes('éxito') ||
            secondLastStatusNameLower.includes('ganado') ||
            (secondLastStatusNameLower.includes('won') && !secondLastStatusNameLower.includes('lost'))
          ) {
            wonStatusIds.add(secondLastStatus.id)
          } else if (
            secondLastStatusNameLower.includes('cierre perdido') ||
            secondLastStatusNameLower.includes('closed - lost') ||
            secondLastStatusNameLower.includes('closed lost') ||
            secondLastStatusNameLower.includes('closed-lost') ||
            secondLastStatusNameLower.includes('perdido') ||
            secondLastStatusNameLower.includes('perdida') ||
            secondLastStatusNameLower.includes('ventas perdido') ||
            (secondLastStatusNameLower.includes('lost') && !secondLastStatusNameLower.includes('won'))
          ) {
            lostStatusIds.add(secondLastStatus.id)
          } else {
            // Por defecto, la penúltima etapa es GANADA
            wonStatusIds.add(secondLastStatus.id)
          }
        }
      }

      // TERCERO: Identificar otros statuses por tipo (no solo las últimas dos)
      sortedStatuses.forEach((status) => {
        if (status.type === 1) {
          wonStatusIds.add(status.id)
        } else if (status.type === 2) {
          lostStatusIds.add(status.id)
        }
      })

      // CUARTO: Identificar otros statuses por nombre (para statuses que no son las últimas dos)
      sortedStatuses.forEach((status) => {
        // Solo procesar si no es una de las últimas dos etapas y no está ya clasificado
        const isLastTwo = sortedStatuses.length >= 2 && 
          (status.id === sortedStatuses[sortedStatuses.length - 1].id || 
           status.id === sortedStatuses[sortedStatuses.length - 2].id)
        
        if (!isLastTwo && !wonStatusIds.has(status.id) && !lostStatusIds.has(status.id)) {
          const statusNameLower = status.name.toLowerCase().trim()
          
          if (
            statusNameLower.includes('cierre exitoso') ||
            statusNameLower.includes('closed - won') ||
            statusNameLower.includes('closed won') ||
            statusNameLower.includes('closed-won') ||
            statusNameLower.includes('logrado') ||
            statusNameLower.includes('exito') ||
            statusNameLower.includes('éxito') ||
            statusNameLower.includes('ganado') ||
            statusNameLower.includes('won')
          ) {
            wonStatusIds.add(status.id)
          } else if (
            statusNameLower.includes('cierre perdido') ||
            statusNameLower.includes('closed - lost') ||
            statusNameLower.includes('closed lost') ||
            statusNameLower.includes('closed-lost') ||
            statusNameLower.includes('perdido') ||
            statusNameLower.includes('perdida') ||
            statusNameLower.includes('ventas perdido') ||
            statusNameLower.includes('lost')
          ) {
            lostStatusIds.add(status.id)
          }
        }
      })
    })

    return { wonStatusIds, lostStatusIds }
  }

  /**
   * Calcula estadísticas de leads
   */
  async getLeadsStats() {
    // Ejecutar en secuencia en lugar de paralelo para evitar rate limiting
    // Primero obtener pipelines (más rápido), luego leads
    const pipelines = await this.getPipelines()
    
    // Usar getLeadsWithFilters sin filtros para obtener todos los leads
    // Esto asegura que usamos la misma lógica que las estadísticas filtradas
    console.log('[KOMMO STATS] Obteniendo todos los leads (sin filtros)...')
    const leads = await this.getLeadsWithFilters({})
    console.log(`[KOMMO STATS] Total leads obtenidos: ${leads.length}`)

    // Crear un mapa de pipelines y statuses para búsqueda rápida
    const pipelineMap = new Map<number, KommoPipeline>()
    const statusMap = new Map<number, KommoStatus>()
    // Mapa de statuses por pipeline para verificar que un status pertenece al pipeline correcto
    const statusByPipeline = new Map<number, Set<number>>() // pipelineId -> Set<statusId>

    pipelines.forEach((pipeline) => {
      pipelineMap.set(pipeline.id, pipeline)
      const pipelineStatusIds = new Set<number>()
      pipeline._embedded?.statuses?.forEach((status) => {
        statusMap.set(status.id, status)
        pipelineStatusIds.add(status.id)
      })
      statusByPipeline.set(pipeline.id, pipelineStatusIds)
    })

    // Filtrar leads activos (no eliminados)
    // IMPORTANTE: Algunos leads pueden tener is_deleted como null o undefined, tratarlos como activos
    const activeLeads = leads.filter((lead) => lead.is_deleted !== true)

    // Identificar etapas ganadas y perdidas POR PIPELINE (no globalmente)
    // Esto es crítico porque un status_id puede tener diferentes significados en diferentes pipelines
    const wonLostByPipeline = new Map<number, { wonStatusIds: Set<number>, lostStatusIds: Set<number> }>()
    
    pipelines.forEach((pipeline) => {
      const pipelineStatuses = pipeline._embedded?.statuses || []
      if (pipelineStatuses.length === 0) return

      const wonStatusIds = new Set<number>()
      const lostStatusIds = new Set<number>()

      // Ordenar statuses por sort (orden en el pipeline)
      const sortedStatuses = [...pipelineStatuses].sort((a, b) => a.sort - b.sort)

      // Identificar las últimas dos etapas primero
      if (sortedStatuses.length >= 2) {
        const lastStatus = sortedStatuses[sortedStatuses.length - 1]
        const secondLastStatus = sortedStatuses[sortedStatuses.length - 2]
        
        // PRIMERO: Identificar por tipo (MÁS CONFIABLE)
        if (lastStatus.type === 1) {
          wonStatusIds.add(lastStatus.id)
        } else if (lastStatus.type === 2) {
          lostStatusIds.add(lastStatus.id)
        }
        
        if (secondLastStatus.type === 1) {
          wonStatusIds.add(secondLastStatus.id)
        } else if (secondLastStatus.type === 2) {
          lostStatusIds.add(secondLastStatus.id)
        }
        
        // SEGUNDO: Si no tienen tipo definido, usar nombres y posición
        if (!wonStatusIds.has(lastStatus.id) && !lostStatusIds.has(lastStatus.id)) {
          const lastStatusNameLower = lastStatus.name.toLowerCase().trim()
          
          if (
            lastStatusNameLower.includes('cierre exitoso') ||
            lastStatusNameLower.includes('closed - won') ||
            lastStatusNameLower.includes('closed won') ||
            lastStatusNameLower.includes('closed-won') ||
            lastStatusNameLower.includes('logrado') ||
            lastStatusNameLower.includes('exito') ||
            lastStatusNameLower.includes('éxito') ||
            lastStatusNameLower.includes('ganado') ||
            (lastStatusNameLower.includes('won') && !lastStatusNameLower.includes('lost'))
          ) {
            wonStatusIds.add(lastStatus.id)
          } else if (
            lastStatusNameLower.includes('cierre perdido') ||
            lastStatusNameLower.includes('closed - lost') ||
            lastStatusNameLower.includes('closed lost') ||
            lastStatusNameLower.includes('closed-lost') ||
            lastStatusNameLower.includes('perdido') ||
            lastStatusNameLower.includes('perdida') ||
            lastStatusNameLower.includes('ventas perdido') ||
            (lastStatusNameLower.includes('lost') && !lastStatusNameLower.includes('won'))
          ) {
            lostStatusIds.add(lastStatus.id)
          } else {
            // Por defecto, la última etapa es PERDIDA
            lostStatusIds.add(lastStatus.id)
          }
        }
        
        if (!wonStatusIds.has(secondLastStatus.id) && !lostStatusIds.has(secondLastStatus.id)) {
          const secondLastStatusNameLower = secondLastStatus.name.toLowerCase().trim()
          
          if (
            secondLastStatusNameLower.includes('cierre exitoso') ||
            secondLastStatusNameLower.includes('closed - won') ||
            secondLastStatusNameLower.includes('closed won') ||
            secondLastStatusNameLower.includes('closed-won') ||
            secondLastStatusNameLower.includes('logrado') ||
            secondLastStatusNameLower.includes('exito') ||
            secondLastStatusNameLower.includes('éxito') ||
            secondLastStatusNameLower.includes('ganado') ||
            (secondLastStatusNameLower.includes('won') && !secondLastStatusNameLower.includes('lost'))
          ) {
            wonStatusIds.add(secondLastStatus.id)
          } else if (
            secondLastStatusNameLower.includes('cierre perdido') ||
            secondLastStatusNameLower.includes('closed - lost') ||
            secondLastStatusNameLower.includes('closed lost') ||
            secondLastStatusNameLower.includes('closed-lost') ||
            secondLastStatusNameLower.includes('perdido') ||
            secondLastStatusNameLower.includes('perdida') ||
            secondLastStatusNameLower.includes('ventas perdido') ||
            (secondLastStatusNameLower.includes('lost') && !secondLastStatusNameLower.includes('won'))
          ) {
            lostStatusIds.add(secondLastStatus.id)
          } else {
            // Por defecto, la penúltima etapa es GANADA
            wonStatusIds.add(secondLastStatus.id)
          }
        }
      }

      // Identificar otros statuses por tipo (no solo las últimas dos)
      sortedStatuses.forEach((status) => {
        if (status.type === 1) {
          wonStatusIds.add(status.id)
        } else if (status.type === 2) {
          lostStatusIds.add(status.id)
        }
      })

      // Identificar otros statuses por nombre (para statuses que no son las últimas dos)
      sortedStatuses.forEach((status) => {
        const isLastTwo = sortedStatuses.length >= 2 && 
          (status.id === sortedStatuses[sortedStatuses.length - 1].id || 
           status.id === sortedStatuses[sortedStatuses.length - 2].id)
        
        if (!isLastTwo && !wonStatusIds.has(status.id) && !lostStatusIds.has(status.id)) {
          const statusNameLower = status.name.toLowerCase().trim()
          
          if (
            statusNameLower.includes('cierre exitoso') ||
            statusNameLower.includes('closed - won') ||
            statusNameLower.includes('closed won') ||
            statusNameLower.includes('closed-won') ||
            statusNameLower.includes('logrado') ||
            statusNameLower.includes('exito') ||
            statusNameLower.includes('éxito') ||
            statusNameLower.includes('ganado') ||
            statusNameLower.includes('won')
          ) {
            wonStatusIds.add(status.id)
          } else if (
            statusNameLower.includes('cierre perdido') ||
            statusNameLower.includes('closed - lost') ||
            statusNameLower.includes('closed lost') ||
            statusNameLower.includes('closed-lost') ||
            statusNameLower.includes('perdido') ||
            statusNameLower.includes('perdida') ||
            statusNameLower.includes('ventas perdido') ||
            statusNameLower.includes('lost')
          ) {
            lostStatusIds.add(status.id)
          }
        }
      })

      wonLostByPipeline.set(pipeline.id, { wonStatusIds, lostStatusIds })
    })

    // Calcular totales usando la clasificación por pipeline
    // El TOTAL debe incluir TODOS los leads (incluyendo eliminados), no solo los activos
    const totalLeads = leads.length // Todos los leads, incluyendo eliminados
    const wonLeads = activeLeads.filter((lead) => {
      const pipelineWonLost = wonLostByPipeline.get(lead.pipeline_id)
      return pipelineWonLost?.wonStatusIds.has(lead.status_id) ?? false
    })
    const lostLeads = activeLeads.filter((lead) => {
      const pipelineWonLost = wonLostByPipeline.get(lead.pipeline_id)
      return pipelineWonLost?.lostStatusIds.has(lead.status_id) ?? false
    })

    // Crear conjuntos globales para los logs (solo para depuración)
    const wonStatusIds = new Set<number>()
    const lostStatusIds = new Set<number>()
    wonLostByPipeline.forEach(({ wonStatusIds: won, lostStatusIds: lost }) => {
      won.forEach(id => wonStatusIds.add(id))
      lost.forEach(id => lostStatusIds.add(id))
    })
    
    // Verificación adicional: contar leads por status_id para detectar discrepancias
    const leadsByStatusId = new Map<number, number>()
    activeLeads.forEach((lead) => {
      leadsByStatusId.set(lead.status_id, (leadsByStatusId.get(lead.status_id) || 0) + 1)
    })
    
    // Log de leads por status para depuración
    console.log('[KOMMO STATS] ========== LEADS POR STATUS ==========')
    const unclassifiedStatusIds = new Set<number>()
    leadsByStatusId.forEach((count, statusId) => {
      const status = statusMap.get(statusId)
      const isWon = wonStatusIds.has(statusId)
      const isLost = lostStatusIds.has(statusId)
      
      if (!isWon && !isLost && status) {
        unclassifiedStatusIds.add(statusId)
        console.log(`[KOMMO STATS] ⚠️  Status NO CLASIFICADO: "${status.name}" (ID: ${statusId}, Type: ${status.type}) - ${count} leads`)
      } else if (status) {
        const classification = isWon ? 'GANADO' : 'PERDIDO'
        console.log(`[KOMMO STATS] ${classification}: "${status.name}" (ID: ${statusId}) - ${count} leads`)
      }
    })
    
    if (unclassifiedStatusIds.size > 0) {
      console.log(`[KOMMO STATS] ⚠️  ADVERTENCIA: ${unclassifiedStatusIds.size} status(es) no clasificado(s) con ${Array.from(unclassifiedStatusIds).reduce((sum, id) => sum + (leadsByStatusId.get(id) || 0), 0)} leads`)
    }
    console.log('[KOMMO STATS] ===========================================')

    // Log detallado para depuración
    console.log('[KOMMO STATS] ========== RESUMEN DE ESTADÍSTICAS ==========')
    console.log('[KOMMO STATS] Total leads obtenidos de API:', leads.length)
    console.log('[KOMMO STATS] Total leads activos (no eliminados):', totalLeads)
    console.log('[KOMMO STATS] Leads ganados:', wonLeads.length)
    console.log('[KOMMO STATS] Leads perdidos:', lostLeads.length)
    console.log('[KOMMO STATS] Leads activos (abiertos):', totalLeads - wonLeads.length - lostLeads.length)
    console.log('[KOMMO STATS] Won Status IDs:', Array.from(wonStatusIds).sort((a, b) => a - b))
    console.log('[KOMMO STATS] Lost Status IDs:', Array.from(lostStatusIds).sort((a, b) => a - b))
    
    // Log específico para verificar statuses "CIERRE EXITOSO" y "CIERRE PERDIDO"
    console.log('[KOMMO STATS] ========== VERIFICACIÓN STATUSES CIERRE ==========')
    pipelines.forEach((pipeline) => {
      const pipelineWonLost = wonLostByPipeline.get(pipeline.id)
      if (!pipelineWonLost) return
      
      const statuses = pipeline._embedded?.statuses || []
      const sortedStatuses = [...statuses].sort((a, b) => a.sort - b.sort)
      if (sortedStatuses.length >= 2) {
        const lastStatus = sortedStatuses[sortedStatuses.length - 1]
        const secondLastStatus = sortedStatuses[sortedStatuses.length - 2]
        
        const lastIsWon = pipelineWonLost.wonStatusIds.has(lastStatus.id)
        const lastIsLost = pipelineWonLost.lostStatusIds.has(lastStatus.id)
        const secondIsWon = pipelineWonLost.wonStatusIds.has(secondLastStatus.id)
        const secondIsLost = pipelineWonLost.lostStatusIds.has(secondLastStatus.id)
        
        // Contar leads de este pipeline específico en estas etapas
        const lastLeadsCount = activeLeads.filter(l => l.pipeline_id === pipeline.id && l.status_id === lastStatus.id).length
        const secondLeadsCount = activeLeads.filter(l => l.pipeline_id === pipeline.id && l.status_id === secondLastStatus.id).length
        
        console.log(`[KOMMO STATS] Pipeline: "${pipeline.name}" (ID: ${pipeline.id})`)
        console.log(`[KOMMO STATS]   ÚLTIMA etapa: "${lastStatus.name}" (ID: ${lastStatus.id}, Type: ${lastStatus.type}, Sort: ${lastStatus.sort})`)
        console.log(`[KOMMO STATS]     Clasificado como: ${lastIsWon ? '✓ GANADO' : lastIsLost ? '✗ PERDIDO' : '○ NO CLASIFICADO'}`)
        console.log(`[KOMMO STATS]     Leads en esta etapa (pipeline ${pipeline.id}): ${lastLeadsCount}`)
        console.log(`[KOMMO STATS]   PENÚLTIMA etapa: "${secondLastStatus.name}" (ID: ${secondLastStatus.id}, Type: ${secondLastStatus.type}, Sort: ${secondLastStatus.sort})`)
        console.log(`[KOMMO STATS]     Clasificado como: ${secondIsWon ? '✓ GANADO' : secondIsLost ? '✗ PERDIDO' : '○ NO CLASIFICADO'}`)
        console.log(`[KOMMO STATS]     Leads en esta etapa (pipeline ${pipeline.id}): ${secondLeadsCount}`)
      }
    })
    console.log('[KOMMO STATS] ===========================================')
    
    // Log detallado de los statuses por pipeline
    console.log('[KOMMO STATS] ========== STATUSES POR PIPELINE ==========')
    pipelines.forEach((pipeline) => {
      const pipelineWonLost = wonLostByPipeline.get(pipeline.id)
      if (!pipelineWonLost) return
      
      const statuses = pipeline._embedded?.statuses || []
      if (statuses.length > 0) {
        console.log(`[KOMMO STATS] Pipeline: "${pipeline.name}" (ID: ${pipeline.id})`)
        const sortedStatuses = [...statuses].sort((a, b) => a.sort - b.sort)
        sortedStatuses.forEach((status) => {
          const isWon = pipelineWonLost.wonStatusIds.has(status.id)
          const isLost = pipelineWonLost.lostStatusIds.has(status.id)
          const classification = isWon ? '✓ GANADO' : isLost ? '✗ PERDIDO' : '○ ABIERTO'
          const typeLabel = status.type === 1 ? 'WON' : status.type === 2 ? 'LOST' : 'OPEN'
          const leadsInThisPipeline = activeLeads.filter(l => l.pipeline_id === pipeline.id && l.status_id === status.id).length
          console.log(`[KOMMO STATS]   - Status: "${status.name}" | ID: ${status.id} | Type: ${typeLabel} (${status.type}) | Sort: ${status.sort} | Clasificación: ${classification} | Leads: ${leadsInThisPipeline}`)
        })
      }
    })
    console.log('[KOMMO STATS] ===========================================')

    // Distribución por pipeline y etapa
    const distributionByPipeline: Record<
      number,
      {
        pipelineId: number
        pipelineName: string
        stages: Record<
          number,
          {
            statusId: number
            statusName: string
            count: number
            type: 'open' | 'won' | 'lost'
          }
        >
        total: number
      }
    > = {}

    activeLeads.forEach((lead) => {
      const pipeline = pipelineMap.get(lead.pipeline_id)
      const status = statusMap.get(lead.status_id)

      if (!pipeline || !status) return

      // Verificar que el status pertenece al pipeline del lead
      const pipelineStatusIds = statusByPipeline.get(lead.pipeline_id)
      if (!pipelineStatusIds || !pipelineStatusIds.has(lead.status_id)) {
        // El status no pertenece a este pipeline, saltar este lead
        console.warn(`[KOMMO STATS] Lead ${lead.id} tiene status_id ${lead.status_id} que no pertenece al pipeline ${lead.pipeline_id}`)
        return
      }

      if (!distributionByPipeline[lead.pipeline_id]) {
        distributionByPipeline[lead.pipeline_id] = {
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          stages: {},
          total: 0,
        }
      }

      if (!distributionByPipeline[lead.pipeline_id].stages[lead.status_id]) {
        // Determinar el tipo de etapa usando la clasificación por pipeline
        let stageType: 'open' | 'won' | 'lost' = 'open'
        const pipelineWonLost = wonLostByPipeline.get(lead.pipeline_id)
        
        if (pipelineWonLost?.wonStatusIds.has(status.id)) {
          stageType = 'won'
        } else if (pipelineWonLost?.lostStatusIds.has(status.id)) {
          stageType = 'lost'
        }

        distributionByPipeline[lead.pipeline_id].stages[lead.status_id] = {
          statusId: status.id,
          statusName: status.name,
          count: 0,
          type: stageType,
        }
      }

      distributionByPipeline[lead.pipeline_id].stages[lead.status_id].count++
      distributionByPipeline[lead.pipeline_id].total++
    })

    // Convertir a array para facilitar el uso en el frontend
    const pipelineDistribution = Object.values(distributionByPipeline).map((pipeline) => ({
      ...pipeline,
      stages: Object.values(pipeline.stages),
    }))

    return {
      totals: {
        total: totalLeads, // Total incluye TODOS los leads (incluyendo eliminados)
        won: wonLeads.length,
        lost: lostLeads.length,
        active: activeLeads.length - wonLeads.length - lostLeads.length, // Activos = activos - won - lost
      },
      distribution: pipelineDistribution,
      lastUpdated: new Date().toISOString(),
    }
  }

  /**
   * Calcula estadísticas de leads filtrados
   * Similar a getLeadsStats pero para un conjunto específico de leads
   */
  async getFilteredLeadsStats(leads: KommoLead[]) {
    const pipelines = await this.getPipelines()

    // Crear un mapa de pipelines y statuses para búsqueda rápida
    const pipelineMap = new Map<number, KommoPipeline>()
    const statusMap = new Map<number, KommoStatus>()
    // Mapa de statuses por pipeline para verificar que un status pertenece al pipeline correcto
    const statusByPipeline = new Map<number, Set<number>>() // pipelineId -> Set<statusId>

    pipelines.forEach((pipeline) => {
      pipelineMap.set(pipeline.id, pipeline)
      const pipelineStatusIds = new Set<number>()
      pipeline._embedded?.statuses?.forEach((status) => {
        statusMap.set(status.id, status)
        pipelineStatusIds.add(status.id)
      })
      statusByPipeline.set(pipeline.id, pipelineStatusIds)
    })

    // Filtrar leads activos (no eliminados) para cálculos de won/lost
    // IMPORTANTE: Algunos leads pueden tener is_deleted como null o undefined, tratarlos como activos
    const activeLeads = leads.filter((lead) => lead.is_deleted !== true)
    
    // El TOTAL debe incluir TODOS los leads (incluyendo eliminados)
    const totalLeads = leads.length

    // Identificar etapas ganadas y perdidas POR PIPELINE (no globalmente)
    // Esto es crítico porque un status_id puede tener diferentes significados en diferentes pipelines
    const wonLostByPipeline = new Map<number, { wonStatusIds: Set<number>, lostStatusIds: Set<number> }>()
    
    pipelines.forEach((pipeline) => {
      const pipelineStatuses = pipeline._embedded?.statuses || []
      if (pipelineStatuses.length === 0) return

      const wonStatusIds = new Set<number>()
      const lostStatusIds = new Set<number>()

      // Ordenar statuses por sort (orden en el pipeline)
      const sortedStatuses = [...pipelineStatuses].sort((a, b) => a.sort - b.sort)

      // Identificar las últimas dos etapas primero
      if (sortedStatuses.length >= 2) {
        const lastStatus = sortedStatuses[sortedStatuses.length - 1]
        const secondLastStatus = sortedStatuses[sortedStatuses.length - 2]
        
        // PRIMERO: Identificar por tipo (MÁS CONFIABLE)
        if (lastStatus.type === 1) {
          wonStatusIds.add(lastStatus.id)
        } else if (lastStatus.type === 2) {
          lostStatusIds.add(lastStatus.id)
        }
        
        if (secondLastStatus.type === 1) {
          wonStatusIds.add(secondLastStatus.id)
        } else if (secondLastStatus.type === 2) {
          lostStatusIds.add(secondLastStatus.id)
        }
        
        // SEGUNDO: Si no tienen tipo definido, usar nombres y posición
        if (!wonStatusIds.has(lastStatus.id) && !lostStatusIds.has(lastStatus.id)) {
          const lastStatusNameLower = lastStatus.name.toLowerCase().trim()
          
          if (
            lastStatusNameLower.includes('cierre exitoso') ||
            lastStatusNameLower.includes('closed - won') ||
            lastStatusNameLower.includes('closed won') ||
            lastStatusNameLower.includes('closed-won') ||
            lastStatusNameLower.includes('logrado') ||
            lastStatusNameLower.includes('exito') ||
            lastStatusNameLower.includes('éxito') ||
            lastStatusNameLower.includes('ganado') ||
            (lastStatusNameLower.includes('won') && !lastStatusNameLower.includes('lost'))
          ) {
            wonStatusIds.add(lastStatus.id)
          } else if (
            lastStatusNameLower.includes('cierre perdido') ||
            lastStatusNameLower.includes('closed - lost') ||
            lastStatusNameLower.includes('closed lost') ||
            lastStatusNameLower.includes('closed-lost') ||
            lastStatusNameLower.includes('perdido') ||
            lastStatusNameLower.includes('perdida') ||
            lastStatusNameLower.includes('ventas perdido') ||
            (lastStatusNameLower.includes('lost') && !lastStatusNameLower.includes('won'))
          ) {
            lostStatusIds.add(lastStatus.id)
          } else {
            // Por defecto, la última etapa es PERDIDA
            lostStatusIds.add(lastStatus.id)
          }
        }
        
        if (!wonStatusIds.has(secondLastStatus.id) && !lostStatusIds.has(secondLastStatus.id)) {
          const secondLastStatusNameLower = secondLastStatus.name.toLowerCase().trim()
          
          if (
            secondLastStatusNameLower.includes('cierre exitoso') ||
            secondLastStatusNameLower.includes('closed - won') ||
            secondLastStatusNameLower.includes('closed won') ||
            secondLastStatusNameLower.includes('closed-won') ||
            secondLastStatusNameLower.includes('logrado') ||
            secondLastStatusNameLower.includes('exito') ||
            secondLastStatusNameLower.includes('éxito') ||
            secondLastStatusNameLower.includes('ganado') ||
            (secondLastStatusNameLower.includes('won') && !secondLastStatusNameLower.includes('lost'))
          ) {
            wonStatusIds.add(secondLastStatus.id)
          } else if (
            secondLastStatusNameLower.includes('cierre perdido') ||
            secondLastStatusNameLower.includes('closed - lost') ||
            secondLastStatusNameLower.includes('closed lost') ||
            secondLastStatusNameLower.includes('closed-lost') ||
            secondLastStatusNameLower.includes('perdido') ||
            secondLastStatusNameLower.includes('perdida') ||
            secondLastStatusNameLower.includes('ventas perdido') ||
            (secondLastStatusNameLower.includes('lost') && !secondLastStatusNameLower.includes('won'))
          ) {
            lostStatusIds.add(secondLastStatus.id)
          } else {
            // Por defecto, la penúltima etapa es GANADA
            wonStatusIds.add(secondLastStatus.id)
          }
        }
      }

      // Identificar otros statuses por tipo (no solo las últimas dos)
      sortedStatuses.forEach((status) => {
        if (status.type === 1) {
          wonStatusIds.add(status.id)
        } else if (status.type === 2) {
          lostStatusIds.add(status.id)
        }
      })

      // Identificar otros statuses por nombre (para statuses que no son las últimas dos)
      sortedStatuses.forEach((status) => {
        const isLastTwo = sortedStatuses.length >= 2 && 
          (status.id === sortedStatuses[sortedStatuses.length - 1].id || 
           status.id === sortedStatuses[sortedStatuses.length - 2].id)
        
        if (!isLastTwo && !wonStatusIds.has(status.id) && !lostStatusIds.has(status.id)) {
          const statusNameLower = status.name.toLowerCase().trim()
          
          if (
            statusNameLower.includes('cierre exitoso') ||
            statusNameLower.includes('closed - won') ||
            statusNameLower.includes('closed won') ||
            statusNameLower.includes('closed-won') ||
            statusNameLower.includes('logrado') ||
            statusNameLower.includes('exito') ||
            statusNameLower.includes('éxito') ||
            statusNameLower.includes('ganado') ||
            statusNameLower.includes('won')
          ) {
            wonStatusIds.add(status.id)
          } else if (
            statusNameLower.includes('cierre perdido') ||
            statusNameLower.includes('closed - lost') ||
            statusNameLower.includes('closed lost') ||
            statusNameLower.includes('closed-lost') ||
            statusNameLower.includes('perdido') ||
            statusNameLower.includes('perdida') ||
            statusNameLower.includes('ventas perdido') ||
            statusNameLower.includes('lost')
          ) {
            lostStatusIds.add(status.id)
          }
        }
      })

      wonLostByPipeline.set(pipeline.id, { wonStatusIds, lostStatusIds })
    })

    // Calcular totales usando la clasificación por pipeline
    // totalLeads ya está definido arriba como leads.length (todos los leads, incluyendo eliminados)
    const wonLeads = activeLeads.filter((lead) => {
      const pipelineWonLost = wonLostByPipeline.get(lead.pipeline_id)
      return pipelineWonLost?.wonStatusIds.has(lead.status_id) ?? false
    })
    const lostLeads = activeLeads.filter((lead) => {
      const pipelineWonLost = wonLostByPipeline.get(lead.pipeline_id)
      return pipelineWonLost?.lostStatusIds.has(lead.status_id) ?? false
    })

    // Distribución por pipeline y etapa
    const distributionByPipeline: Record<
      number,
      {
        pipelineId: number
        pipelineName: string
        stages: Record<
          number,
          {
            statusId: number
            statusName: string
            count: number
            type: 'open' | 'won' | 'lost'
          }
        >
        total: number
      }
    > = {}

    activeLeads.forEach((lead) => {
      const pipeline = pipelineMap.get(lead.pipeline_id)
      const status = statusMap.get(lead.status_id)

      if (!pipeline || !status) return

      // Verificar que el status pertenece al pipeline del lead
      const pipelineStatusIds = statusByPipeline.get(lead.pipeline_id)
      if (!pipelineStatusIds || !pipelineStatusIds.has(lead.status_id)) {
        // El status no pertenece a este pipeline, saltar este lead
        console.warn(`[KOMMO STATS] Lead ${lead.id} tiene status_id ${lead.status_id} que no pertenece al pipeline ${lead.pipeline_id}`)
        return
      }

      if (!distributionByPipeline[lead.pipeline_id]) {
        distributionByPipeline[lead.pipeline_id] = {
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          stages: {},
          total: 0,
        }
      }

      if (!distributionByPipeline[lead.pipeline_id].stages[lead.status_id]) {
        let stageType: 'open' | 'won' | 'lost' = 'open'
        const pipelineWonLost = wonLostByPipeline.get(lead.pipeline_id)
        
        if (pipelineWonLost?.wonStatusIds.has(status.id)) {
          stageType = 'won'
        } else if (pipelineWonLost?.lostStatusIds.has(status.id)) {
          stageType = 'lost'
        }

        distributionByPipeline[lead.pipeline_id].stages[lead.status_id] = {
          statusId: status.id,
          statusName: status.name,
          count: 0,
          type: stageType,
        }
      }

      distributionByPipeline[lead.pipeline_id].stages[lead.status_id].count++
      distributionByPipeline[lead.pipeline_id].total++
    })

    // Convertir a array
    const pipelineDistribution = Object.values(distributionByPipeline).map((pipeline) => ({
      ...pipeline,
      stages: Object.values(pipeline.stages),
    }))

    return {
      totals: {
        total: totalLeads, // Total incluye TODOS los leads (incluyendo eliminados)
        won: wonLeads.length,
        lost: lostLeads.length,
        active: activeLeads.length - wonLeads.length - lostLeads.length, // Activos = activos - won - lost
      },
      distribution: pipelineDistribution,
      lastUpdated: new Date().toISOString(),
    }
  }
}

export const kommoApi = new KommoApiClient()

/**
 * Crea una instancia del cliente de Kommo con credenciales específicas
 */
export function createKommoClient(credentials: KommoCredentials): KommoApiClient {
  const client = new KommoApiClient()
  client.setCredentials(credentials)
  return client
}

/**
 * Obtiene la cantidad de cuentas Kommo configuradas para un cliente (1-based para UI: Kommo 1, Kommo 2, ...).
 * Cuenta 0 = kommoCredentials (si existe), cuentas 1, 2, ... = kommoAccounts[0], [1], ...
 */
export async function getKommoAccountsCount(customerId: string): Promise<number> {
  try {
    const { getMongoDb } = await import('./mongodb.js')
    const { ObjectId } = await import('mongodb')
    const db = await getMongoDb()
    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(customerId)
    })
    if (!customer) return 0
    const hasFirst = !!(customer.kommoCredentials?.accessToken)
    const extraCount = (customer.kommoAccounts && Array.isArray(customer.kommoAccounts)) ? customer.kommoAccounts.length : 0
    return (hasFirst ? 1 : 0) + extraCount
  } catch {
    return 0
  }
}

/**
 * Obtiene las credenciales de Kommo para la cuenta indicada (accountIndex 0-based).
 * Cuenta 0 = kommoCredentials (si existe), cuentas 1, 2, ... = kommoAccounts[0], [1], ...
 */
export async function getKommoCredentialsForCustomer(customerId: string, accountIndex: number = 0): Promise<KommoCredentials | null> {
  try {
    const { getMongoDb } = await import('./mongodb.js')
    const { ObjectId } = await import('mongodb')
    const db = await getMongoDb()
    
    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(customerId)
    })
    
    if (!customer) {
      console.error('[KOMMO] Cliente no encontrado:', customerId)
      return null
    }
    
    const hasFirst = !!(customer.kommoCredentials?.accessToken)
    const kommoAccounts = customer.kommoAccounts && Array.isArray(customer.kommoAccounts) ? customer.kommoAccounts : []
    
    let encrypted: { baseUrl?: string; accessToken: string; integrationId?: string; secretKey?: string } | null = null
    if (accountIndex === 0 && hasFirst) {
      encrypted = customer.kommoCredentials as any
    } else if (kommoAccounts.length > 0) {
      const indexInArray = hasFirst ? accountIndex - 1 : accountIndex
      if (indexInArray >= 0 && indexInArray < kommoAccounts.length) {
        encrypted = kommoAccounts[indexInArray] as any
      }
    }
    
    if (!encrypted?.accessToken) {
      console.error('[KOMMO] Cliente no tiene credenciales de Kommo para cuenta índice:', accountIndex, customerId)
      return null
    }
    
    try {
      // Normalizar baseUrl al obtenerlo de la base de datos
      let baseUrl = encrypted.baseUrl?.trim() || ''
      if (baseUrl) {
        baseUrl = baseUrl.replace(/\/+$/, '')
        if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
          baseUrl = `https://${baseUrl}`
        }
      }
      
      const credentials = {
        baseUrl: baseUrl,
        accessToken: decrypt(encrypted.accessToken),
        integrationId: encrypted.integrationId,
        secretKey: encrypted.secretKey ? decrypt(encrypted.secretKey) : undefined,
      }
      
      console.log('[KOMMO] Credenciales obtenidas de BD:', {
        customerId,
        accountIndex,
        baseUrlOriginal: encrypted.baseUrl,
        baseUrlNormalizado: credentials.baseUrl,
        hasAccessToken: !!credentials.accessToken,
      })
      
      return credentials
    } catch (error) {
      console.error('[KOMMO] Error al desencriptar credenciales:', error)
      throw new Error('Error al desencriptar credenciales de Kommo')
    }
  } catch (error) {
    console.error('[KOMMO] Error al obtener credenciales:', error)
    return null
  }
}
