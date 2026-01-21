import * as XLSX from 'xlsx';

// Tipos basados en los datos de Kommo
interface KommoLead {
  id: number
  name: string
  price: number
  responsible_user_id: number
  status_id: number
  pipeline_id: number
  date_create: number
  date_close: number | null
  created_at: number
  updated_at: number
  closed_at: number | null
}

interface KommoUser {
  id: number
  name: string
  email: string
}

interface KommoPipeline {
  id: number
  name: string
}

interface KommoStats {
  totals: {
    total: number
    won: number
    lost: number
    active: number
  }
  distribution: Array<{
    pipelineId: number
    pipelineName: string
    stages: Array<{
      statusId: number
      statusName: string
      count: number
      type: 'open' | 'won' | 'lost'
    }>
    total: number
  }>
  lastUpdated: string
}

/**
 * Formatea una fecha timestamp a formato legible
 */
const formatDate = (timestamp: number | null): string => {
  if (!timestamp) return '-'
  const fecha = new Date(timestamp * 1000)
  return fecha.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Formatea un precio a formato monetario
 */
const formatPrice = (price: number | null | undefined): string => {
  if (price === null || price === undefined) return '-'
  return `$${price.toLocaleString('es-AR')}`
}

/**
 * Prepara los datos de leads para Excel con información enriquecida
 */
const prepareLeadsForExcel = (
  leads: KommoLead[],
  users: KommoUser[],
  pipelines: KommoPipeline[]
): any[] => {
  const userMap = new Map(users.map(u => [u.id, u]))
  const pipelineMap = new Map(pipelines.map(p => [p.id, p]))

  return leads.map((lead) => {
    const user = userMap.get(lead.responsible_user_id)
    const pipeline = pipelineMap.get(lead.pipeline_id)

    return {
      'ID': lead.id,
      'Nombre': lead.name || 'Sin nombre',
      'Valor': formatPrice(lead.price),
      'Usuario Responsable': user?.name || `Usuario ${lead.responsible_user_id}`,
      'Email Responsable': user?.email || '-',
      'Pipeline': pipeline?.name || `Pipeline ${lead.pipeline_id}`,
      'Status ID': lead.status_id,
      'Fecha Creación': formatDate(lead.created_at),
      'Fecha Actualización': formatDate(lead.updated_at),
      'Fecha Cierre': formatDate(lead.closed_at),
      'Estado': lead.closed_at ? 'Cerrado' : 'Abierto',
    }
  })
}

/**
 * Prepara las estadísticas resumidas para Excel
 */
const prepareStatsForExcel = (stats: KommoStats): any[] => {
  const winRate = stats.totals.total > 0
    ? ((stats.totals.won / stats.totals.total) * 100).toFixed(2)
    : '0.00'
  
  const lossRate = stats.totals.total > 0
    ? ((stats.totals.lost / stats.totals.total) * 100).toFixed(2)
    : '0.00'

  return [
    {
      'Métrica': 'Total de Leads',
      'Valor': stats.totals.total,
      'Descripción': 'Todos los leads en el sistema'
    },
    {
      'Métrica': 'Leads Ganados',
      'Valor': stats.totals.won,
      'Descripción': 'Leads en estado ganado'
    },
    {
      'Métrica': 'Leads Perdidos',
      'Valor': stats.totals.lost,
      'Descripción': 'Leads en estado perdido'
    },
    {
      'Métrica': 'Leads Activos',
      'Valor': stats.totals.active,
      'Descripción': 'Leads en proceso de venta'
    },
    {
      'Métrica': 'Tasa de Conversión (%)',
      'Valor': `${winRate}%`,
      'Descripción': 'Porcentaje de leads ganados'
    },
    {
      'Métrica': 'Tasa de Pérdida (%)',
      'Valor': `${lossRate}%`,
      'Descripción': 'Porcentaje de leads perdidos'
    },
    {
      'Métrica': 'Última Actualización',
      'Valor': new Date(stats.lastUpdated).toLocaleString('es-AR'),
      'Descripción': 'Fecha y hora de la última actualización'
    }
  ]
}

/**
 * Prepara la distribución por pipeline para Excel
 */
const prepareDistributionForExcel = (stats: KommoStats): any[] => {
  const result: any[] = []

  stats.distribution.forEach((pipeline) => {
    const won = pipeline.stages
      .filter((s) => s.type === 'won')
      .reduce((sum, s) => sum + s.count, 0)
    const lost = pipeline.stages
      .filter((s) => s.type === 'lost')
      .reduce((sum, s) => sum + s.count, 0)
    const active = pipeline.stages
      .filter((s) => s.type === 'open')
      .reduce((sum, s) => sum + s.count, 0)
    
    const successRate = pipeline.total > 0
      ? ((won / pipeline.total) * 100).toFixed(2)
      : '0.00'

    // Agregar resumen del pipeline
    result.push({
      'Pipeline': pipeline.pipelineName,
      'Etapa': 'RESUMEN',
      'Total Leads': pipeline.total,
      'Ganados': won,
      'Perdidos': lost,
      'Activos': active,
      'Tasa Éxito (%)': `${successRate}%`,
      'Tipo': 'Resumen'
    })

    // Agregar cada etapa del pipeline
    pipeline.stages.forEach((stage) => {
      const percentage = pipeline.total > 0
        ? ((stage.count / pipeline.total) * 100).toFixed(2)
        : '0.00'

      result.push({
        'Pipeline': pipeline.pipelineName,
        'Etapa': stage.statusName,
        'Total Leads': stage.count,
        'Ganados': stage.type === 'won' ? stage.count : 0,
        'Perdidos': stage.type === 'lost' ? stage.count : 0,
        'Activos': stage.type === 'open' ? stage.count : 0,
        'Tasa Éxito (%)': percentage,
        'Tipo': stage.type === 'won' ? 'Ganado' : stage.type === 'lost' ? 'Perdido' : 'Abierto'
      })
    })

    // Agregar una fila vacía entre pipelines
    result.push({})
  })

  return result
}

/**
 * Exporta los datos de Kommo a un archivo Excel con múltiples hojas
 */
export const exportKommoToExcel = (
  leads: KommoLead[],
  stats: KommoStats,
  users: KommoUser[],
  pipelines: KommoPipeline[],
  filename: string = 'reporte-kommo'
): { success: boolean; filename?: string; error?: string } => {
  try {
    // Crear un nuevo libro de trabajo
    const workbook = XLSX.utils.book_new()

    // Hoja 1: Leads Detallados
    const leadsData = prepareLeadsForExcel(leads, users, pipelines)
    const leadsWorksheet = XLSX.utils.json_to_sheet(leadsData)
    
    // Ajustar ancho de columnas para leads
    const leadsColumnWidths = [
      { wch: 10 }, // ID
      { wch: 30 }, // Nombre
      { wch: 15 }, // Valor
      { wch: 25 }, // Usuario Responsable
      { wch: 30 }, // Email Responsable
      { wch: 25 }, // Pipeline
      { wch: 12 }, // Status ID
      { wch: 20 }, // Fecha Creación
      { wch: 20 }, // Fecha Actualización
      { wch: 20 }, // Fecha Cierre
      { wch: 12 }, // Estado
    ]
    leadsWorksheet['!cols'] = leadsColumnWidths
    
    XLSX.utils.book_append_sheet(workbook, leadsWorksheet, 'Leads Detallados')

    // Hoja 2: Estadísticas Resumidas
    const statsData = prepareStatsForExcel(stats)
    const statsWorksheet = XLSX.utils.json_to_sheet(statsData)
    
    // Ajustar ancho de columnas para estadísticas
    const statsColumnWidths = [
      { wch: 25 }, // Métrica
      { wch: 20 }, // Valor
      { wch: 40 }, // Descripción
    ]
    statsWorksheet['!cols'] = statsColumnWidths
    
    XLSX.utils.book_append_sheet(workbook, statsWorksheet, 'Estadísticas')

    // Hoja 3: Distribución por Pipeline
    const distributionData = prepareDistributionForExcel(stats)
    const distributionWorksheet = XLSX.utils.json_to_sheet(distributionData)
    
    // Ajustar ancho de columnas para distribución
    const distributionColumnWidths = [
      { wch: 25 }, // Pipeline
      { wch: 30 }, // Etapa
      { wch: 12 }, // Total Leads
      { wch: 12 }, // Ganados
      { wch: 12 }, // Perdidos
      { wch: 12 }, // Activos
      { wch: 15 }, // Tasa Éxito (%)
      { wch: 12 }, // Tipo
    ]
    distributionWorksheet['!cols'] = distributionColumnWidths
    
    XLSX.utils.book_append_sheet(workbook, distributionWorksheet, 'Distribución por Pipeline')

    // Generar el archivo y descargarlo
    const timestamp = new Date().toISOString().split('T')[0]
    const fullFilename = `${filename}_${timestamp}.xlsx`
    XLSX.writeFile(workbook, fullFilename)

    return { success: true, filename: fullFilename }
  } catch (error) {
    console.error('Error al exportar datos de Kommo a Excel:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido'
    }
  }
}




