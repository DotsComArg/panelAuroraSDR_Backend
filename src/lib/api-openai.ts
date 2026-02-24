import { decrypt } from './encryption-utils.js'

interface OpenAICredentials {
  apiKey: string // API key desencriptada
  organizationId?: string // ID de la organización (opcional)
  projectId?: string // ID del proyecto (opcional)
}

interface OpenAIUsageData {
  object: string
  daily_costs: Array<{
    timestamp: number
    line_items: Array<{
      name: string
      cost: number
    }>
  }>
  total_usage: number
  total_cost: number
  total_requests?: number
}

interface OpenAITokenUsage {
  date: string
  tokens: number
  requests: number
  cost: number
  models: Record<string, { tokens: number; requests: number; cost: number }>
}

/**
 * Obtiene las credenciales de OpenAI de un cliente y las desencripta
 */
export async function getOpenAICredentialsForCustomer(customerId: string): Promise<OpenAICredentials | null> {
  try {
    const { getMongoDb } = await import('./mongodb.js')
    const { ObjectId } = await import('mongodb')
    const db = await getMongoDb()
    
    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(customerId)
    })
    
    if (!customer) {
      console.error('[OPENAI] Cliente no encontrado:', customerId)
      return null
    }
    
    if (!customer.openAICredentials) {
      console.error('[OPENAI] Cliente no tiene credenciales de OpenAI:', customerId)
      return null
    }
    
    const encrypted = customer.openAICredentials
    
    try {
      const credentials = {
        apiKey: decrypt(encrypted.apiKey),
        organizationId: encrypted.organizationId,
        projectId: encrypted.projectId,
      }
      
      console.log('[OPENAI] Credenciales obtenidas de BD:', {
        customerId,
        hasApiKey: !!credentials.apiKey,
        apiKeyLength: credentials.apiKey?.length || 0,
        hasOrganizationId: !!credentials.organizationId,
        hasProjectId: !!credentials.projectId,
      })
      
      return credentials
    } catch (error) {
      console.error('[OPENAI] Error al desencriptar credenciales:', error)
      throw new Error('Error al desencriptar credenciales de OpenAI')
    }
  } catch (error) {
    console.error('[OPENAI] Error al obtener credenciales:', error)
    return null
  }
}

/**
 * Obtiene el uso de tokens de OpenAI desde su API
 * Documentación: https://platform.openai.com/docs/api-reference/usage
 * Endpoint: https://api.openai.com/v1/organization/usage/completions
 */
