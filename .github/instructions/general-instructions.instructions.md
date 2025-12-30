# Contexto del Proyecto: PasaTanda - Agent Backend (AgentBE)

## 1. Visión General del Sistema
El **Agent Backend (AgentBE)** es el núcleo de orquestación de "PasaTanda", una plataforma de ahorro colaborativo (Pasanaku/ROSCA) que opera a través de WhatsApp.

Este backend actúa como un **Sistema Multi-Agente Híbrido** impulsado por herramientas de Google:
* **Capa Cognitiva (AI):** Implementada utilizando el **Google Gen AI SDK** (`@google/generative-ai`) para integrar los modelos **Google Gemini**. Se encarga de entender lenguaje natural (intenciones) y analizar imágenes (comprobantes bancarios).
* **Capa Determinista (Lógica):** Agentes de código tradicional (Node.js/TypeScript) para ejecutar reglas de negocio, transacciones y persistencia.

## 2. Stack Tecnológico
* **Lenguaje/Runtime:** Node.js (TypeScript).
* **Framework:** Express o Next.js API Routes.
* **Inteligencia Artificial (Google ADK):**
    * **Librería:** `npm install @google/adk`
* **Mensajería:** Meta WhatsApp Cloud API (Webhooks).
* **Base de Datos:** PostgreSQL supabase (Gestión de usuarios, grupos y estados de ronda).
* **Integración Financiera:** Conexión vía HTTP REST con el **Payment Backend (PayBE)**.

## 3. Arquitectura de Agentes

El sistema utiliza el SDK de Google para potenciar agentes especializados:

### A. Webhook Controller (Entrada)
* **Función:** Recibe los eventos `POST` de Meta.
* **Responsabilidad:** Verifica firmas (`X-Hub-Signature`), normaliza el mensaje y lo pasa al Orquestador.

### B. AI Orchestrator (Google AI SDK Wrapper)
No usamos comandos rígidos. Usamos el SDK de Google para inferir la intención.
* **Implementación:** Se instancia `GoogleGenerativeAI` y se utiliza `model.generateContent` con "System Instructions" estrictas.
* **Prompting:** El modelo actúa como un router clasificador.
* **Salida Estructurada (JSON Mode):**
    ```json
    {
      "intent": "PAY_QUOTA" | "CHECK_STATUS" | "CREATE_GROUP" | "UPLOAD_PROOF",
      "entities": { "amount": number, "currency": string },
      "confidence": number
    }
    ```

### C. Agentes Ejecutores (Deterministas)
Dependiendo del JSON generado por el SDK, se activa uno de estos agentes:

1.  **🎮 Game Master Agent (Reglas del Juego):**
    * Gestiona el ciclo de vida de las tandas (Inicio, Rondas, Fin).
    * Calcula turnos y ganadores consultando PostgreSQL.

2.  **💰 Treasurer Agent (Tesorero):**
    * **Crítico:** Maneja el dinero y la comunicación con el `PayBE`.
    * **On-Ramp:** Genera órdenes de pago (`GET /api/pay` al PayBE).
    * **Verificación:** Coordina la validación de pagos Fiat y Crypto.
    * **Off-Ramp:** Gestiona retiros a bancos o wallets.

3.  **👁️ Validator Agent (Gemini Vision):**
    * Se activa cuando llega una imagen.
    * **Proceso:** Descarga la imagen de WhatsApp -> Convierte a Base64 -> Envía a Gemini Pro Vision usando el SDK (`inlineData`).
    * **Prompt:** "Extrae en JSON: Banco, Fecha, Monto, Referencia".
    * **Salida:** Pasa los datos limpios al `Treasurer Agent`.

## 4. Flujos de Datos Críticos

### Flujo 1: Intención de Usuario (Texto)
`Usuario` -> `WhatsApp` -> `Webhook` -> `Google AI SDK (Gemini Flash)` -> `JSON Intent` -> `Game Agent` -> `Respuesta Texto`.

### Flujo 2: Verificación de Pago (Imagen/QR)
1.  **Usuario** sube foto del comprobante.
2.  **Webhook** detecta imagen.
3.  **Google AI SDK (Gemini Pro)** procesa la imagen y extrae: `{ "monto": 100, "ref": "12345" }`.
4.  **Treasurer Agent** recibe los datos estructurados.
5.  **Treasurer Agent** llama a **PayBE** (`GET /api/pay` con payload del comprobante).
6.  **PayBE** valida con el Banco real.
7.  Si es válido -> **Treasurer Agent** registra el pago y notifica éxito.

## 5. Integración con Payment Backend (PayBE)
El AgentBE consume una API unificada del PayBE:
* `GET /api/pay` (Sin payload): Descubrimiento (Obtiene QR y XDR Crypto).
* `GET /api/pay` (Con payload JSON): Verificación Fiat (Valida datos extraídos por Gemini).
* `GET /api/pay` (Con Auth Header): Verificación Crypto (Protocolo X402 Stellar).

## 6. Estructura de Base de Datos (Referencia)
El sistema interactúa principalmente con estas tablas:
* `users` (Identidad y Wallet).
* `groups` (Configuración de la Tanda).
* `payment_orders` (Rastreo de intentos de pago UUID).

