# Kommo API – ejemplos para Postman / cURL

Base URL en producción: `https://panel-aurora-sdr-backend.vercel.app`  
Base URL en local: `http://localhost:3001`

En Postman, si el backend exige autenticación, agrega estos headers (los mismos que usa el frontend):

- `x-user-id`: ID del usuario (ej. ObjectId de MongoDB)
- `x-customer-id`: **ID del cliente** cuya cuenta Kommo quieres consultar (obligatorio en la URL también)
- `x-user-email`: email del usuario

Reemplaza `CUSTOMER_ID` por el `_id` del cliente en MongoDB (ej. `674abc123def456789012345`).  
`accountIndex`: `0` = primera cuenta Kommo del cliente, `1` = segunda, etc.

---

## 1. Estadísticas de Kommo (totales, ganados/perdidos/activos, embudos)

**GET** estadísticas (desde BD si hay datos; si no, devuelve vacío con `needsSync: true`).

```bash
curl -X GET "https://panel-aurora-sdr-backend.vercel.app/api/metrics/kommo?customerId=CUSTOMER_ID&accountIndex=0" \
  -H "Content-Type: application/json" \
  -H "x-customer-id: CUSTOMER_ID" \
  -H "x-user-id: TU_USER_ID" \
  -H "x-user-email: tu@email.com"
```

Con **refresh** (consulta directa a la API de Kommo, sin usar BD):

```bash
curl -X GET "https://panel-aurora-sdr-backend.vercel.app/api/metrics/kommo?customerId=CUSTOMER_ID&accountIndex=0&refresh=true" \
  -H "Content-Type: application/json" \
  -H "x-customer-id: CUSTOMER_ID" \
  -H "x-user-id: TU_USER_ID" \
  -H "x-user-email: tu@email.com"
```

**Respuesta típica (200):**

```json
{
  "success": true,
  "data": {
    "totals": { "total": 150, "won": 80, "lost": 40, "active": 30 },
    "distribution": [
      {
        "pipelineId": 123,
        "pipelineName": "Ventas",
        "stages": [
          { "statusId": 1, "statusName": "Nuevo", "count": 10, "type": "open" },
          { "statusId": 2, "statusName": "Cierre exitoso", "count": 80, "type": "won" }
        ],
        "total": 90
      }
    ],
    "lastUpdated": "2026-02-24T20:00:00.000Z"
  }
}
```

---

## 2. Leads de Kommo (cómo vienen los leads)

**GET** leads desde la **base de datos** (rápido; usa datos ya sincronizados):

```bash
curl -X GET "https://panel-aurora-sdr-backend.vercel.app/api/metrics/kommo/leads?customerId=CUSTOMER_ID&accountIndex=0&page=1&limit=50" \
  -H "Content-Type: application/json" \
  -H "x-customer-id: CUSTOMER_ID" \
  -H "x-user-id: TU_USER_ID" \
  -H "x-user-email: tu@email.com"
```

**GET** leads desde la **API de Kommo** (refresh) y opcionalmente sincronizar a BD:

```bash
curl -X GET "https://panel-aurora-sdr-backend.vercel.app/api/metrics/kommo/leads?customerId=CUSTOMER_ID&accountIndex=0&refresh=true&page=1&limit=50" \
  -H "Content-Type: application/json" \
  -H "x-customer-id: CUSTOMER_ID" \
  -H "x-user-id: TU_USER_ID" \
  -H "x-user-email: tu@email.com"
```

**Respuesta típica (200):**

```json
{
  "success": true,
  "leads": [
    {
      "id": 12345,
      "name": "Lead Ejemplo",
      "price": 0,
      "responsible_user_id": 1,
      "status_id": 2,
      "pipeline_id": 123,
      "date_create": 1708790400,
      "date_close": null,
      "created_at": 1708790400,
      "updated_at": 1708876800,
      "closed_at": null,
      "_embedded": {
        "tags": [{ "id": 1, "name": "Web" }]
      },
      "custom_fields_values": [
        {
          "field_id": 1,
          "field_name": "Fuente",
          "field_code": "fuente",
          "values": [{ "value": "Landing" }]
        }
      ]
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 50,
  "totalPages": 3
}
```

Cada lead incluye: `id`, `name`, `price`, `status_id`, `pipeline_id`, `date_create`, `date_close`, `_embedded.tags` y `custom_fields_values` (Fuente, UTM, etc.).

---

## 3. Muestra de un lead completo (para ver estructura)

**GET** un solo lead con todos los detalles (útil para ver campos personalizados y embeds):

```bash
curl -X GET "https://panel-aurora-sdr-backend.vercel.app/api/metrics/kommo/leads/sample?customerId=CUSTOMER_ID&accountIndex=0" \
  -H "Content-Type: application/json" \
  -H "x-customer-id: CUSTOMER_ID" \
  -H "x-user-id: TU_USER_ID" \
  -H "x-user-email: tu@email.com"
```

---

## 4. Usuarios, embudos (pipelines) y etiquetas de Kommo

```bash
# Usuarios de la cuenta Kommo
curl -X GET "https://panel-aurora-sdr-backend.vercel.app/api/metrics/kommo/users?customerId=CUSTOMER_ID&accountIndex=0" \
  -H "x-customer-id: CUSTOMER_ID" \
  -H "x-user-id: TU_USER_ID" \
  -H "x-user-email: tu@email.com"

# Embudos (pipelines)
curl -X GET "https://panel-aurora-sdr-backend.vercel.app/api/metrics/kommo/pipelines?customerId=CUSTOMER_ID&accountIndex=0" \
  -H "x-customer-id: CUSTOMER_ID" \
  -H "x-user-id: TU_USER_ID" \
  -H "x-user-email: tu@email.com"

# Etiquetas (tags)
curl -X GET "https://panel-aurora-sdr-backend.vercel.app/api/metrics/kommo/tags?customerId=CUSTOMER_ID&accountIndex=0" \
  -H "x-customer-id: CUSTOMER_ID" \
  -H "x-user-id: TU_USER_ID" \
  -H "x-user-email: tu@email.com"
```

---

## Cómo obtener un CUSTOMER_ID

- Desde **Admin → Gestión de Clientes**: el ID está en la URL al editar un cliente: `/admin/clients/674abc123def456789012345`.
- O desde la API de clientes (solo admin):  
  `GET /api/customers` y usar el campo `_id` del cliente que tenga credenciales de Kommo configuradas.
