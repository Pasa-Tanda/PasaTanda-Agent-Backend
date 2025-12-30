# Registro de Número de WhatsApp Business

## Problema Identificado

El token actual (`WHATSAPP_API_TOKEN`) es un **token de mensajería** que solo permite enviar/recibir mensajes. Para gestionar números de teléfono (listar, registrar, verificar), necesitas un **token de acceso de usuario del sistema** con el permiso `whatsapp_business_management`.

## Información de la Cuenta

- **WhatsApp Business Account ID**: `2392249954565713`
- **Phone Number ID actual**: `213510245181779777` (configurado en `.env`)
- **Token actual**: Token de Cloud API (solo mensajería)

## Pasos para Registrar un Número de Teléfono

### 1. Obtener Token con Permisos de Gestión

Debes generar un nuevo token desde Meta Business Suite:

1. Ve a https://business.facebook.com/settings/system-users
2. Selecciona o crea un usuario del sistema
3. Genera un token con estos permisos:
   - ✅ `whatsapp_business_management`
   - ✅ `whatsapp_business_messaging`
4. Guarda el token (diferente al que tienes en `WHATSAPP_API_TOKEN`)

### 2. Verificar Números Disponibles

Con el nuevo token, lista los números de tu cuenta:

```bash
curl -X GET \
  "https://graph.facebook.com/v24.0/2392249954565713/phone_numbers?access_token=TU_NUEVO_TOKEN" \
  | jq '.'
```

**Respuesta esperada:**
```json
{
  "data": [
    {
      "verified_name": "Nombre de tu negocio",
      "display_phone_number": "+1234567890",
      "id": "213510245181779777",
      "quality_rating": "GREEN"
    }
  ]
}
```

### 3. Verificar Estado del Número

```bash
curl -X GET \
  "https://graph.facebook.com/v24.0/213510245181779777?access_token=TU_NUEVO_TOKEN" \
  | jq '.'
```

**Respuesta esperada:**
```json
{
  "code_verification_status": "VERIFIED",
  "display_phone_number": "1234567890",
  "id": "213510245181779777",
  "quality_rating": "GREEN",
  "verified_name": "Nombre Verificado"
}
```

### 4. Solicitar Código de Verificación (Si no está verificado)

Si el `code_verification_status` NO es `VERIFIED`, solicita un código:

```bash
curl -X POST \
  "https://graph.facebook.com/v24.0/213510245181779777/request_code" \
  -H "Authorization: Bearer TU_NUEVO_TOKEN" \
  -F "code_method=SMS" \
  -F "language=es"
```

**Métodos disponibles:**
- `SMS`: Código por mensaje de texto
- `VOICE`: Código por llamada de voz

### 5. Verificar el Número con el Código

Después de recibir el código por SMS/llamada:

```bash
curl -X POST \
  "https://graph.facebook.com/v24.0/213510245181779777/verify_code" \
  -H "Authorization: Bearer TU_NUEVO_TOKEN" \
  -F "code=123456"
```

**Respuesta exitosa:**
```json
{
  "success": true
}
```

## Alternativa: Usar Meta Business Suite (UI)

Si prefieres hacerlo manualmente:

1. Ve a https://business.facebook.com/wa/manage/phone-numbers/
2. Selecciona tu cuenta de WhatsApp Business
3. Haz clic en "Agregar número de teléfono"
4. Sigue el asistente de verificación

## Verificar Nivel de Throughput

Para ver la capacidad de mensajes por segundo:

```bash
curl -X GET \
  "https://graph.facebook.com/v24.0/213510245181779777?fields=throughput&access_token=TU_NUEVO_TOKEN" \
  | jq '.'
```

**Respuesta:**
```json
{
  "id": "213510245181779777",
  "throughput": {
    "level": "STANDARD"
  }
}
```

**Niveles de throughput:**
- `STANDARD`: 80 mensajes/segundo (por defecto para cuentas nuevas)
- `HIGH`: 1000 mensajes/segundo (requiere verificación de negocio)

## Notas Importantes

⚠️ **Diferencia entre tokens:**
- **Token de Cloud API** (`WHATSAPP_API_TOKEN`): Solo para enviar/recibir mensajes
- **Token de Business Management**: Para gestionar números, plantillas, configuración

⚠️ **Requisitos del número:**
- Debe ser un número móvil (no VoIP)
- No puede estar registrado en otra cuenta de WhatsApp Business
- Debe poder recibir SMS o llamadas para verificación

⚠️ **API Limitations:**
- La API de Business Management **NO permite agregar o eliminar números**, solo listarlos y verificarlos
- Para agregar nuevos números, debes usar [Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup) o Meta Business Suite UI

## Script de Verificación

```bash
#!/bin/bash
# Archivo: scripts/verify-whatsapp-number.sh

# Configurar variables
WABA_ID="2392249954565713"
PHONE_NUMBER_ID="213510245181779777"
BUSINESS_TOKEN="TU_TOKEN_DE_BUSINESS_MANAGEMENT_AQUI"

echo "=== Verificando configuración de WhatsApp ==="

echo -e "\n1. Obteniendo números de la cuenta..."
curl -s -X GET \
  "https://graph.facebook.com/v24.0/${WABA_ID}/phone_numbers?access_token=${BUSINESS_TOKEN}" \
  | jq '.'

echo -e "\n2. Verificando estado del número..."
curl -s -X GET \
  "https://graph.facebook.com/v24.0/${PHONE_NUMBER_ID}?access_token=${BUSINESS_TOKEN}" \
  | jq '.'

echo -e "\n3. Verificando throughput..."
curl -s -X GET \
  "https://graph.facebook.com/v24.0/${PHONE_NUMBER_ID}?fields=throughput&access_token=${BUSINESS_TOKEN}" \
  | jq '.'

echo -e "\n=== Verificación completa ==="
```

## Recursos

- [Phone Numbers API Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers)
- [Business Management API](https://developers.facebook.com/docs/whatsapp/business-management-api/manage-phone-numbers)
- [WhatsApp Business Account](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/)
- [Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup)

## Script de Suscripcion

```bash
curl -X POST \
  "https://graph.facebook.com/v24.0/2392249954565713/subscribed_apps" \
  -H "Authorization: Bearer EAAMS3BBPkroBQMltJMInMplq9NRCxM3kDwtVQ2lzyFEoXkAcDJ46gqKDgHWuCK6ZBKLZAwZCzabmN9JrmZBF3RSzaFbtiYpqWish9JONCaoZAQxTR1uv5OZAivo3jj9oeTYr4qcXclTatXCZAS9BAWhuZCZAdBZBWlwvd7K8LQDTvNdkH9vDsaJviFDHVC6MtsIFfOLQZDZD" \
  -d '{                             
    "data": ["messages"]
  }'
```