export async function getOpenAIUsage(
  credentials: OpenAICredentials,
  startDate?: Date,
  endDate?: Date
): Promise<OpenAIUsageData | null> {
  try {
    // Si no se proporcionan fechas, usar los últimos 30 días para capturar más datos
    const end = endDate || new Date()
    const start = startDate || (() => {
      const date = new Date(end)
      date.setDate(date.getDate() - 30)
      return date
    })()

    // Convertir fechas a timestamps Unix (segundos)
    let startTime = Math.floor(start.getTime() / 1000)
    const endTime = Math.floor(end.getTime() / 1000)

    console.log('[OPENAI] Intentando obtener uso desde OpenAI API:', {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
      startTime,
      endTime,
    })

    // Intentar primero con el endpoint de organization/usage/completions
    // Según la documentación: GET /v1/organization/usage/completions
    // Puede requerir organization ID o project ID en los headers
    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      }
      
      // Agregar organization ID en el header si está disponible
      // Según la documentación: OpenAI requiere el header OpenAI-Organization
      if (credentials.organizationId) {
        headers['OpenAI-Organization'] = credentials.organizationId
        console.log('[OPENAI] Usando Organization ID:', credentials.organizationId)
      }
      
      // Calcular días entre start y end
      const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
      
      // El endpoint tiene límites según bucket_width:
      // - bucket_width=1d: máximo 31 días y limit máximo de 31
      // - bucket_width=1h: máximo 168 horas (7 días) y limit máximo de 168
      // - bucket_width=1m: máximo 1440 minutos (1 día) y limit máximo de 1440
      // Usamos bucket_width=1d por defecto
      let bucketWidth = '1d'
      let limit = 31 // Para bucket_width=1d, el limit máximo es 31
      
      if (daysDiff > 31) {
        // Si excede 31 días, limitar a 31 días desde el end date
        const limitedStart = new Date(end)
        limitedStart.setDate(limitedStart.getDate() - 31)
        const limitedStartTime = Math.floor(limitedStart.getTime() / 1000)
        startTime = limitedStartTime
        console.log('[OPENAI] Rango de fechas excede 31 días, limitando a los últimos 31 días')
      }
      
      // Si hay project ID, agregarlo como parámetro en la URL o en el header
      // Según la documentación, puede ir en el header OpenAI-Project
      let url = `https://api.openai.com/v1/organization/usage/completions?start_time=${startTime}&end_time=${endTime}&bucket_width=${bucketWidth}&limit=${limit}`
      if (credentials.projectId) {
        // Intentar primero en el header (más común)
        headers['OpenAI-Project'] = credentials.projectId
        // También como parámetro por si acaso
        url += `&project_id=${credentials.projectId}`
        console.log('[OPENAI] Usando Project ID:', credentials.projectId)
      }
      
      console.log('[OPENAI] URL completa:', url.replace(credentials.apiKey, '***'))
      
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })

      if (response.ok) {
        const data = await response.json() as any
        console.log('[OPENAI] ✅ Datos obtenidos del endpoint organization/usage/completions')
        console.log('[OPENAI] Estructura de respuesta:', {
          keys: Object.keys(data),
          hasData: !!data.data,
          dataLength: Array.isArray(data.data) ? data.data.length : 0,
        })

        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
          console.log('[OPENAI] Ejemplo de bucket:', JSON.stringify(data.data[0], null, 2))
          
          // Procesar los datos del endpoint de completions
          // La respuesta contiene buckets con start_time, end_time y results
          // Agrupar por fecha
          const dailyCostsMap: Record<string, any> = {}
          let bucketsWithData = 0
          let bucketsWithoutData = 0
          
          for (const bucket of data.data) {
            // Cada bucket tiene: start_time, end_time, results (array)
            // Usar end_time para la fecha del bucket (representa el final del período)
            const bucketTimestamp = bucket.end_time || bucket.start_time
            if (!bucketTimestamp) {
              console.warn('[OPENAI] Bucket sin timestamp válido:', bucket)
              continue
            }
            
            const bucketDate = new Date(bucketTimestamp * 1000).toISOString().split('T')[0]
            
            if (!dailyCostsMap[bucketDate]) {
              dailyCostsMap[bucketDate] = {
                timestamp: bucketTimestamp,
                line_items: [],
                date: bucketDate,
              }
            }

            // Procesar los resultados dentro del bucket
            const results = bucket.results || []
            
            if (results.length > 0) {
              bucketsWithData++
              // Si hay resultados, procesarlos individualmente
              // La API puede devolver input_tokens/output_tokens/num_model_requests (nuevo) o n_context_tokens_total/n_generated_tokens_total/n_requests (legacy)
              for (const result of results) {
                const tokens = (result.input_tokens != null || result.output_tokens != null)
                  ? (result.input_tokens || 0) + (result.output_tokens || 0)
                  : (result.n_context_tokens_total || 0) + (result.n_generated_tokens_total || 0)
                const requests = result.num_model_requests ?? result.n_requests ?? 1
                const model = result.model || result.snapshot_id || 'Sin especificar'
                
                // Calcular costo aproximado
                const modelLower = model.toLowerCase()
                let costPer1K = 0.002
                if (modelLower.includes('gpt-4-turbo') || modelLower.includes('gpt-4o')) {
                  costPer1K = 0.01
                } else if (modelLower.includes('gpt-4')) {
                  costPer1K = 0.03
                } else if (modelLower.includes('gpt-3.5-turbo')) {
                  costPer1K = 0.0005
                }
                const cost = (tokens / 1000) * costPer1K

                dailyCostsMap[bucketDate].line_items.push({
                  name: model,
                  cost: cost,
                  tokens: tokens,
                  requests: requests,
                })
              }
            } else {
              bucketsWithoutData++
              // Si no hay resultados en el bucket, puede ser que los datos agregados estén en el bucket mismo
              const bucketInput = bucket.input_tokens ?? bucket.n_context_tokens_total
              const bucketOutput = bucket.output_tokens ?? bucket.n_generated_tokens_total
              if (bucketInput !== undefined || bucketOutput !== undefined) {
                const tokens = (bucketInput || 0) + (bucketOutput || 0)
                const requests = bucket.num_model_requests ?? bucket.n_requests ?? 0
                const model = bucket.model || bucket.snapshot_id || 'aggregated'
                
                if (tokens > 0 || requests > 0) {
                  bucketsWithData++
                  bucketsWithoutData--
                  const modelLower = model.toLowerCase()
                  let costPer1K = 0.002
                  if (modelLower.includes('gpt-4-turbo') || modelLower.includes('gpt-4o')) {
                    costPer1K = 0.01
                  } else if (modelLower.includes('gpt-4')) {
                    costPer1K = 0.03
                  } else if (modelLower.includes('gpt-3.5-turbo')) {
                    costPer1K = 0.0005
                  }
                  const cost = (tokens / 1000) * costPer1K

                  dailyCostsMap[bucketDate].line_items.push({
                    name: model,
                    cost: cost,
                    tokens: tokens,
                    requests: requests,
                  })
                }
              }
            }
          }
          
          console.log(`[OPENAI] Procesados ${data.data.length} buckets: ${bucketsWithData} con datos, ${bucketsWithoutData} sin datos`)

          // Calcular totales
          const totalCost = Object.values(dailyCostsMap).reduce((sum: number, day: any) => {
            return sum + day.line_items.reduce((daySum: number, item: any) => daySum + item.cost, 0)
          }, 0)

          const totalTokens = Object.values(dailyCostsMap).reduce((sum: number, day: any) => {
            return sum + day.line_items.reduce((daySum: number, item: any) => daySum + item.tokens, 0)
          }, 0)

          const totalRequests = Object.values(dailyCostsMap).reduce((sum: number, day: any) => {
            return sum + day.line_items.reduce((daySum: number, item: any) => daySum + item.requests, 0)
          }, 0)

          // Solo retornar si hay datos
          if (totalTokens > 0 || totalRequests > 0) {
            console.log(`[OPENAI] ✅ Datos procesados exitosamente: ${totalTokens} tokens, ${totalRequests} requests, $${totalCost.toFixed(4)}`)
            return {
              object: 'list',
              daily_costs: Object.values(dailyCostsMap),
              total_usage: totalTokens,
              total_cost: totalCost,
              total_requests: totalRequests,
            }
          } else {
            console.warn(`[OPENAI] ⚠️ El endpoint devolvió ${data.data.length} buckets pero todos están vacíos (sin datos)`)
            console.warn(`[OPENAI] Esto puede significar:`)
            console.warn(`[OPENAI]   1. No hay datos para el período consultado`)
            console.warn(`[OPENAI]   2. El Project ID no está configurado correctamente`)
            console.warn(`[OPENAI]   3. El endpoint requiere permisos adicionales`)
          }
        }
      } else {
        const errorText = await response.text()
        console.warn('[OPENAI] Error en organization/usage/completions:', response.status, errorText)
      }
    } catch (error) {
      console.warn('[OPENAI] Error al usar organization/usage/completions:', error)
    }

    // Fallback: intentar con el endpoint /v1/usage (día por día)
    // NOTA: Este endpoint también requiere permisos especiales (api.read scope)
    // y puede no estar disponible para todas las cuentas
    console.log('[OPENAI] Intentando con endpoint /v1/usage como fallback...')
    console.log('[OPENAI] ⚠️ Este endpoint requiere el scope api.read y puede no estar disponible')
    
    const dates: string[] = []
    const currentDate = new Date(start)
    while (currentDate <= end) {
      dates.push(currentDate.toISOString().split('T')[0])
      currentDate.setDate(currentDate.getDate() + 1)
    }

    // Limitar a las últimas 31 días para evitar demasiadas peticiones
    // y porque el endpoint principal también tiene este límite
    const datesToFetch = dates.slice(-31)
    console.log(`[OPENAI] Obteniendo datos para ${datesToFetch.length} días (desde ${datesToFetch[0]} hasta ${datesToFetch[datesToFetch.length - 1]})...`)
    
    const dailyData: any[] = []
    let datesWithData = 0
    let datesWithoutData = 0
    
    for (const date of datesToFetch) {
      try {
        const headers: Record<string, string> = {
          'Authorization': `Bearer ${credentials.apiKey}`,
          'Content-Type': 'application/json',
        }
        
        // Agregar Organization ID si está disponible
        if (credentials.organizationId) {
          headers['OpenAI-Organization'] = credentials.organizationId
        }
        
        const dayResponse = await fetch(
          `https://api.openai.com/v1/usage?date=${date}`,
          {
            method: 'GET',
            headers,
          }
        )
        
        if (dayResponse.ok) {
          const dayData = await dayResponse.json() as any
          console.log(`[OPENAI] Datos obtenidos para ${date}:`, {
            keys: Object.keys(dayData),
            hasData: !!dayData.data,
            dataLength: Array.isArray(dayData.data) ? dayData.data.length : 0,
          })
          
          // OpenAI devuelve los datos en el campo 'data' como array
          // La estructura puede ser: { object: "list", data: [{...}], ... }
          // IMPORTANTE: El campo 'data' contiene los datos de chat completions
          let hasDataForThisDate = false
          
          if (dayData.data && Array.isArray(dayData.data) && dayData.data.length > 0) {
            console.log(`[OPENAI] ✅ Encontrados ${dayData.data.length} items en 'data' para ${date}`)
            console.log(`[OPENAI] Estructura del primer item:`, JSON.stringify(dayData.data[0], null, 2))
            hasDataForThisDate = true
            datesWithData++
            
            // Agregar timestamp y fecha a cada item
            const dataWithDate = dayData.data.map((item: any) => ({
              ...item,
              timestamp: new Date(date).getTime() / 1000,
              date: date,
            }))
            dailyData.push(...dataWithDate)
          }
          
          // Verificar otros campos de datos
          const hasAnyOtherData = 
            (dayData.dalle_api_data && dayData.dalle_api_data.length > 0) ||
            (dayData.tts_api_data && dayData.tts_api_data.length > 0) ||
            (dayData.whisper_api_data && dayData.whisper_api_data.length > 0) ||
            (dayData.assistant_code_interpreter_data && dayData.assistant_code_interpreter_data.length > 0)
          
          if (!hasDataForThisDate && !hasAnyOtherData) {
            datesWithoutData++
          }
          
          // También procesar otros tipos de datos (DALL-E, TTS, etc.)
          if (dayData.dalle_api_data && Array.isArray(dayData.dalle_api_data) && dayData.dalle_api_data.length > 0) {
            console.log(`[OPENAI] Encontrados ${dayData.dalle_api_data.length} items DALL-E para ${date}`)
            const dalleWithDate = dayData.dalle_api_data.map((item: any) => ({
              ...item,
              timestamp: new Date(date).getTime() / 1000,
              date: date,
              type: 'dalle',
            }))
            dailyData.push(...dalleWithDate)
          }
          
          if (dayData.tts_api_data && Array.isArray(dayData.tts_api_data) && dayData.tts_api_data.length > 0) {
            console.log(`[OPENAI] Encontrados ${dayData.tts_api_data.length} items TTS para ${date}`)
            const ttsWithDate = dayData.tts_api_data.map((item: any) => ({
              ...item,
              timestamp: new Date(date).getTime() / 1000,
              date: date,
              type: 'tts',
            }))
            dailyData.push(...ttsWithDate)
          }
          
          if (dayData.whisper_api_data && Array.isArray(dayData.whisper_api_data) && dayData.whisper_api_data.length > 0) {
            console.log(`[OPENAI] Encontrados ${dayData.whisper_api_data.length} items Whisper para ${date}`)
            const whisperWithDate = dayData.whisper_api_data.map((item: any) => ({
              ...item,
              timestamp: new Date(date).getTime() / 1000,
              date: date,
              type: 'whisper',
            }))
            dailyData.push(...whisperWithDate)
          }
        } else {
          const errorText = await dayResponse.text()
          console.warn(`[OPENAI] Error al obtener datos para ${date}:`, dayResponse.status, errorText)
        }
      } catch (error) {
        console.error(`[OPENAI] Error al obtener datos para ${date}:`, error)
      }
    }

    console.log(`[OPENAI] Resumen: ${datesWithData} fechas con datos, ${datesWithoutData} fechas sin datos`)
    
    if (dailyData.length > 0) {
      console.log(`[OPENAI] ✅ Total de items obtenidos: ${dailyData.length}`)
      
      // Procesar los datos para calcular costos y tokens
      // Los datos de OpenAI vienen en formato diferente, necesitamos extraer la información
      let totalCost = 0
      let totalTokens = 0
      let totalRequests = 0
      
      console.log(`[OPENAI] Procesando ${dailyData.length} items de datos`)
      
      // Agrupar por fecha para crear daily_costs
      const dailyCostsMap: Record<string, any> = {}
      
      for (const item of dailyData) {
        const itemDate = item.date || new Date(item.timestamp * 1000).toISOString().split('T')[0]
        
        if (!dailyCostsMap[itemDate]) {
          dailyCostsMap[itemDate] = {
            timestamp: new Date(itemDate).getTime() / 1000,
            line_items: [],
            date: itemDate,
          }
        }
        
        // Extraer información del item
        // API actual: input_tokens, output_tokens, num_model_requests; legacy: n_context_tokens_total, n_generated_tokens_total, n_requests
        const tokens = (item.input_tokens != null || item.output_tokens != null)
          ? (item.input_tokens || 0) + (item.output_tokens || 0)
          : (item.n_context_tokens_total || 0) + (item.n_generated_tokens_total || 0) || (item.n_tokens || 0)
        const requests = item.num_model_requests ?? item.n_requests ?? 1
        const model = item.model || item.snapshot_id || item.type || 'Sin especificar'
        
        // Calcular costo aproximado basado en el modelo y tokens
        // Esto es una estimación ya que OpenAI no siempre devuelve el costo directamente
        let cost = 0
        if (item.cost !== undefined) {
          cost = item.cost
        } else if (tokens > 0) {
          // Estimar costo basado en tokens y modelo
          const modelLower = model.toLowerCase()
          let costPer1K = 0.002 // Default
          if (modelLower.includes('gpt-4-turbo') || modelLower.includes('gpt-4o')) {
            costPer1K = 0.01
          } else if (modelLower.includes('gpt-4')) {
            costPer1K = 0.03
          } else if (modelLower.includes('gpt-3.5-turbo')) {
            costPer1K = 0.0005
          }
          cost = (tokens / 1000) * costPer1K
        }
        
        totalCost += cost
        totalTokens += tokens
        totalRequests += requests
        
        // Agregar como line_item
        dailyCostsMap[itemDate].line_items.push({
          name: model,
          cost: cost,
          tokens: tokens,
          requests: requests,
        })
      }
      
      console.log(`[OPENAI] Totales calculados:`, {
        totalCost,
        totalTokens,
        totalRequests,
        days: Object.keys(dailyCostsMap).length,
      })

      return {
        object: 'list',
        daily_costs: Object.values(dailyCostsMap),
        total_usage: totalTokens,
        total_cost: totalCost,
        total_requests: totalRequests,
      }
    }

    // Si no obtuvimos datos, retornar null
    if (datesWithoutData > 0 && datesWithData === 0) {
      console.warn(`[OPENAI] ⚠️ No se obtuvieron datos de la API para ${datesWithoutData} fechas consultadas. Esto puede significar:`)
      console.warn(`[OPENAI]   1. No hay datos para esas fechas en OpenAI`)
      console.warn(`[OPENAI]   2. Hay un delay en la actualización de los datos`)
      console.warn(`[OPENAI]   3. Los datos están en otro formato o endpoint`)
    }
    return null

    // Ya procesamos los datos arriba, no necesitamos este código
  } catch (error) {
    console.error('[OPENAI] Error al obtener uso de OpenAI:', error)
    return null
  }
}

