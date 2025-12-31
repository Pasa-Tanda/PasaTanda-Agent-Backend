# PasaTanda API Documentation

## Arquitectura del Sistema

PasaTanda utiliza una arquitectura híbrida con tres componentes principales:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend     │────▶│    AgentBE      │────▶│     PayBE       │
│   (Next.js)     │◀────│  (Orquestador)  │◀────│  (Pasarela)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │                        │
                               ▼                        ▼
                        ┌───────────┐           ┌───────────────┐
                        │  Supabase │           │  Stellar/     │
                        │    DB     │           │  Soroban      │
                        └───────────┘           └───────────────┘
```

**Importante:** El Frontend NO se conecta directamente a Stellar/Soroban. Toda la lógica onchain, tokens, y transacciones son manejados por AgentBE y PayBE. El frontend solo consume APIs REST.

---

## Variables de Entorno

```env
# Backend URLs
NEXT_PUBLIC_AGENT_BE_URL=http://localhost:3001

# WhatsApp Bot Number (for verification flow)
NEXT_PUBLIC_WHATSAPP_AGENT_NUMBER=59177777777

# Stellar/Trustline Config (USDC on Testnet)
NEXT_PUBLIC_USDC_ASSET_CODE=USDC
NEXT_PUBLIC_USDC_ASSET_ISSUER=GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56

# Frontend Webhook URL (for AgentBE callbacks)
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3000

# Optional: Webhook security
WEBHOOK_SECRET=your-hmac-secret-key
```

---

## API Endpoints - AgentBE

Base URL: `${NEXT_PUBLIC_AGENT_BE_URL}`

### Onboarding

#### GET /api/onboarding/verify

Solicita código de verificación para validar número de WhatsApp.

**Request:**
```http
GET /api/onboarding/verify?phone=%2B59177777777
```

**Response (200):**
```json
{
  "success": true,
  "code": "ABC123",
  "expiresAt": 1703955200000,
  "message": "Envía este código al bot de WhatsApp"
}
```

**Response (400):**
```json
{
  "success": false,
  "message": "Número de teléfono inválido"
}
```

**Ejemplo Frontend:**
```typescript
const agentUrl = process.env.NEXT_PUBLIC_AGENT_BE_URL;

const response = await fetch(`${agentUrl}/api/onboarding/verify?phone=${encodeURIComponent(phone)}`);
const data = await response.json();

if (data.success) {
  setVerificationCode(data.code);
  // Mostrar código al usuario para que lo envíe al bot
}
```

---

#### POST /api/onboarding

Crea una nueva tanda (estado DRAFT). No despliega contratos hasta que el admin active la tanda.

**Request:**
```http
POST /api/onboarding
Content-Type: application/json

