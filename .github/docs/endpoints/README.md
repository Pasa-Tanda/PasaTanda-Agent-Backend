# API Endpoints (AgentBE)

## Webhooks (Meta WhatsApp)
- **GET /webhook** — Verificación de suscripción.
  - Query: `hub.mode`, `hub.verify_token`, `hub.challenge`.
  - Respuesta 200: texto plano con `challenge` cuando `verify_token` coincide.
- **POST /webhook** — Eventos entrantes de WhatsApp.
  - Body: payload oficial de Meta.
  - Comportamiento: marca leído, intenta validar códigos de verificación enviados por el usuario, enruta textos al orquestador (intents), responde con acciones (textos/QR).
  - Respuesta: `{ "status": "success" }`.

## Onboarding (sin contrato todavía)
- **GET /api/onboarding/verify?phone=59812345678** — Emite código de verificación.
  - Respuesta 200:
    ```json
    {
      "phone": "59812345678",
      "code": "123456",
      "expiresAt": "2025-01-01T12:00:00.000Z",
      "instructions": "Envía este código por WhatsApp para validar tu número antes de crear la tanda."
    }
    ```
- **POST /api/onboarding** — Crea usuario + grupo de WhatsApp y deja el grupo en estado `DRAFT` (sin contrato Soroban ni orden de pago).
  - Body ejemplo:
    ```json
    {
      "phoneNumber": "59812345678",
      "username": "Ana",
      "groupName": "Tanda Enero",
      "amountBs": 700,
      "amountUsdc": 100,
      "exchangeRate": 7,
      "frequencyDays": 30,
      "yieldEnabled": true,
      "verificationCode": "123456"
    }
    ```
  - Respuesta 200:
    ```json
    {
      "success": true,
      "groupId": 12,
      "groupWhatsappId": "12345@g.us",
      "contractAddress": null,
      "paymentOrderId": null,
      "status": "DRAFT"
    }
    ```

## Activar Tanda (crear contrato + pago inicial)
- **POST /api/onboarding/:groupId/start** — Despliega contrato en Soroban y genera la primera orden de pago.
  - Body ejemplo:
    ```json
    {
      "amountBs": 700,
      "amountUsdc": 100,
      "exchangeRate": 7,
      "frequencyDays": 30,
      "yieldEnabled": true
    }
    ```
  - Respuesta 200:
    ```json
    {
      "success": true,
      "groupId": 12,
      "groupWhatsappId": "12345@g.us",
      "contractAddress": "GABC...",
      "paymentOrderId": "4c1a...",
      "paymentJobId": "job_abc",
      "payUrl": "https://app.tu-dominio.com/pagos/4c1a...",
      "qrIpfs": "iVBORw0K...",
      "status": "ACTIVE"
    }
    ```
  - **Mensaje WA (admin, en el grupo):** escribir “iniciar tanda” dispara la misma acción de despliegue si el admin es quien creó la tanda y el grupo está en `DRAFT`.

## Payment Orders (frontend self-service)
- **GET /api/orders/:id** — Consulta estado y artefactos.
  - Respuesta 200:
    ```json
    {
      "id": "4c1a...",
      "status": "CLAIMED_BY_USER",
      "amountFiat": 700,
      "currencyFiat": "BOB",
      "amountUsdc": 100,
      "qrPayloadUrl": "data:image/png;base64,iVBORw0...",
      "xdrChallenge": "AAAA...",
      "proofMetadata": null,
      "groupId": 12
    }
    ```
- **POST /api/orders/:id/claim** — El usuario confirma pago.
  - Body fiat ejemplo:
    ```json
    {
      "paymentType": "fiat",
      "proofMetadata": {
        "bank": "Bisa",
        "amount": 700,
        "reference": "ABC123",
        "screenshotUrl": "https://.../proof.png"
      }
    }
    ```
  - Body crypto ejemplo:
    ```json
    {
      "paymentType": "crypto",
      "xPayment": "eyJvcmRlcklkIjoiNGMxYS4uLiJ9" 
    }
    ```
  - Respuesta fiat:
    ```json
    { "success": true, "status": "PENDING_CONFIRMATION", "actions": [ { "type": "text", "text": "Pago verificado ✅..." } ] }
    ```
  - Respuesta crypto:
    ```json
    { "success": true, "txHash": "0xabc...", "status": "CONFIRMED" }
    ```

## Payment Proxy (MAIN_PAGE → PayBE)
- **GET /api/pay** — Proxy transparente.
  - Headers: opcional `X-PAYMENT` (base64 JSON X402).
  - Query: passthrough hacia PayBE.
  - Respuesta: la misma que PayBE (ej. QR base64, XDR challenge, jobId). Se ajusta `X-PAYMENT` para compatibilidad X402 si contiene `orderId/details`.

## Payment Webhooks (PayBE → AgentBE)
- **POST /webhook/payments/result** — Eventos legacy.
  - Body ejemplo: `{ "event_type": "SETTLED", "order_id": "4c1a..." }`.
  - Efecto: marca `payment_orders.status = COMPLETED`, notifica al usuario por WhatsApp si hay destinatario.
- **POST /webhook/x402/result** — Eventos X402 (fiat/crypto).
  - Body ejemplo: `{ "event_type": "VERIFIED", "order_id": "4c1a...", "x_payment": "..." }`.
  - Efecto: pasa al tesorero para actualizar estado y notificar.

## Google OAuth (Sheets/Drive)
- **GET /google-auth/url** — Devuelve URL de autorización Google.
- **GET /google-auth/callback** — Recibe código de Google y persiste credenciales.

## Catálogo Meta
- **POST /api/catalog/test** — Envía plantilla de prueba al catálogo de WhatsApp (uso interno de validación).

## Notas de seguridad
- Sirve `/api/onboarding`, `/api/onboarding/verify`, `/api/onboarding/:groupId/start`, `/api/orders/*`, `/api/pay` solo sobre HTTPS y dominio autorizado.
- Webhooks: validar `WHATSAPP_VERIFY_TOKEN` en GET /webhook y firmas/HMAC de PayBE si se habilitan.
- Supabase requerido para persistir verificación, órdenes y grupos; en dev existe fallback in-memory para verificación.
