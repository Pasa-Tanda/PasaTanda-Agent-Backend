# Resumen de Cambios - Integración Catálogo Meta

## Cambios Realizados

### 1. Renombrado de Variables

- ✅ `WHATSAPP_API_TOKEN` → `META_API_TOKEN` en todo el proyecto
- ✅ Actualizado `.env`
- ✅ Actualizado `whatsapp.service.ts`
- ✅ Actualizado documentación

### 2. Nuevos Archivos Creados

#### DTOs

- `src/whatsapp/dto/meta-catalog.dto.ts` - Tipos para integración con Meta Catalog API

#### Servicios

- `src/whatsapp/services/meta-catalog.service.ts` - Servicio principal de sincronización con Meta

#### Controladores

- `src/whatsapp/catalog-test.controller.ts` - Controlador de pruebas (eliminar en producción)

#### Documentación

- `.github/docs/META_CATALOG_INTEGRATION.md` - Guía completa de integración

### 3. Modificaciones en Archivos Existentes

#### `src/whatsapp/whatsapp.module.ts`

- ✅ Agregado `MetaCatalogService` a providers
- ✅ Agregado `CatalogTestController` a controllers

#### `src/whatsapp/whatsapp.types.ts`

- ✅ Agregado enum `SalesToolType`
- ✅ Agregado interface `SalesToolResult`

#### `src/whatsapp/agents/sales-agent.service.ts`

- ✅ Inyectado `MetaCatalogService`
- ✅ Agregado método `executeCatalogTool()`
- ✅ Agregado método `detectAndExecuteTool()`
- ✅ Agregado 6 métodos privados de herramientas:
  - `toolSyncInventoryToMeta()`
  - `toolSyncInventoryFromMeta()`
  - `toolSearchProducts()`
  - `toolGetProductInfo()`
  - `toolUpdateProductAvailability()`
  - `toolListAllProducts()`
- ✅ Modificado `handleShoppingIntent()` para detectar uso de herramientas

#### `README.md`

- ✅ Actualizado con nueva configuración META_API_TOKEN

## Configuración Requerida

### 1. Variables de Entorno (.env)

```bash
META_API_TOKEN='tu_token_aqui'
WHATSAPP_API_VERSION='v24.0'
```

### 2. Base de Datos (Supabase)

Ejecutar en Supabase SQL Editor:

```sql
-- Agregar columna business_catalog_id a companies
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS business_catalog_id TEXT;

-- Actualizar con el ID del catálogo de Meta
UPDATE companies
SET business_catalog_id = '2902117086655075'
WHERE id = 'tu-company-id';

-- Verificar tabla products existe
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2),
  image_url TEXT,
  stock_quantity INTEGER DEFAULT 0,
  is_available BOOLEAN DEFAULT true,
  brand TEXT,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Cómo Usar

### Opción 1: A través del Chat (Automático)

El usuario simplemente escribe en lenguaje natural:

```
Usuario: "Actualiza el catálogo con Meta"
Bot: ✅ Sincronización completada: 15 productos actualizados

Usuario: "Busca productos de zapatos"
Bot: Encontré 5 productos relacionados...

Usuario: "El producto ABC123 ya no está disponible"
Bot: ✅ Producto marcado como no disponible
```

### Opción 2: Endpoints de Prueba (Desarrollo)

```bash
# Sincronizar hacia Meta
curl -X POST http://localhost:3000/catalog-test/sync-to-meta \
  -H "Content-Type: application/json" \
  -d '{"companyId": "00000000-0000-0000-0000-000000000000"}'

# Sincronizar desde Meta
curl -X POST http://localhost:3000/catalog-test/sync-from-meta \
  -H "Content-Type: application/json" \
  -d '{"companyId": "00000000-0000-0000-0000-000000000000"}'

# Listar productos
curl http://localhost:3000/catalog-test/products/00000000-0000-0000-0000-000000000000

# Buscar productos
curl "http://localhost:3000/catalog-test/search/00000000-0000-0000-0000-000000000000?q=camisa"