/**
 * Obtiene estadísticas de uso de OpenAI desde nuestra base de datos
 * (ya que OpenAI no expone una API pública para obtener uso histórico)
 */
export async function getOpenAIUsageFromDB(
  customerId: string,
  startDate: Date,
  endDate: Date
): Promise<OpenAITokenUsage[]> {
  try {
    const { getMongoDb } = await import('./mongodb.js')
    const { ObjectId } = await import('mongodb')
    const db = await getMongoDb()

    const usage = await db
      .collection('tokenUsage')
      .find({
        customerId: new ObjectId(customerId),
        date: {
          $gte: startDate,
          $lte: endDate,
        },
      })
      .sort({ date: 1 })
      .toArray()

    // Agrupar por fecha
    const groupedByDate: Record<string, OpenAITokenUsage> = {}

    for (const record of usage) {
      const dateStr = record.date.toISOString().split('T')[0]
      
      if (!groupedByDate[dateStr]) {
        groupedByDate[dateStr] = {
          date: dateStr,
          tokens: 0,
          requests: 0,
          cost: 0,
          models: {},
        }
      }

      groupedByDate[dateStr].tokens += record.tokensUsed || 0
      groupedByDate[dateStr].requests += 1

      const model = record.model?.trim() || 'Sin especificar'
      if (!groupedByDate[dateStr].models[model]) {
        groupedByDate[dateStr].models[model] = {
          tokens: 0,
          requests: 0,
          cost: 0,
        }
      }

      groupedByDate[dateStr].models[model].tokens += record.tokensUsed || 0
      groupedByDate[dateStr].models[model].requests += 1

      // Calcular costo aproximado (esto debería venir de OpenAI o calcularse según el modelo)
      // Por ahora, usamos estimaciones aproximadas
      const costPer1KTokens = getCostPer1KTokens(model)
      groupedByDate[dateStr].models[model].cost += (record.tokensUsed || 0) / 1000 * costPer1KTokens
      groupedByDate[dateStr].cost += (record.tokensUsed || 0) / 1000 * costPer1KTokens
    }

    return Object.values(groupedByDate)
  } catch (error) {
    console.error('[OPENAI] Error al obtener uso desde BD:', error)
    return []
  }
}