{
  "name": "Tanda Familia 2025",
  "phone": "+59177777777",
  "whatsappUsername": "Juan Pérez",
  "currency": "BS",
  "amount": 700,
  "frequency": "MENSUAL",
  "enableYield": true,
  "yieldShareBps": 8000
}
```

**Parámetros:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| name | string | ✓ | Nombre del grupo/tanda |
| phone | string | ✓ | Teléfono con código país (+591...) |
| whatsappUsername | string | ✓ | Nombre de usuario de WhatsApp |
| currency | "BS" \| "USDC" | ✓ | Moneda de la tanda |
| amount | number | ✓ | Monto por ronda (en la moneda seleccionada) |
| frequency | string | ✓ | "SEMANAL", "QUINCENAL", "MENSUAL" |
| enableYield | boolean | ✗ | Activar rendimiento DeFi (Blend) |
| yieldShareBps | number | ✗ | Porcentaje para usuarios (10000 = 100%) |

**Response (201):**
```json
{
  "success": true,
  "groupId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "DRAFT",
  "whatsappGroupJid": "120363123456789@g.us",
  "inviteLink": "https://chat.whatsapp.com/ABC123xyz",
  "message": "Grupo creado. Comparte el link de invitación."
}
```

**Ejemplo Frontend:**
```typescript
const createTanda = async (formData: OnboardingFormData) => {
  const response = await fetch(`${agentUrl}/api/onboarding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: formData.groupName,
      phone: formData.phone,
      whatsappUsername: formData.whatsappUsername,
      currency: formData.currency,
      amount: formData.amount,
      frequency: formData.frequency,
      enableYield: formData.yieldEnabled,
      yieldShareBps: 8000, // 80% para usuarios
    }),
  });
  
  const data = await response.json();
  
  if (data.success) {
    // Redirigir a página de éxito
    router.push(`/onboarding/success?group=${data.groupId}`);
  }
};
```

---

### Payment Orders

#### GET /api/orders/:id

Obtiene detalles de una orden de pago (QR, XDR challenge, estado).

**Request:**
```http
GET /api/orders/550e8400-e29b-41d4-a716-446655440000
```

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PENDING",
  "amountFiat": 700,
  "currencyFiat": "BS",
  "amountUsdc": 100.57,
  "exchangeRate": 6.96,
  "groupId": "group-uuid",
  "groupName": "Tanda Familia 2025",
  "roundNumber": 3,
  "dueDate": "2025-01-15T00:00:00Z",
  "qrPayloadUrl": "data:image/png;base64,iVBORw0KGgo...",
  "xdrChallenge": "AAAAAgAAAADY2...",
  "paymentRequirements": {
    "scheme": "exact",
    "network": "stellar:testnet",
    "payTo": "GCONTRACT...",
    "maxAmountRequired": "100570000",
    "asset": "USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"
  }
}
```

**Estados posibles:**
- `PENDING` - Esperando pago
- `CLAIMED_BY_USER` - Usuario reportó pago, pendiente verificación
- `PROCESSING_CRYPTO` - Procesando transacción crypto
- `COMPLETED` - Pago verificado y registrado en blockchain
- `REJECTED` - Pago rechazado
- `EXPIRED` - Orden expirada

**Ejemplo Frontend:**
```typescript
useEffect(() => {
  const fetchOrder = async () => {
    const response = await fetch(`${agentUrl}/api/orders/${orderId}`);
    const data = await response.json();
    setOrder(data);
  };
  fetchOrder();
}, [orderId]);
```

---

#### POST /api/orders/:id/claim

Confirma un pago (fiat o crypto). El tipo determina el flujo de verificación.

##### Pago Fiat (QR Bancario)

**Request:**
```http
POST /api/orders/550e8400-e29b-41d4-a716-446655440000/claim
Content-Type: application/json

{
  "paymentType": "fiat",
  "proofMetadata": {
    "bank": "BNB",
    "amount": 700,
    "reference": "TRX123456789",
    "screenshotUrl": "https://storage.example.com/proof/abc123.jpg"
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "status": "CLAIMED_BY_USER",
  "message": "Comprobante recibido. Verificando con el banco..."
}
```

##### Pago Crypto (Stellar Wallet)

**Request:**
```http
POST /api/orders/550e8400-e29b-41d4-a716-446655440000/claim
Content-Type: application/json

{
  "paymentType": "crypto",
  "xPayment": "eyJ2ZXJzaW9uIjoieDQwMi1zdGVsbGFyLXYxIiwic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiVGVzdCBTREYgTmV0d29yayA7IFNlcHRlbWJlciAyMDE1IiwicGF5bG9hZCI6eyJzaWduZWRYZHIiOiJBQUFBQWdBQUFBRC4uLiJ9fQ=="
}
```

**Estructura del xPayment (base64 decodificado):**
```json
{
  "version": "x402-stellar-v1",
  "scheme": "exact",
  "network": "Test SDF Network ; September 2015",
  "payload": {
    "signedXdr": "AAAAAgAAAADY2..."
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "status": "COMPLETED",
  "txHash": "8f7c9a2b3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u",
  "message": "Pago crypto verificado y registrado"
}
```

**Ejemplo Frontend:**
```typescript
// Pago Fiat
const handleFiatClaim = async () => {
  const response = await fetch(`${agentUrl}/api/orders/${orderId}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentType: 'fiat',
      proofMetadata: {
        bank: proof.bank,
        amount: Number(proof.amount),
        reference: proof.reference,
        screenshotUrl: proof.screenshotUrl,
      },
    }),
  });
  
  const data = await response.json();
  if (data.success) {
    setSuccess('Verificando pago...');
  }
};

// Pago Crypto
const handleCryptoClaim = async () => {
  const xPayment = await buildXPayment(order.xdrChallenge, {
    address: walletInfo.address,
  });
  
  const response = await fetch(`${agentUrl}/api/orders/${orderId}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentType: 'crypto',
      xPayment,
    }),
  });
  
  const data = await response.json();
  if (data.success) {
    setSuccess(`Pago exitoso: ${data.txHash}`);
  }
};
```

---

## Webhooks (AgentBE → Frontend)

El frontend expone webhooks que AgentBE llama para notificar eventos.

### POST /api/webhook/confirm_verification

Recibe confirmación de verificación de WhatsApp desde AgentBE.

**Flujo:**
1. Usuario solicita código en frontend → GET /api/onboarding/verify
2. Frontend muestra código al usuario
3. Usuario envía código al bot de WhatsApp
4. Bot valida código y extrae datos del usuario
5. AgentBE llama este webhook con los datos

**Request (desde AgentBE):**
```http
POST /api/webhook/confirm_verification
Content-Type: application/json