# Actualizar disponibilidad
curl -X POST http://localhost:3000/catalog-test/availability \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "00000000-0000-0000-0000-000000000000",
    "productId": "PROD123",
    "available": false
  }'
```

### Opción 3: Programático

```typescript
// En cualquier servicio
constructor(
  private readonly metaCatalog: MetaCatalogService,
) {}

async syncProducts() {
  const result = await this.metaCatalog.syncInventoryToMeta(companyId);
  console.log(`Sincronizados: ${result.synced}, Errores: ${result.errors}`);
}
```

## Herramientas Disponibles para el LLM

El Sales Agent puede usar estas herramientas automáticamente:

| Tool                          | Descripción                | Parámetros                                |
| ----------------------------- | -------------------------- | ----------------------------------------- |
| `sync_inventory_to_meta`      | Sincroniza Supabase → Meta | ninguno                                   |
| `sync_inventory_from_meta`    | Sincroniza Meta → Supabase | ninguno                                   |
| `search_products`             | Busca productos            | `searchTerm: string`                      |
| `get_product_info`            | Info de producto           | `productId: string`                       |
| `update_product_availability` | Actualiza disponibilidad   | `productId: string`, `available: boolean` |
| `list_all_products`           | Lista todos los productos  | ninguno                                   |

## Flujo de Funcionamiento

```
1. Usuario envía mensaje al bot
   ↓
2. Sales Agent detecta si es intención de inventario
   ↓
3. Gemini analiza y decide qué herramienta usar
   ↓
4. Se ejecuta la herramienta correspondiente
   ↓
5. Se genera respuesta natural con el resultado
   ↓
6. Bot responde al usuario
```

## API de Meta Utilizada

### Endpoints

1. **Listar Productos**

   ```
   GET /v24.0/{catalog_id}/products
   ```

2. **Batch Update**
   ```
   POST /v24.0/{catalog_id}/items_batch
   ```

### Formato de Producto

```json
{
  "id": "PROD123",
  "title": "Producto Ejemplo",
  "description": "Descripción del producto",
  "price": "100.00 MXN",
  "availability": "in stock",
  "condition": "new",
  "image_link": "https://...",
  "inventory": 50
}
```

## Testing

### 1. Verificar Configuración

```bash
curl http://localhost:3000/catalog-test/catalog-id/tu-company-id
```

### 2. Probar Sincronización

```bash
# 1. Agregar productos en Supabase
# 2. Ejecutar sync-to-meta
# 3. Verificar en Meta Business Manager
```

### 3. Probar con el Bot

```
Envía un mensaje de WhatsApp:
"Actualiza el catálogo"
```

## Errores Comunes

### Error: Catalog ID no encontrado

**Solución:** Configura `business_catalog_id` en la tabla `companies`

### Error: Invalid OAuth 2.0 Access Token

**Solución:** Verifica que `META_API_TOKEN` sea válido

### Error: Too many calls

**Solución:** Meta tiene rate limits, espera unos minutos

## Próximos Pasos Recomendados

1. ⚠️ **Eliminar o proteger** `CatalogTestController` en producción
2. ✅ Implementar webhooks de Meta para sync automática
3. ✅ Agregar cache para reducir llamadas API
4. ✅ Implementar cron jobs para sincronización programada
5. ✅ Agregar métricas y monitoreo

## Documentación Adicional

- [Guía completa](./.github/docs/META_CATALOG_INTEGRATION.md)
- [Meta Catalog API](https://developers.facebook.com/docs/marketing-api/reference/product-catalog/)
- [Meta Batch API](https://developers.facebook.com/docs/marketing-api/catalog/guides/manage-catalog-items/catalog-batch-api)

## Soporte

Para reportar problemas o sugerencias:

1. Revisa los logs del servidor
2. Verifica la configuración en `.env`
3. Consulta la documentación de Meta
4. Revisa los errores en Supabase

---

**Fecha de implementación:** 11 de diciembre de 2025
**Versión:** 1.0.0
