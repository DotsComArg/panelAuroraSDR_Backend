const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://hubsautos.dotscomagency.com/api/form-entries';

export interface FormEntry {
  _id: string;
  fecha: string;
  ano: number;
  modelo: string;
  marca: string;
  version: string;
  km: number;
  nombre: string;
  email: string;
  celular: string;
  telefono?: string;
  postal?: string;
  dni?: string;
  nombre_completo?: string;
  precio_sugerido?: number | null;
  precio_minimo?: number | null;
  precio_maximo?: number | null;
  rango_cotizacion?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DashboardStats {
  totalRegistros: number;
  registrosHoy: number;
  registrosEstaSemana: number;
  promedioKm: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data?: T[];
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

class ApiService {
  private async makeRequest<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
        },
        ...options,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json() as ApiResponse<T>;
      return result;
    } catch (error) {
      console.error('API Error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Error desconocido',
      };
    }
  }

  // Obtener estadísticas del dashboard
  async getDashboardStats(): Promise<ApiResponse<DashboardStats>> {
    return this.makeRequest<DashboardStats>('/stats');
  }

  // Obtener lista de registros con paginación
  async getFormEntries(page: number = 1, limit: number = 100): Promise<PaginatedResponse<FormEntry>> {
    return this.makeRequest<FormEntry[]>(`?page=${page}&limit=${limit}`);
  }

  // Obtener registros por rango de fechas con paginación
  async getFormEntriesByDateRange(startDate: string, endDate: string, page: number = 1, limit: number = 100): Promise<PaginatedResponse<FormEntry>> {
    return this.makeRequest<FormEntry[]>(`/by-date-range?startDate=${startDate}&endDate=${endDate}&page=${page}&limit=${limit}`);
  }

  // Obtener registros por marca con paginación
  async getFormEntriesByBrand(brand: string, page: number = 1, limit: number = 100): Promise<PaginatedResponse<FormEntry>> {
    return this.makeRequest<FormEntry[]>(`/by-brand/${encodeURIComponent(brand)}?page=${page}&limit=${limit}`);
  }

  // Obtener entrada específica por ID
  async getFormEntryById(id: string): Promise<ApiResponse<FormEntry>> {
    return this.makeRequest<FormEntry>(`/${id}`);
  }

  // Obtener todos los registros haciendo múltiples peticiones paginadas
  async getAllFormEntriesForExport(): Promise<ApiResponse<FormEntry[]>> {
    try {
      let allEntries: FormEntry[] = [];
      let currentPage = 1;
      let hasMorePages = true;
      const limit = 100; // Límite por página

      while (hasMorePages) {
        const response = await this.makeRequest<FormEntry[]>(`?page=${currentPage}&limit=${limit}`);
        
        if (!response.success || !response.data) {
          return {
            success: false,
            message: response.message || 'Error al obtener registros',
          };
        }

        // Agregar los registros obtenidos
        allEntries = [...allEntries, ...response.data];

        // Verificar si hay más páginas
        const paginatedResponse = response as unknown as PaginatedResponse<FormEntry>;
        if (paginatedResponse.pagination) {
          hasMorePages = paginatedResponse.pagination.hasNext;
          currentPage++;
        } else {
          // Si no hay información de paginación, asumir que no hay más páginas
          hasMorePages = false;
        }
      }

      return {
        success: true,
        data: allEntries,
      };
    } catch (error) {
      console.error('Error al obtener todos los registros:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Error desconocido',
      };
    }
  }
}

export const apiService = new ApiService();