{
  "phone": "+59177777777",
  "verified": true,
  "timestamp": 1703955200000,
  "whatsappUsername": "Juan Pérez",
  "whatsappNumber": "59177777777"
}
```

**Parámetros:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| phone | string | ✓ | Teléfono verificado (con código país) |
| verified | boolean | ✓ | Si la verificación fue exitosa |
| timestamp | number | ✓ | Unix timestamp en milisegundos |
| whatsappUsername | string | ✗ | Nombre de usuario en WhatsApp |
| whatsappNumber | string | ✗ | Número de WhatsApp (puede diferir) |

**Response (200):**
```json
{
  "success": true,
  "message": "Phone verification confirmed successfully"
}
```

**Response (400):**
```json
{
  "success": false,
  "message": "Missing required fields: phone and verified"
}
```

---

### GET /api/webhook/confirm_verification

Polling endpoint para verificar estado de verificación desde el frontend.

**Request:**
```http
GET /api/webhook/confirm_verification?phone=%2B59177777777
```

**Response (verificado):**
```json
{
  "verified": true,
  "timestamp": 1703955200000,
  "whatsappUsername": "Juan Pérez",
  "whatsappNumber": "59177777777"
}
```

**Response (no verificado):**
```json
{
  "verified": false,
  "timestamp": null
}
```

**Ejemplo Frontend (Polling):**
```typescript
useEffect(() => {
  if (stage !== 'verification') return;
  
  const pollVerification = async () => {
    const response = await fetch(
      `/api/webhook/confirm_verification?phone=${encodeURIComponent(phone)}`
    );
    const data = await response.json();
    
    if (data.verified) {
      setWhatsappUsername(data.whatsappUsername);
      setStage('confirmation');
    }
  };
  
  const interval = setInterval(pollVerification, 3000);
  return () => clearInterval(interval);
}, [phone, stage]);
```

---

## Diagrama de Secuencia: Verificación WhatsApp

```
┌────────┐     ┌────────────┐     ┌────────────┐     ┌──────────┐
│Frontend│     │  AgentBE   │     │ WhatsApp   │     │  Usuario │
└───┬────┘     └─────┬──────┘     └─────┬──────┘     └────┬─────┘
    │                │                  │                 │
    │ GET /verify    │                  │                 │
    │───────────────▶│                  │                 │
    │                │                  │                 │
    │  { code }      │                  │                 │
    │◀───────────────│                  │                 │
    │                │                  │                 │
    │ Mostrar código │                  │                 │
    │────────────────────────────────────────────────────▶│
    │                │                  │                 │
    │                │                  │  Envía código   │
    │                │                  │◀────────────────│
    │                │                  │                 │
    │                │   Webhook        │                 │
    │                │◀─────────────────│                 │
    │                │                  │                 │
    │  POST /webhook │                  │                 │
    │◀───────────────│                  │                 │
    │  {verified,    │                  │                 │
    │   username}    │                  │                 │
    │                │                  │                 │
    │ Poll GET       │                  │                 │
    │───────────────▶│                  │                 │
    │  {verified}    │                  │                 │
    │◀───────────────│                  │                 │
    │                │                  │                 │
```

---

## Servicios Frontend

### stellar-wallet.ts

Utilidades para conexión de wallet y trustlines usando `stellar-wallets-kit`.

#### connectWallet()

Abre modal de selección de wallet y conecta.

```typescript
import { connectWallet } from '@/app/lib/stellar-wallet';

const wallet = await connectWallet();
// { address: "GXXX...", network: "TESTNET", isConnected: true }
```

#### checkUsdcTrustline(address)

Verifica si una cuenta tiene trustline para USDC.

```typescript
import { checkUsdcTrustline } from '@/app/lib/stellar-wallet';

const status = await checkUsdcTrustline(address);
// { exists: true, balance: "50.0000000", limit: "922337203685.4775807" }
```

#### addUsdcTrustline(address)

Crea trustline para USDC. Requiere wallet conectada.

```typescript
import { addUsdcTrustline } from '@/app/lib/stellar-wallet';

const result = await addUsdcTrustline(address);
// { success: true, txHash: "abc123..." }
```

#### buildXPayment(xdrChallenge, options)

Construye token X-PAYMENT para protocolo x402.

```typescript
import { buildXPayment } from '@/app/lib/stellar-wallet';

const xPayment = await buildXPayment(order.xdrChallenge, {
  address: wallet.address,
  networkPassphrase: 'Test SDF Network ; September 2015',
});
// Base64 encoded X-PAYMENT token
```

---

## Rutas de la Aplicación

| Ruta | Descripción |
|------|-------------|
| `/` | Landing page |
| `/onboarding` | Redirect a /onboarding/verify |
| `/onboarding/verify` | Flujo de creación de tanda (5 etapas) |
| `/pagos` | Información de métodos de pago |
| `/pagos/[id]` | Página de pago individual |
| `/docs` | Índice de documentación |
| `/docs/api` | Referencia de API |
| `/docs/contracts` | Documentación de smart contracts |
| `/docs/integrations` | Guías de integración |
| `/faq` | Preguntas frecuentes |
| `/ToS` | Términos de servicio |
| `/PP` | Política de privacidad |

---

## Códigos de Error Comunes

| Código | Mensaje | Causa |
|--------|---------|-------|
| 400 | "Missing required fields" | Faltan campos obligatorios |
| 401 | "Invalid signature" | Firma HMAC inválida |
| 404 | "Order not found" | Orden no existe |
| 402 | "Payment Required" | Se requiere pago (x402) |
| 500 | "Internal server error" | Error del servidor |