# Meta Conversions API (CAPI) + Kommo

Integración entre Meta Conversions API y Kommo para sincronizar eventos de conversión (Lead, Purchase) y mejorar la atribución de anuncios.

## Dónde se configura

- **Gestión de clientes** (admin): En **Editar Cliente** → pestaña **Meta CAPI**. Ahí se configuran Pixel ID, Access Token y opcionalmente Ad Account ID por cliente.
- **Admin → Meta CAPI + Kommo**: Configuración de la **empresa** (nuestras muestras) y listado de clientes con Meta CAPI.

## Alcance con Kommo

- **Kommo → Meta**: Envío de eventos CAPI cuando se crean/actualizan leads en Kommo (p. ej. desde Click to Message de Meta/Instagram/WhatsApp).
- **Eventos**: Lead (nuevo lead) y Purchase (conversión/cierre).
- **Meta CAPI**: Requiere Pixel ID y Access Token (Events Manager → Pixel → Configuración → Conversions API → Generate access token).

## Límites de conexión (Kommo API)

| Límite | Valor |
|--------|--------|
| Peticiones por segundo | **7** |
| Entidades por petición | **250** (recomendado ≤ 50 para evitar 504) |
| Sources por integración | **100** |

Si se superan los límites, Kommo devuelve **HTTP 429**; reincidencias pueden causar bloqueo temporal (**HTTP 403**).

## APIs

- `GET/PUT /api/admin/company-settings/meta-capi`: Configuración de la empresa.
- Credenciales por cliente: `metaCapiCredentials` en customer (Pixel ID, Access Token encriptado, Ad Account ID opcional). Ver `customers-credentials` (masked, GET, PUT).
