#!/bin/bash

# Script para probar el webhook con el payload de Meta

echo "🧪 Probando webhook con payload de Meta..."
echo ""

# Payload de prueba de Meta (estructura incompleta)
META_TEST_PAYLOAD='{
  "field": "messages",
  "value": {
    "messaging_product": "whatsapp",
    "metadata": {
      "display_phone_number": "16505551111",
      "phone_number_id": "123456123"
    },
    "contacts": [
      {
        "profile": {
          "name": "test user name"
        },
        "wa_id": "16315551181"
      }
    ],
    "messages": [
      {
        "from": "16315551181",
        "id": "ABGGFlA5Fpa",
        "timestamp": "1504902988",
        "type": "text",
        "text": {
          "body": "this is a text message"
        }
      }
    ]
  }
}'

# Payload correcto esperado por nuestra API
CORRECT_PAYLOAD='{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "123456123",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": {
          "display_phone_number": "16505551111",
          "phone_number_id": "123456123"
        },
        "contacts": [
          {
            "profile": {
              "name": "test user name"
            },
            "wa_id": "16315551181"
          }
        ],
        "messages": [
          {
            "from": "16315551181",
            "id": "ABGGFlA5Fpa",
            "timestamp": "1504902988",
            "type": "text",
            "text": {
              "body": "this is a text message"
            }
          }
        ]
      }
    }]
  }]
}'

echo "❌ Payload de prueba de Meta (INCORRECTO):"
echo "$META_TEST_PAYLOAD" | jq .
echo ""
echo "✅ Payload correcto esperado:"
echo "$CORRECT_PAYLOAD" | jq .
echo ""

echo "Enviando payload de prueba de Meta a localhost:3000/webhook..."
echo ""

curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d "$META_TEST_PAYLOAD" \
  -v 2>&1 | tee /tmp/webhook_meta_test_error.log

echo ""
echo ""
echo "📋 Log guardado en: /tmp/webhook_meta_test_error.log"
