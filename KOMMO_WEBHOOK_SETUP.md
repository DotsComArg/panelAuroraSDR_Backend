# Configuración de Webhook de Kommo

Este documento explica cómo configurar el webhook de Kommo para recibir actualizaciones automáticas de leads.

## Endpoint del Webhook

El endpoint del webhook está disponible en:
```
POST /api/metrics/kommo/webhook
```

URL completa (ejemplo):
- Producción: `https://panel.aurorasdr.ai/api/metrics/kommo/webhook`
- Desarrollo: `http://localhost:3001/api/metrics/kommo/webhook`

## Configuración en Kommo

1. **Accede a la configuración de webhooks en Kommo:**
   - Ve a Configuración → Integraciones → Webhooks
   - O accede directamente a: `https://tu-cuenta.kommo.com/settings/integrations/webhooks`

2. **Crea un nuevo webhook:**
   - Haz clic en "Agregar webhook" o "Crear webhook"
   - Ingresa la URL del endpoint: `https://panel.aurorasdr.ai/api/metrics/kommo/webhook`
   - Selecciona los eventos que quieres recibir:
     - ✅ `leads.add` - Cuando se crea un nuevo lead
     - ✅ `leads.update` - Cuando se actualiza un lead
     - ✅ `leads.delete` - Cuando se elimina un lead
     - ✅ `leads.status` - Cuando cambia el estado de un lead
     - ✅ `leads.responsible` - Cuando cambia el responsable de un lead

3. **Guarda la configuración:**
   - Haz clic en "Guardar" o "Crear"
   - Kommo enviará un webhook de prueba para verificar que la URL funciona

## Funcionamiento

Cuando Kommo detecta cambios en los leads, enviará un webhook a nuestro endpoint con la siguiente estructura:

```json
{
  "account": {
    "id": 123456
  },
  "leads": {
    "add": [...],
    "update": [...],
    "delete": [...]
  }
}
```

El sistema:
1. Recibe el webhook
2. Identifica el cliente y la **cuenta Kommo** por `account.id` (subdominio de la URL de Kommo: ej. `12345` de `https://12345.kommo.com`). Soporta múltiples cuentas por cliente (Kommo 1, Kommo 2, etc.).
3. Obtiene los leads completos desde la API de Kommo (con todos sus campos)
4. Actualiza la base de datos en la cuenta correcta (`kommoAccountIndex`)
5. Responde con 200 OK a Kommo

**Varias cuentas:** Si un cliente tiene Kommo 1 y Kommo 2, cada una debe tener su webhook en Kommo apuntando a la **misma URL**. El panel identifica qué cuenta es por el `account.id` que envía Kommo (cada cuenta tiene un subdominio distinto).

## Verificación

Para verificar que el webhook está funcionando:

1. **Revisa los logs en Admin:** Ve a **Admin → Logs de Webhooks Kommo**. Ahí verás cada webhook recibido, la cuenta (Kommo 1 / Kommo 2), leads procesados y posibles errores.
2. **Revisa los logs del servidor:**
   - Busca mensajes que comiencen con `[KOMMO WEBHOOK]`
   - Deberías ver mensajes como:
     - `[KOMMO WEBHOOK] Recibida petición de webhook`
     - `[KOMMO WEBHOOK] Procesando webhook para customerId: ...`
     - `[KOMMO WEBHOOK] ✅ X leads sincronizados exitosamente`

2. **Prueba manualmente:**
   - Crea o actualiza un lead en Kommo
   - Verifica que el lead se actualice en el panel de métricas

3. **Verifica en la base de datos:**
   - Los leads deberían tener el campo `syncedAt` actualizado
   - Los leads nuevos deberían aparecer en la colección `kommo_leads`

## Troubleshooting

### El webhook no se recibe

1. Verifica que la URL sea accesible públicamente (no funciona con localhost)
2. Verifica que el endpoint esté correctamente configurado en Kommo
3. Revisa los logs del servidor para ver si hay errores

### El webhook se recibe pero no actualiza los leads

1. Verifica que el `account.id` del webhook coincida con la URL base del cliente
2. Revisa los logs para ver si hay errores al obtener credenciales
3. Verifica que las credenciales de Kommo estén correctamente configuradas

### Errores 401 o 403

1. Verifica que el access token de Kommo sea válido
2. Verifica que las credenciales estén correctamente encriptadas en la base de datos

## Notas Importantes

- El webhook procesa los eventos de forma asíncrona para responder rápidamente a Kommo
- Los leads se actualizan en la base de datos con todos sus campos (etiquetas, fechas, estados, etc.)
- Si un lead se elimina en Kommo, se marca como `is_deleted: true` en la base de datos
- El webhook es idempotente: puede recibirse múltiples veces sin causar problemas
