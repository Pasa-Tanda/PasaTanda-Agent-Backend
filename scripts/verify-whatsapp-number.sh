#!/bin/bash
# Script para verificar configuración de números de WhatsApp Business
# Uso: ./scripts/verify-whatsapp-number.sh

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Cargar variables de entorno
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Configuración
WABA_ID="2392249954565713"
PHONE_NUMBER_ID="${WHATSAPP_PHONE_NUMBER_ID:-213510245181779777}"
API_VERSION="${WHATSAPP_API_VERSION:-v24.0}"

echo -e "${YELLOW}=== Verificación de Configuración de WhatsApp ===${NC}\n"

# Verificar que jq esté instalado
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq no está instalado. Instálalo con: sudo dnf install jq${NC}"
    exit 1
fi

echo -e "${GREEN}Configuración:${NC}"
echo "  - WABA ID: ${WABA_ID}"
echo "  - Phone Number ID: ${PHONE_NUMBER_ID}"
echo "  - API Version: ${API_VERSION}"
echo ""

# Pedir token de Business Management si no está configurado
if [ -z "$WHATSAPP_BUSINESS_TOKEN" ]; then
    echo -e "${YELLOW}Nota: Se necesita un token de Business Management (no el token de Cloud API)${NC}"
    echo -e "${YELLOW}Obtén uno en: https://business.facebook.com/settings/system-users${NC}"
    echo -e "${YELLOW}Permisos requeridos: whatsapp_business_management, whatsapp_business_messaging${NC}\n"
    read -p "Ingresa el token de Business Management (o presiona Enter para usar WHATSAPP_API_TOKEN): " INPUT_TOKEN
    
    if [ -z "$INPUT_TOKEN" ]; then
        BUSINESS_TOKEN="${WHATSAPP_API_TOKEN}"
        echo -e "${YELLOW}⚠️  Usando WHATSAPP_API_TOKEN - puede no tener permisos suficientes${NC}\n"
    else
        BUSINESS_TOKEN="${INPUT_TOKEN}"
    fi
else
    BUSINESS_TOKEN="${WHATSAPP_BUSINESS_TOKEN}"
fi

# Función para hacer requests
make_request() {
    local url=$1
    local method=${2:-GET}
    
    if [ "$method" = "GET" ]; then
        curl -s -X GET "${url}?access_token=${BUSINESS_TOKEN}"
    else
        curl -s -X POST "${url}" \
            -H "Authorization: Bearer ${BUSINESS_TOKEN}" \
            "${@:3}"
    fi
}

echo -e "${GREEN}1. Obteniendo números de la cuenta...${NC}"
NUMBERS_RESPONSE=$(make_request "https://graph.facebook.com/${API_VERSION}/${WABA_ID}/phone_numbers")

if echo "$NUMBERS_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    echo -e "${RED}Error al obtener números:${NC}"
    echo "$NUMBERS_RESPONSE" | jq '.error'
    echo -e "\n${YELLOW}Posibles causas:${NC}"
    echo "  - El token no tiene permisos de whatsapp_business_management"
    echo "  - El WABA ID es incorrecto"
    echo "  - El token expiró"
    echo ""
else
    echo "$NUMBERS_RESPONSE" | jq '.'
    
    # Contar números
    NUM_COUNT=$(echo "$NUMBERS_RESPONSE" | jq '.data | length')
    echo -e "\n${GREEN}Números encontrados: ${NUM_COUNT}${NC}\n"
fi

echo -e "${GREEN}2. Verificando estado del número ${PHONE_NUMBER_ID}...${NC}"
PHONE_RESPONSE=$(make_request "https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}")

if echo "$PHONE_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    echo -e "${RED}Error al obtener información del número:${NC}"
    echo "$PHONE_RESPONSE" | jq '.error'
    echo ""