/**
 * Obtiene estadísticas de uso de OpenAI desde la BD agregadas para TODAS las cuentas (admin).
 */
export async function getOpenAIUsageFromDBAll(
  startDate: Date,
  endDate: Date
): Promise<OpenAITokenUsage[]> {
  try {
    const { getMongoDb } = await import('./mongodb.js')
    const db = await getMongoDb()

    const usage = await db
      .collection('tokenUsage')
      .find({
        date: {
          $gte: startDate,
          $lte: endDate,
        },
      })
      .sort({ date: 1 })
      .toArray()

    const groupedByDate: Record<string, OpenAITokenUsage> = {}

    for (const record of usage) {
      const dateStr = record.date instanceof Date
        ? record.date.toISOString().split('T')[0]
        : new Date(record.date).toISOString().split('T')[0]

      if (!groupedByDate[dateStr]) {
        groupedByDate[dateStr] = {
          date: dateStr,
          tokens: 0,
          requests: 0,
          cost: 0,
          models: {},
        }
      }

      groupedByDate[dateStr].tokens += record.tokensUsed || 0
      groupedByDate[dateStr].requests += 1

      const model = record.model?.trim() || 'Sin especificar'
      if (!groupedByDate[dateStr].models[model]) {
        groupedByDate[dateStr].models[model] = {
          tokens: 0,
          requests: 0,
          cost: 0,
        }
      }

      groupedByDate[dateStr].models[model].tokens += record.tokensUsed || 0
      groupedByDate[dateStr].models[model].requests += 1

      const costPer1KTokens = getCostPer1KTokens(model)
      groupedByDate[dateStr].models[model].cost += (record.tokensUsed || 0) / 1000 * costPer1KTokens
      groupedByDate[dateStr].cost += (record.tokensUsed || 0) / 1000 * costPer1KTokens
    }

    return Object.values(groupedByDate)
  } catch (error) {
    console.error('[OPENAI] Error al obtener uso agregado desde BD:', error)
    return []
  }
}

/**
 * Obtiene el costo por 1K tokens según el modelo
 * Precios aproximados de OpenAI (actualizados a 2024)
 */
function getCostPer1KTokens(model: string): number {
  const modelLower = model.toLowerCase()
  
  // Precios de input tokens por 1K
  if (modelLower.includes('gpt-4-turbo') || modelLower.includes('gpt-4o')) {
    return 0.01 // $0.01 por 1K tokens input
  }
  if (modelLower.includes('gpt-4')) {
    return 0.03 // $0.03 por 1K tokens input
  }
  if (modelLower.includes('gpt-3.5-turbo')) {
    return 0.0005 // $0.0005 por 1K tokens input
  }
  
  // Default
  return 0.002 // Precio promedio
}
