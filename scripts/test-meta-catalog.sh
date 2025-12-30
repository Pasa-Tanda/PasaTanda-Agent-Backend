#!/bin/bash

# =====================================================
# EJEMPLOS DE USO - META CATALOG INTEGRATION
# Endpoints de prueba para desarrollo
# =====================================================

# Configuración
BASE_URL="http://localhost:3000"
COMPANY_ID="00000000-0000-0000-0000-000000000000"

echo "=== Meta Catalog Integration - Test Endpoints ==="
echo ""

# =====================================================
# 1. VERIFICAR CONFIGURACIÓN
# =====================================================

echo "1. Verificando Catalog ID..."
curl -X GET "${BASE_URL}/catalog-test/catalog-id/${COMPANY_ID}" \
  -H "Content-Type: application/json" | jq
echo ""

# =====================================================
# 2. SINCRONIZACIÓN
# =====================================================

echo "2. Sincronizando inventario de Supabase hacia Meta..."
curl -X POST "${BASE_URL}/catalog-test/sync-to-meta" \
  -H "Content-Type: application/json" \
  -d "{\"companyId\": \"${COMPANY_ID}\"}" | jq
echo ""

echo "3. Sincronizando inventario de Meta hacia Supabase..."
curl -X POST "${BASE_URL}/catalog-test/sync-from-meta" \
  -H "Content-Type: application/json" \
  -d "{\"companyId\": \"${COMPANY_ID}\"}" | jq
echo ""

# =====================================================
# 3. CONSULTAS DE PRODUCTOS
# =====================================================

echo "4. Listando todos los productos..."
curl -X GET "${BASE_URL}/catalog-test/products/${COMPANY_ID}" \
  -H "Content-Type: application/json" | jq
echo ""

echo "5. Buscando productos 'camisa'..."
curl -X GET "${BASE_URL}/catalog-test/search/${COMPANY_ID}?q=camisa" \
  -H "Content-Type: application/json" | jq
echo ""

echo "6. Obteniendo información de producto específico..."
PRODUCT_ID="PROD001"
curl -X GET "${BASE_URL}/catalog-test/product/${COMPANY_ID}/${PRODUCT_ID}" \
  -H "Content-Type: application/json" | jq
echo ""

# =====================================================
# 4. ACTUALIZACIÓN DE PRODUCTOS
# =====================================================

echo "7. Actualizando disponibilidad de producto..."
curl -X POST "${BASE_URL}/catalog-test/availability" \
  -H "Content-Type: application/json" \
  -d "{
    \"companyId\": \"${COMPANY_ID}\",
    \"productId\": \"PROD001\",
    \"available\": false
  }" | jq
echo ""

# =====================================================
# 5. EJECUTAR HERRAMIENTA ESPECÍFICA
# =====================================================

echo "8. Ejecutando herramienta 'list_all_products'..."
curl -X POST "${BASE_URL}/catalog-test/tool" \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"list_all_products\",
    \"companyId\": \"${COMPANY_ID}\"
  }" | jq
echo ""

echo "9. Ejecutando herramienta 'search_products'..."
curl -X POST "${BASE_URL}/catalog-test/tool" \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"search_products\",
    \"companyId\": \"${COMPANY_ID}\",
    \"params\": {
      \"searchTerm\": \"zapato\"
    }
  }" | jq
echo ""

echo "10. Ejecutando herramienta 'get_product_info'..."
curl -X POST "${BASE_URL}/catalog-test/tool" \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"get_product_info\",
    \"companyId\": \"${COMPANY_ID}\",
    \"params\": {
      \"productId\": \"PROD001\"
    }
  }" | jq
echo ""

# =====================================================
# EJEMPLOS ADICIONALES
# =====================================================

# Ejemplo: Sincronización bidireccional completa
sync_bidirectional() {
  echo "=== Sincronización Bidireccional ==="
  
  echo "1. Supabase → Meta..."
  curl -X POST "${BASE_URL}/catalog-test/sync-to-meta" \
    -H "Content-Type: application/json" \
    -d "{\"companyId\": \"${COMPANY_ID}\"}" | jq
  
  echo "2. Esperando 5 segundos..."
  sleep 5
  
  echo "3. Meta → Supabase..."
  curl -X POST "${BASE_URL}/catalog-test/sync-from-meta" \
    -H "Content-Type: application/json" \
    -d "{\"companyId\": \"${COMPANY_ID}\"}" | jq
}

# Ejemplo: Actualizar múltiples productos
update_multiple_products() {
  echo "=== Actualizar Múltiples Productos ==="
  
  PRODUCTS=("PROD001" "PROD002" "PROD003")
  
  for PROD_ID in "${PRODUCTS[@]}"; do
    echo "Actualizando ${PROD_ID}..."
    curl -X POST "${BASE_URL}/catalog-test/availability" \
      -H "Content-Type: application/json" \
      -d "{
        \"companyId\": \"${COMPANY_ID}\",
        \"productId\": \"${PROD_ID}\",
        \"available\": true
      }" | jq
    sleep 1
  done
}

# Ejemplo: Monitoreo continuo
monitor_sync() {
  echo "=== Monitoreo de Sincronización ==="
  
  while true; do
    clear
    echo "Última actualización: $(date)"
    echo ""
    
    curl -s -X GET "${BASE_URL}/catalog-test/products/${COMPANY_ID}" \
      -H "Content-Type: application/json" | jq '.data | length'
    
    sleep 10
  done
}

# =====================================================
# PRUEBAS DE LENGUAJE NATURAL (WhatsApp Simulator)
# =====================================================

# Estos mensajes deberían activar las herramientas automáticamente
simulate_whatsapp_messages() {
  echo "=== Simulación de Mensajes de WhatsApp ==="
  
  MESSAGES=(
    "Actualiza el catálogo con Meta"
    "Sincroniza los productos"
    "Busca productos de zapatos"
    "Dame información del producto PROD001"
    "Marca el producto PROD002 como no disponible"
    "Lista todos los productos"
  )
  
  for MSG in "${MESSAGES[@]}"; do
    echo "Usuario: ${MSG}"
    echo "Bot: [Procesando...]"
    echo ""
    sleep 2
  done
}

# =====================================================
# FUNCIONES DE AYUDA
# =====================================================

# Ayuda
show_help() {
  echo "Uso: ./test-meta-catalog.sh [comando]"
  echo ""
  echo "Comandos disponibles:"
  echo "  all                  - Ejecutar todas las pruebas"
  echo "  sync                 - Sincronización bidireccional"
  echo "  update               - Actualizar múltiples productos"
  echo "  monitor              - Monitoreo continuo"
  echo "  simulate             - Simular mensajes de WhatsApp"
  echo "  help                 - Mostrar esta ayuda"
  echo ""
}

# =====================================================
# EJECUTAR
# =====================================================

case "$1" in
  sync)
    sync_bidirectional
    ;;
  update)
    update_multiple_products
    ;;
  monitor)
    monitor_sync
    ;;
  simulate)
    simulate_whatsapp_messages
    ;;
  help)
    show_help
    ;;
  all|"")
    # Ejecutar todas las pruebas por defecto
    ;;
  *)
    echo "Comando desconocido: $1"
    show_help
    exit 1
    ;;
esac

echo ""
echo "=== Pruebas completadas ==="