else
    echo "$PHONE_RESPONSE" | jq '.'
    
    # Extraer información clave
    VERIFIED=$(echo "$PHONE_RESPONSE" | jq -r '.code_verification_status // "UNKNOWN"')
    QUALITY=$(echo "$PHONE_RESPONSE" | jq -r '.quality_rating // "UNKNOWN"')
    DISPLAY_NUMBER=$(echo "$PHONE_RESPONSE" | jq -r '.display_phone_number // "N/A"')
    VERIFIED_NAME=$(echo "$PHONE_RESPONSE" | jq -r '.verified_name // "N/A"')
    
    echo -e "\n${GREEN}Estado del número:${NC}"
    echo "  - Número: ${DISPLAY_NUMBER}"
    echo "  - Nombre verificado: ${VERIFIED_NAME}"
    
    if [ "$VERIFIED" = "VERIFIED" ]; then
        echo -e "  - Verificación: ${GREEN}✓ VERIFICADO${NC}"
    else
        echo -e "  - Verificación: ${RED}✗ ${VERIFIED}${NC}"
    fi
    
    case $QUALITY in
        "GREEN")
            echo -e "  - Calidad: ${GREEN}✓ BUENA (GREEN)${NC}"
            ;;
        "YELLOW")
            echo -e "  - Calidad: ${YELLOW}⚠ MEDIA (YELLOW)${NC}"
            ;;
        "RED")
            echo -e "  - Calidad: ${RED}✗ BAJA (RED)${NC}"
            ;;
        *)
            echo "  - Calidad: ${QUALITY}"
            ;;
    esac
    echo ""
fi

echo -e "${GREEN}3. Verificando throughput (capacidad de mensajes)...${NC}"
THROUGHPUT_RESPONSE=$(make_request "https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}?fields=throughput")

if echo "$THROUGHPUT_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    echo -e "${RED}Error al obtener throughput:${NC}"
    echo "$THROUGHPUT_RESPONSE" | jq '.error'
    echo ""
else
    echo "$THROUGHPUT_RESPONSE" | jq '.'
    
    THROUGHPUT_LEVEL=$(echo "$THROUGHPUT_RESPONSE" | jq -r '.throughput.level // "UNKNOWN"')
    echo -e "\n${GREEN}Nivel de throughput: ${THROUGHPUT_LEVEL}${NC}"
    
    case $THROUGHPUT_LEVEL in
        "STANDARD")
            echo "  → 80 mensajes por segundo"
            ;;
        "HIGH")
            echo "  → 1000 mensajes por segundo"
            ;;
        *)
            echo "  → Nivel desconocido"
            ;;
    esac
    echo ""
fi

echo -e "${GREEN}4. Verificando límites de mensajería...${NC}"
LIMITS_RESPONSE=$(make_request "https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}?fields=messaging_limit_tier")

if echo "$LIMITS_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    echo -e "${YELLOW}No se pudo obtener el límite de mensajería (puede requerir permisos adicionales)${NC}"
else
    echo "$LIMITS_RESPONSE" | jq '.'
    echo ""
fi

echo -e "${YELLOW}=== Verificación completa ===${NC}\n"

# Recomendaciones
echo -e "${GREEN}Recomendaciones:${NC}"

if [ "$VERIFIED" != "VERIFIED" ]; then
    echo -e "  ${RED}⚠${NC} El número NO está verificado. Para verificarlo:"
    echo "     curl -X POST \"https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/request_code\" \\"
    echo "       -H \"Authorization: Bearer \${BUSINESS_TOKEN}\" \\"
    echo "       -F \"code_method=SMS\" \\"
    echo "       -F \"language=es\""
    echo ""
fi

if [ "$QUALITY" = "YELLOW" ] || [ "$QUALITY" = "RED" ]; then
    echo -e "  ${YELLOW}⚠${NC} La calidad del número es ${QUALITY}. Considera:"
    echo "     - Reducir la frecuencia de mensajes"
    echo "     - Evitar mensajes no solicitados"
    echo "     - Mejorar la tasa de respuesta de usuarios"
    echo ""
fi

if [ "$THROUGHPUT_LEVEL" = "STANDARD" ]; then
    echo -e "  ${YELLOW}ℹ${NC} Throughput en nivel STANDARD (80 msg/s). Para aumentar a HIGH:"
    echo "     - Completa la verificación de negocio en Meta Business"
    echo "     - Consulta: https://developers.facebook.com/docs/whatsapp/overview#throughput"
    echo ""
fi

echo -e "${GREEN}Documentación completa en:${NC} .github/docs/WHATSAPP_PHONE_REGISTRATION.md"
