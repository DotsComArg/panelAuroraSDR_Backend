import * as XLSX from 'xlsx';
import { FormEntry } from './api-hubsautos.js';

/**
 * Formatea una fecha a formato legible
 */
const formatDate = (dateString: string): string => {
  const fecha = new Date(dateString);
  // Ajustar a la zona horaria argentina (UTC-3)
  const fechaArgentina = new Date(fecha.getTime() + (3 * 60 * 60 * 1000));
  return fechaArgentina.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

/**
 * Convierte los datos de FormEntry a un formato adecuado para Excel
 */
const prepareDataForExcel = (entries: FormEntry[]) => {
  return entries.map((entry) => ({
    'Fecha': formatDate(entry.fecha),
    'Año': entry.ano,
    'Modelo': entry.modelo,
    'Marca': entry.marca,
    'Versión': entry.version,
    'Kilómetros': entry.km,
    'Nombre': entry.nombre,
    'Email': entry.email,
    'Celular': entry.celular,
    'Teléfono': entry.telefono || '',
    'Código Postal': entry.postal || '',
    'DNI': entry.dni || '',
    'Nombre Completo': entry.nombre_completo || '',
    'Precio Sugerido': entry.precio_sugerido || '',
    'Precio Mínimo': entry.precio_minimo || '',
    'Precio Máximo': entry.precio_maximo || '',
    'Rango Cotización': entry.rango_cotizacion || '',
  }));
};

/**
 * Exporta los registros a un archivo Excel
 */
export const exportToExcel = (entries: FormEntry[], filename: string = 'registros-vehiculos') => {
  try {
    // Preparar los datos
    const data = prepareDataForExcel(entries);

    // Crear un nuevo libro de trabajo
    const workbook = XLSX.utils.book_new();

    // Convertir los datos a una hoja de trabajo
    const worksheet = XLSX.utils.json_to_sheet(data);

    // Ajustar el ancho de las columnas
    const columnWidths = [
      { wch: 12 }, // Fecha
      { wch: 8 },  // Año
      { wch: 20 }, // Modelo
      { wch: 15 }, // Marca
      { wch: 25 }, // Versión
      { wch: 12 }, // Kilómetros
      { wch: 20 }, // Nombre
      { wch: 30 }, // Email
      { wch: 15 }, // Celular
      { wch: 15 }, // Teléfono
      { wch: 12 }, // Código Postal
      { wch: 12 }, // DNI
      { wch: 25 }, // Nombre Completo
      { wch: 15 }, // Precio Sugerido
      { wch: 15 }, // Precio Mínimo
      { wch: 15 }, // Precio Máximo
      { wch: 20 }, // Rango Cotización
    ];
    worksheet['!cols'] = columnWidths;

    // Agregar la hoja al libro
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Registros');

    // Generar el archivo y descargarlo
    const timestamp = new Date().toISOString().split('T')[0];
    const fullFilename = `${filename}_${timestamp}.xlsx`;
    XLSX.writeFile(workbook, fullFilename);

    return { success: true, filename: fullFilename };
  } catch (error) {
    console.error('Error al exportar a Excel:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Error desconocido' 
    };
  }
};

