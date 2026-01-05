# Estructura interna de `src/` (PasaTanda Agent Backend)

Este documento describe, **archivo por archivo**, la función, clases/métodos principales e interacciones entre componentes dentro de `src/`.

> Orden: el contenido sigue el orden observado al listar las carpetas (`list_dir`) y luego recorre cada subcarpeta en el mismo orden.

---

## Índice

- [Estructura interna de `src/` (PasaTanda Agent Backend)](#estructura-interna-de-src-pasatanda-agent-backend)
  - [Índice](#índice)
  - [`src/app.controller.spec.ts`](#srcappcontrollerspects)
  - [`src/app.controller.ts`](#srcappcontrollerts)
  - [`src/app.module.ts`](#srcappmodulets)
  - [`src/app.service.ts`](#srcappservicets)
  - [`src/frontend-creation/group-creation.controller.ts`](#srcfrontend-creationgroup-creationcontrollerts)
  - [`src/frontend-creation/group-creation.service.ts`](#srcfrontend-creationgroup-creationservicets)
  - [`src/frontend-creation/onboarding.module.ts`](#srcfrontend-creationonboardingmodulets)
  - [`src/main.ts`](#srcmaints)
- [`src/whatsapp/` (módulo principal de WhatsApp, pagos y agentes)](#srcwhatsapp-módulo-principal-de-whatsapp-pagos-y-agentes)
  - [`src/whatsapp/agents/adk-orchestrator.service.ts`](#srcwhatsappagentsadk-orchestratorservicets)
  - [`src/whatsapp/agents/adk-subagents.ts`](#srcwhatsappagentsadk-subagentsts)
  - [`src/whatsapp/agents/game-master.agent.ts`](#srcwhatsappagentsgame-masteragentts)
  - [`src/whatsapp/agents/pasatanda-tools.service.ts`](#srcwhatsappagentspasatanda-toolsservicets)
  - [`src/whatsapp/agents/treasurer.agent.ts`](#srcwhatsappagentstreasureragentts)
  - [`src/whatsapp/agents/validator.agent.ts`](#srcwhatsappagentsvalidatoragentts)
  - [`src/whatsapp/dto/meta-catalog.dto.ts`](#srcwhatsappdtometa-catalogdtots)
  - [`src/whatsapp/dto/payment-webhook.dto.ts`](#srcwhatsappdtopayment-webhookdtots)
  - [`src/whatsapp/dto/send-image-message.dto.ts`](#srcwhatsappdtosend-image-messagedtots)
  - [`src/whatsapp/dto/send-template-message.dto.ts`](#srcwhatsappdtosend-template-messagedtots)
  - [`src/whatsapp/dto/send-text-message.dto.ts`](#srcwhatsappdtosend-text-messagedtots)
  - [`src/whatsapp/dto/whatsapp-webhook.dto.ts`](#srcwhatsappdtowhatsapp-webhookdtots)
  - [`src/whatsapp/dto/x402-webhook.dto.ts`](#srcwhatsappdtox402-webhookdtots)
  - [`src/whatsapp/interfaces/whatsapp.interface.ts`](#srcwhatsappinterfaceswhatsappinterfacets)
  - [`src/whatsapp/payment-orders.controller.ts`](#srcwhatsapppayment-orderscontrollerts)
  - [`src/whatsapp/payment-proxy.controller.ts`](#srcwhatsapppayment-proxycontrollerts)
  - [`src/whatsapp/payment-webhook.controller.ts`](#srcwhatsapppayment-webhookcontrollerts)
  - [`src/whatsapp/services/adk-session.service.ts`](#srcwhatsappservicesadk-sessionservicets)
  - [`src/whatsapp/services/encryption.service.ts`](#srcwhatsappservicesencryptionservicets)
  - [`src/whatsapp/services/frontend-webhook.service.ts`](#srcwhatsappservicesfrontend-webhookservicets)
  - [`src/whatsapp/services/gemini.service.ts`](#srcwhatsappservicesgeminiservicets)
  - [`src/whatsapp/services/google-oauth.service.ts`](#srcwhatsappservicesgoogle-oauthservicets)
  - [`src/whatsapp/services/group.service.ts`](#srcwhatsappservicesgroupservicets)
  - [`src/whatsapp/services/orders-sync.service.ts`](#srcwhatsappservicesorders-syncservicets)
  - [`src/whatsapp/services/pasatanda-orchestrator.service.ts`](#srcwhatsappservicespasatanda-orchestratorservicets)
  - [`src/whatsapp/services/payment-client.service.ts`](#srcwhatsappservicespayment-clientservicets)
  - [`src/whatsapp/services/payment-integration.service.ts`](#srcwhatsappservicespayment-integrationservicets)
  - [`src/whatsapp/services/payment-warmup.service.ts`](#srcwhatsappservicespayment-warmupservicets)
  - [`src/whatsapp/services/pinata.service.ts`](#srcwhatsappservicespinataservicets)
  - [`src/whatsapp/services/sanitization.service.ts`](#srcwhatsappservicessanitizationservicets)
  - [`src/whatsapp/services/soroban-client.service.ts`](#srcwhatsappservicessoroban-clientservicets)
  - [`src/whatsapp/services/supabase-session.service.ts`](#srcwhatsappservicessupabase-sessionservicets)
  - [`src/whatsapp/services/supabase.service.ts`](#srcwhatsappservicessupabaseservicets)
  - [`src/whatsapp/services/verification.service.ts`](#srcwhatsappservicesverificationservicets)
  - [`src/whatsapp/services/whatsapp-messaging.service.ts`](#srcwhatsappserviceswhatsapp-messagingservicets)
  - [`src/whatsapp/services/x402-payment-client.service.ts`](#srcwhatsappservicesx402-payment-clientservicets)
  - [`src/whatsapp/whatsapp.controller.ts`](#srcwhatsappwhatsappcontrollerts)
  - [`src/whatsapp/whatsapp.module.ts`](#srcwhatsappwhatsappmodulets)
  - [`src/whatsapp/whatsapp.service.ts`](#srcwhatsappwhatsappservicets)
  - [`src/whatsapp/whatsapp.types.ts`](#srcwhatsappwhatsapptypests)

---

## `src/app.controller.spec.ts`

**Rol:** prueba unitaria (Jest + `@nestjs/testing`) del endpoint raíz del `AppController`.

**Estructura interna:**

- Suite `describe('AppController')`.
- `beforeEach`: crea un `TestingModule` con `AppController` y `AppService`.
- Test `it('should return ...')`: invoca `appController.getHello()`.

**Puntos relevantes:**

- El texto esperado en el test es **"Baluchop Management Service Hello World!"**, pero `AppService.getHello()` actualmente retorna **"PasaTanda Agent Backend listo"**. Esto hace que el test sea inconsistente (útil documentarlo para quien ejecute tests).

**Interacciones:**

- `AppController` (unidad bajo prueba).
- `AppService` (dependencia inyectada en el controlador).
- `@nestjs/testing` (`Test`, `TestingModule`) para construir el contexto de DI.

---

## `src/app.controller.ts`

**Rol:** controlador HTTP raíz (`/`) del backend.

**Componentes:**

- `AppController` con decorator `@Controller()`.

**Métodos importantes:**

- `getHello()` (`@Get()`): devuelve un string de health/check simple delegando en `AppService.getHello()`.

**Interacciones:**

- `AppService`: se inyecta vía constructor y es la única dependencia.

---

## `src/app.module.ts`

**Rol:** módulo raíz de NestJS. Ensambla módulos y dependencias globales.

**Estructura interna:**

- `@Module({ imports, controllers, providers })`.

**Dependencias/módulos importados:**

- `ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })`: habilita variables de entorno como configuración global.
- `ScheduleModule.forRoot()`: habilita tareas programadas (`@nestjs/schedule`).
- `WhatsappModule`: módulo de integración WhatsApp + pagos + agentes.
- `OnboardingModule`: endpoints de onboarding/front-end para verificación y creación de grupo.

**Interacciones:**

- `AppController` y `AppService` quedan registrados en el módulo.

---

## `src/app.service.ts`

**Rol:** servicio simple de ejemplo/health.

**Métodos importantes:**

- `getHello()`: retorna el string "PasaTanda Agent Backend listo".

**Interacciones:**

- Usado por `AppController`.

---

## `src/frontend-creation/group-creation.controller.ts`

**Rol:** controlador HTTP para flujos de onboarding desde frontend web (`/api/frontend/*`).

**Rutas principales:**

- `GET /api/frontend/verify?phone=...`
  - Valida teléfono (mínimo 8 y máximo 15 dígitos).
  - Solicita código OTP vía `GroupCreationService.requestVerification()`.
  - Retorna `code`, `expiresAt` y también `whatsappUsername` si hay registro.
- `GET /api/frontend/confirm-verification?phone=...`
  - Retorna estado de verificación (`verified`, `timestamp`, `whatsappUsername`, `whatsappNumber`).
- `POST /api/frontend/create-group`
  - Valida campos obligatorios: `name`, `phone`, `whatsappUsername`, `currency`, `amount`, `frequency`.
  - Crea/actualiza usuario en DB (`upsertUser`).
  - Crea grupo DRAFT en DB (`createDraftGroup`).
  - Crea membership admin (`createMembership`).
  - Envía confirmación por WhatsApp al número normalizado (`WhatsappService.sendTextMessage`).

**Métodos internos relevantes:**

- `isValidPhone(phone)`: normaliza a dígitos y aplica rango de longitud.

**Interacciones:**

- `GroupCreationService`:
  - Emite OTP (`requestVerification`, `getLatestRecord`, `getVerificationStatus`).
  - Opera DB de `users`, `groups`, `memberships`.
- `WhatsappService`:
  - Envía mensaje al usuario al crear grupo.

---

## `src/frontend-creation/group-creation.service.ts`

**Rol:** servicio de onboarding para:

- persistir usuarios, grupos y membresías (en Supabase/Postgres)
- gestionar OTP de verificación (tabla `verification_codes`)

**Dependencias:**

- `SupabaseService`: ejecuta queries SQL con `pg.Pool`.
- `Keypair` (`@stellar/stellar-sdk`): genera llaves Stellar (public/secret) al crear/actualizar usuario.
- `randomUUID` (`node:crypto`): genera `groupId` lógico.

**Métodos importantes:**

- `upsertUser({ phone, username, preferredCurrency })`
  - Normaliza teléfono.
  - Genera keypair Stellar.
  - Inserta/actualiza `users` por `phone_number`.
  - Retorna `userId`, `stellarPublicKey`, `stellarSecretKey`, `normalizedPhone`.
- `createDraftGroup({ name, amount, frequencyDays, yieldEnabled, whatsappGroupId? })`
  - Crea un grupo en tabla `groups` con estado `DRAFT`.
  - Deriva `whatsappGroupJid` (por defecto `group-<uuid>@g.us`).
  - Retorna `groupDbId` y ids.
- `createMembership({ userId, groupDbId, isAdmin, turnNumber? })`
  - Inserta en tabla `memberships` con `ON CONFLICT DO NOTHING`.
- OTP/Verificación:
  - `requestVerification(phone)`
    - Genera código (6 chars de alfabeto sin caracteres ambiguos).
    - Guarda/actualiza en `verification_codes` con expiración TTL.
  - `verifyCode(phone, code)`
    - Valida expiración.
    - Compara case-insensitive.
    - Marca como `verified=true` y limpia `code`.
  - `confirmVerification({ phone, verified, timestamp, whatsappUsername, whatsappNumber })`
    - Upsert de estado de verificación y metadata.
  - `getLatestRecord(phone)` / `getVerificationStatus(phone)`

**Funciones internas relevantes:**

- `ensureSupabaseReady()`
  - Verifica que `SupabaseService.isEnabled()` esté activo; de lo contrario lanza error.
- `normalizePhone(phone)`
  - Deja solo dígitos.

**Interacciones:**

- `SupabaseService` → DB (`users`, `groups`, `memberships`, `verification_codes`).
- Consumido por:
  - `GroupCreationController`.
  - `VerificationService` (módulo WhatsApp) como capa de verificación en runtime.
  - `GameMasterAgentService` y `PasatandaToolsService` para crear grupo draft desde chat/agente.

---

## `src/frontend-creation/onboarding.module.ts`

**Rol:** módulo NestJS para onboarding (frontend + verificación) y puente con WhatsApp.

**Estructura:**

- `imports: [forwardRef(() => WhatsappModule)]`: resuelve dependencias circulares con `WhatsappService`.
- `controllers: [GroupCreationController]`.
- `providers: [GroupCreationService, SupabaseService]`.
- `exports: [GroupCreationService, SupabaseService]`: permite que WhatsApp/otros módulos consuman estos servicios.

**Interacciones:**

- `WhatsappModule` (por `forwardRef`).
- `SupabaseService` compartido (aunque también es provider dentro de `WhatsappModule`).

---

## `src/main.ts`

**Rol:** bootstrap de NestJS (punto de entrada del servidor).

**Responsabilidades:**

- Cargar `.env` usando `dotenv`.
- Watcher con `chokidar` para recargar variables cuando cambia `.env`.
- Crear app Nest con `NestFactory.create(AppModule)`.
- Configurar:
  - `ValidationPipe` global: `whitelist`, `transform` y `enableImplicitConversion`.
  - CORS abierto (`origin: '*'`) + `exposedHeaders: ['X-PAYMENT-RESPONSE']`.
  - Swagger (`/docs`) con `extraModels: WhatsAppWebhookModels`.
- Iniciar servidor en `PORT` (default 3000).

**Métodos/funciones importantes:**

- `bootstrap()`:
  - arma toda la configuración y hace `app.listen(port)`.
- `envWatcher.on('change')`:
  - recarga `dotenv.config()` y avisa que servicios que cachean valores en constructor no se actualizan.

**Interacciones:**

- `AppModule`: módulo raíz.
- Swagger: `WhatsAppWebhookModels` desde `src/whatsapp/dto/whatsapp-webhook.dto.ts` para documentar modelos del webhook.
- Infra: `dotenv`, `chokidar`.

---

# `src/whatsapp/` (módulo principal de WhatsApp, pagos y agentes)

## `src/whatsapp/agents/adk-orchestrator.service.ts`

**Rol:** orquestador principal basado en **Google ADK** (`@google/adk`) que procesa mensajes (texto) y retorna acciones estructuradas (texto, plantilla, imagen, etc.).

**Componentes:**

- Tipos:
  - `PasatandaIntent` (con intents de negocio, p.ej. `CREATE_GROUP`, `PAY_QUOTA`, `ADD_PARTICIPANT`, etc.).
  - `OrchestrationAction`: unión discriminada con todos los tipos de salida soportados (text/image/document/template/interactivos/reaction/sticker...).
  - `OrchestrationResult`: `{ intent, actions, agentUsed, sessionState? }`.
- Clase `AdkOrchestratorService implements OnModuleInit`.

**Flujo principal (`route`)**

1. Normaliza `senderId` como `userId` (solo dígitos).
2. Construye `sessionId` (`pasatanda:<userId>`).
3. Usa `SupabaseSessionService` para `getSession` o `createSession`.
4. Construye prompt enriquecido con contexto (`buildPrompt`).
5. Ejecuta `Runner.runAsync(...)` y escucha `events` para capturar:
   - `agentUsed` (`event.author`)
   - texto final (`isFinalResponse` + `stringifyContent`).
6. Deriva intent heurístico (`detectIntent`) combinando mensaje del usuario + respuesta.
7. Convierte respuesta a acciones (`buildActions`):
   - si encuentra JSON embebido `json ...`, intenta:
     - construir template `payment_request` si detecta `paymentUrl`.
     - o construir botones si detecta `options`.
   - si detecta base64 `data:image/...;base64,...` crea acción `image`.
   - fallback: `text`.
8. Retorna `OrchestrationResult` incluyendo `sessionState` actualizado.

**Inicialización (`initializeOrchestrator`)**

- Construye modelo `Gemini` (por defecto `gemini-2.0-flash`) usando `GOOGLE_GENAI_API_KEY`.
- Crea `LlmAgent` con:
  - `tools: this.tools.allTools` (todas las funciones tool de `PasatandaToolsService`).
  - `subAgents`: `AdkGameMasterAgent`, `AdkTreasurerAgent`, `AdkValidatorAgent` (disponibles aunque el instruction dice "NO transferir").
- Crea `Runner` con `sessionService: SupabaseSessionService`.

**Interacciones:**

- `SupabaseSessionService`: persistencia de sesiones ADK.
- `PasatandaToolsService`: ejecuta acciones reales (crear grupo, pagos, etc.).
- `adk-subagents.ts`: aporta sub-agentes (especializados).
- Consumido por `WhatsappService.handleWithAdkOrchestrator()`.

---

## `src/whatsapp/agents/adk-subagents.ts`

**Rol:** define 3 sub-agentes ADK especializados, cada uno un `LlmAgent` con subset de tools.

**Clases:**

- `AdkGameMasterAgent`
  - Tools: `create_pasatanda_group`, `add_participant_to_group`, `configure_tanda`, `check_group_status`, `get_user_info`.
- `AdkTreasurerAgent`
  - Tools: `create_payment_link`, `verify_payment_proof`, `get_user_info`.
- `AdkValidatorAgent`
  - Tools: `verify_payment_proof`.

**Interacciones:**

- `PasatandaToolsService`: fuente de tools.
- `ConfigService`: lee `GOOGLE_GENAI_API_KEY`.
- Los agentes pueden ser usados como subAgents en `AdkOrchestratorService`.

---

## `src/whatsapp/agents/game-master.agent.ts`

**Rol:** agente determinista (no-ADK) para operaciones de grupos/tandas.

**Clase:** `GameMasterAgentService`.

**Métodos importantes:**

- `handleCreateGroup({ phoneNumberId, sender, payload })`
  - Arma `subject`.
  - Deduplica `participants`.
  - Crea grupo en WhatsApp vía `GroupService.createGroup(phoneNumberId, { subject, participants })`.
  - Crea usuario y grupo DRAFT en DB usando `GroupCreationService`.
  - Crea membership admin.
  - Retorna `RouterAction[]` con texto de confirmación.
- `handleStartTanda({ sender, groupId, ... })`
  - Busca el grupo en DB (`groups` + `memberships` + `users`).
  - Valida: existe, no tiene contrato, `sender` es admin.
  - Busca última `payment_orders` DRAFT para inferir montos.
  - Actualmente devuelve placeholder: "Inicio de tanda aún no está disponible...".
- `handleCheckStatus({ groupId })`
  - Lee `groups` por `group_whatsapp_id` o `id`.
  - Retorna un resumen en texto.

**Interacciones:**

- `SupabaseService`: queries a `groups`, `memberships`, `users`, `payment_orders`.
- `GroupService`: llamadas a WhatsApp Groups API.
- `GroupCreationService`: upsert de usuario + draft group + membership.

---

## `src/whatsapp/agents/pasatanda-tools.service.ts`

**Rol:** catálogo de **Function Tools** para ADK; es el "puente" entre LLM y operaciones reales.

**Principales tools (getters):**

- `create_pasatanda_group`
  - Intenta crear grupo en WhatsApp (si existe `WHATSAPP_PHONE_NUMBER_ID`/`PHONE_NUMBER_ID`).
  - Crea usuario (DB) y grupo (DB) en estado `DRAFT`.
  - Crea membership admin.
- `add_participant_to_group`
  - Busca grupo por `group_whatsapp_id` o `id`.
  - Upsert usuario para participante.
  - Inserta `memberships` con siguiente `turn_number`.
- `configure_tanda`
  - Update parcial en `groups` (`amount`, `frequency_days`, `yield_enabled`).
- `check_group_status`
  - Lee grupo y miembros (join `memberships` + `users`).
- `create_payment_link`
  - Crea `payment_orders` y negocia con payment backend (`PaymentIntegrationService.negotiatePayment`).
  - Guarda `xdr_challenge`/`qr_payload_url` y marca `CLAIMED_BY_USER`.
  - Retorna `paymentUrl`, `qrBase64` y `templateData`.
- `verify_payment_proof`
  - Envía `proofMetadata` al payment backend (`verifyFiat`).
  - Actualiza `payment_orders` a `VERIFIED` o `REJECTED`.
- `get_user_info`
  - Busca `users` por teléfono.
  - Lista grupos por memberships.

**Otros miembros:**

- `allTools`: retorna el array completo de tools.

**Interacciones:**

- `ConfigService`: lee `MAIN_PAGE_URL`, `WHATSAPP_PHONE_NUMBER_ID`.
- `SupabaseService`: tablas `groups`, `memberships`, `users`, `payment_orders`.
- `GroupService`: crea grupos en WhatsApp.
- `GroupCreationService`: lógica consistente de user/group/membership.
- `PaymentIntegrationService`: negociación y verificación de pagos.

---

## `src/whatsapp/agents/treasurer.agent.ts`

**Rol:** agente determinista de pagos (link/QR + verificación de comprobantes).

**Métodos importantes:**

- `handlePaymentRequest({ sender, payload })`
  - Crea `payment_orders` en DB.
  - Llama `PaymentIntegrationService.negotiatePayment`.
  - Actualiza orden con challenge/qr y marca `CLAIMED_BY_USER`.
  - Retorna acciones:
    - texto con link (`MAIN_PAGE_URL/pagos/<orderId>`)
    - imagen con QR si existe `qrBase64`.
- `handleProofUpload({ orderId, proofMetadata })`
  - Verifica fiat con `PaymentIntegrationService.verifyFiat`.
  - Actualiza `payment_orders` a `VERIFIED` o `REJECTED`.
  - Retorna mensaje éxito/falla.
- `handleWebhookSettlement(orderId)`
  - Marca orden `COMPLETED`.
  - Retorna confirmación.

**Interacciones:**

- `SupabaseService` (`payment_orders`).
- `PaymentIntegrationService`.
- Consumido por:
  - `PaymentOrdersController` (claim fiat),
  - `PaymentWebhookController` (settlement),
  - `PaymentProxyController` (settlement tras OK),
  - `PasatandaOrchestratorService` (orquestador legacy).

---

## `src/whatsapp/agents/validator.agent.ts`

**Rol:** placeholder determinista para flow de comprobantes.

**Método:**

- `handleUploadProof(messageId)` retorna un mensaje solicitando comprobante legible.

**Interacciones:**

- Consumido por `PasatandaOrchestratorService` en intent `UPLOAD_PROOF`.

---

## `src/whatsapp/dto/meta-catalog.dto.ts`

**Rol:** tipos TS (interfaces) para sincronización de catálogo/inventario con Meta.

**Estructura:**

- `MetaProductItem`, `MetaBatchRequest`, `MetaBatchResponse`.
- `MetaCatalogProduct`, `MetaCatalogListResponse`.
- `SyncInventoryResult`.

**Interacciones:**

- Normalmente usado por servicios que integran con el catálogo (no se observa consumo directo en los archivos leídos, pero está diseñado para `Meta Catalog API`).

---

## `src/whatsapp/dto/payment-webhook.dto.ts`

**Rol:** DTO (Nest + class-validator) para webhooks del backend de pagos (eventos QR y verificación).

**Componentes:**

- `PaymentWebhookEventEnum` + `PaymentWebhookEvent`.
- `PaymentWebhookDto`:
  - `event_type`, `order_id`, opcionales: `company_id`, `qr_image_base64`, `mime_type`, `success`, `ref`, `timestamp`.
- `PaymentWebhookAction` (interface): describe acciones a ejecutar tras webhook.

**Interacciones:**

- Pensado para controllers de webhook/pagos (no es el `x402-webhook` actual, sino un webhook alterno).

---

## `src/whatsapp/dto/send-image-message.dto.ts`

**Rol:** DTO para endpoint auxiliar de envío de imagen por WhatsApp.

**Campos:**

- `to`, `imageUrl`, `caption?`.

**Interacciones:**

- Usable por controladores auxiliares (no aparece un controlador específico en el snapshot de `src/whatsapp/*`, pero es un patrón típico).

---

## `src/whatsapp/dto/send-template-message.dto.ts`

**Rol:** DTO para envío de mensajes por plantilla.

**Campos:**

- `to`, `templateName`, `languageCode?`, `components?`.

---

## `src/whatsapp/dto/send-text-message.dto.ts`

**Rol:** DTO para envío de texto simple.

**Campos:**

- `to`, `message`.

---

## `src/whatsapp/dto/whatsapp-webhook.dto.ts`

**Rol:** DTOs fuertemente tipados para documentar y validar payload del webhook de WhatsApp (Swagger + class-validator).

**Estructura:**

- Árbol completo de modelos (`WhatsAppWebhookDto` → `entry[]` → `changes[]` → `value` → `messages[]|statuses[]`).
- Incluye modelos para:
  - `metadata`, `contacts`, `text`, `media` (image/video/audio/document), `location`, `interactive`, `context`, `referral`, `errors`, `statuses`.
- Exporta `WhatsAppWebhookModels` para registrar en Swagger (`extraModels` en `main.ts`).

**Interacciones:**

- `main.ts`: agrega modelos a Swagger.
- `WhatsappController.receiveWebhook`: recibe body genérico pero lo normaliza a `WhatsAppMessage` (interface). Este DTO es principalmente para documentación/validación en Swagger.

---

## `src/whatsapp/dto/x402-webhook.dto.ts`

**Rol:** DTOs de eventos x402 provenientes del backend de pagos.

**Clases:**

- `X402WebhookDto`:
  - `jobId`, `event` (conjunto permitido), opcionales: `orderId`, `success`, `type`, `transaction`, `network`, `chainId`, `payer`, `errorReason`.
- `PaymentConfirmationDto`:
  - `orderId`, opcionales: `paymentMethod`, `transactionId`.

**Interacciones:**

- Consumido por `PaymentWebhookController`:
  - `POST /webhook/x402/result` y `POST /webhook/payment/confirm`.

---

## `src/whatsapp/interfaces/whatsapp.interface.ts`

**Rol:** interfaces TS que representan el payload de WhatsApp Cloud API para runtime.

**Incluye:**

- `WhatsAppMessage`, `WhatsAppEntry`, `WhatsAppChange`, `WhatsAppValue`, `WhatsAppMetadata`.
- `WhatsAppIncomingMessage` con union de tipos (`text`, `image`, `interactive`, etc.) y subestructuras (`context`, `referral`, `errors`).
- `WhatsAppStatus`.
- `SendMessageDto` (payload saliente simplificado).

**Interacciones:**

- `WhatsappController.normalizeWebhookPayload()` castea payload a `WhatsAppMessage`.
- `WhatsappService.processIncomingMessage()`/`handleMessage()` usa `WhatsAppIncomingMessage`/`WhatsAppStatus`.

---

## `src/whatsapp/payment-orders.controller.ts`

**Rol:** endpoints REST para inspección/claim de órdenes de pago (`/api/orders`).

**Rutas:**

- `GET /api/orders/:id`
  - Lee `payment_orders` desde DB y retorna estado y metadata.
- `POST /api/orders/:id/claim`
  - Body `ClaimOrderDto` con `paymentType: 'fiat'|'crypto'`.
  - Fiat:
    - Requiere `proofMetadata`.
    - Actualiza orden a `PENDING_CONFIRMATION`.
    - Llama `TreasurerAgentService.handleProofUpload`.
  - Crypto:
    - Requiere `xPayment`.
    - Llama `PaymentIntegrationService.forwardCrypto`.
    - Marca orden `CONFIRMED` o `REJECTED`.

**Interacciones:**

- `SupabaseService` (`payment_orders`).
- `PaymentIntegrationService` (forward crypto).
- `TreasurerAgentService` (verificación fiat).

---

## `src/whatsapp/payment-proxy.controller.ts`

**Rol:** proxy `GET /api/pay` hacia `PAYMENT_BACKEND_URL/api/pay`.

**Responsabilidades principales:**

- Reenviar query params y header `X-PAYMENT`.
- Decodificar `X-PAYMENT` (base64 JSON) para extraer `orderId/details` si existen.
- Ajustar payload para compatibilidad x402 (remueve `orderId/details` si vienen embebidos junto con `x402Version/payload`).
- Copiar de vuelta header `X-PAYMENT-RESPONSE` al cliente.
- Si el backend responde `200 OK` y hay indicios de orden, dispara `TreasurerAgentService.handleWebhookSettlement()` y luego envía acciones (texto/imagen) por WhatsApp.

**Métodos internos importantes:**

- `buildTargetUrl(query)`
- `handleSuccessfulPayment(orderId?, details?)`
- `decodeXPayment(header)`
- `extractQueryParam(query, key)`
- `dispatchActions(actions)` (usa `WhatsappService.sendTextMessage/sendImageFromBase64`)

**Interacciones:**

- `HttpService` (Nest) para proxy HTTP.
- `ConfigService` (`PAYMENT_BACKEND_URL`).
- `TreasurerAgentService` para settlement.
- `WhatsappService` para ejecutar acciones de salida.

---

## `src/whatsapp/payment-webhook.controller.ts`

**Rol:** endpoints webhook para eventos del backend de pagos (x402 y confirmación desde frontend).

**Rutas:**

- `POST /webhook/x402/result` (`X402WebhookDto`)
  - Llama `TreasurerAgentService.handleWebhookSettlement(payload.jobId || payload.orderId)`.
  - Despacha acciones con `WhatsappService`.
- `POST /webhook/payment/confirm` (`PaymentConfirmationDto`)
  - Llama `TreasurerAgentService.handleWebhookSettlement(payload.orderId)`.
  - Envía acciones tipo texto.

**Interacciones:**

- `TreasurerAgentService`.
- `WhatsappService`.

---

## `src/whatsapp/services/adk-session.service.ts`

**Rol:** persistencia y actualización de “sesión” (contexto) para un enfoque legacy/alterno (tabla `public.adk_sessions`), diferente al session service oficial de ADK.

**Métodos importantes:**

- `loadSession(companyId, companyName, senderId, role)`
  - Construye `sessionId` (`companyId:<digits(senderId)>`).
  - Intenta `fetchSession` desde Supabase, si no existe crea contexto base.
  - Mergea contexto y persiste.
- `recordInteraction({ session, intent, sanitized })`
  - Actualiza campos `last_intent`, `last_user_text`, `tokens`.

**Interacciones:**

- `SupabaseService` (`public.adk_sessions`).
- Tipos de `whatsapp.types.ts` (`AdkSessionSnapshot`, `Intent`, `SanitizedTextResult`, `UserRole`).

---

## `src/whatsapp/services/encryption.service.ts`

**Rol:** cifrado/descifrado de payloads sensibles (p.ej. tokens) con AES-256-GCM.

**Comportamiento:**

- Si no existe `GOOGLE_OAUTH_ENCRYPTION_KEY` o `ENCRYPTION_SECRET`, opera en modo passthrough (no cifra).
- `encrypt(payload)`:
  - genera `iv` de 12 bytes,
  - cifra JSON,
  - retorna `{ iv, tag, value }` base64.
- `decrypt(payload)`:
  - detecta estructura `{iv,tag,value}` y descifra.

**Interacciones:**

- `ConfigService`: lectura de secretos.
- Consumible por servicios que persistan tokens (en snapshot actual no se ve conexión directa, pero es infraestructura).

---

## `src/whatsapp/services/frontend-webhook.service.ts`

**Rol:** notificar al frontend web que la verificación de teléfono se confirmó.

**Método principal:**

- `sendVerificationConfirmation(payload)`
  - Construye URL: `<FRONTEND_WEBHOOK_URL|NEXT_PUBLIC_FRONTEND_URL|MAIN_PAGE_URL>/api/webhook/confirm_verification`.
  - Si `WEBHOOK_SECRET` existe, firma el body con HMAC-SHA256 en header `x-signature`.
  - Best-effort: logs y no lanza error fatal.

**Interacciones:**

- `HttpService`.
- `ConfigService`.
- Consumido por `WhatsappService` cuando detecta OTP exitoso.

---

## `src/whatsapp/services/gemini.service.ts`

**Rol:** wrapper de inicialización y uso de Gemini vía ADK (`Gemini`), soportando API Key o Vertex AI.

**Inicialización (`onModuleInit`)**

- Lee:
  - `GOOGLE_GENAI_MODEL` (default `gemini-2.5-flash-lite`),
  - `GOOGLE_GENAI_API_KEY`,
  - `GOOGLE_GENAI_USE_VERTEXAI`,
  - `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`.
- Si no hay credenciales, queda deshabilitado y retorna `null` en llamadas.

**Métodos:**

- `getModel()` / `isEnabled()`.
- `generateText(prompt)`:
  - genera contenido iterando `generateContentAsync`.
- `generateChatResponse(history, prompt)`:
  - arma `contents` con historial y prompt.

**Interacciones:**

- Puede ser usado para lógica generativa fuera del orquestador ADK (en este snapshot no se ve consumo directo, pero está registrado como provider en `WhatsappModule`).

---

## `src/whatsapp/services/google-oauth.service.ts`

**Rol:** utilidades de OAuth2 para Google (construir consent URL y exchange code).

**Métodos:**

- `isEnabled()`.
- `buildConsentUrl(state)`:
  - serializa `state` a base64url y lo coloca en parámetro `state`.
- `exchangeCode(code)`:
  - intercambia code por tokens usando `OAuth2Client.getToken`.

**Interacciones:**

- `ConfigService`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_OAUTH_SCOPES`.

---

## `src/whatsapp/services/group.service.ts`

**Rol:** wrapper de llamadas a **WhatsApp Groups API** (Graph API) para crear/gestionar grupos.

**Métodos:**

- `createGroup(phoneNumberId, { subject, participants })` → `POST /<phoneNumberId>/groups`.
- `addParticipants(phoneNumberId, groupId, participants)` → `POST /<groupId>/participants`.
- `removeParticipants(phoneNumberId, groupId, participants)` → `DELETE /<groupId>/participants`.
- `updateSubject(groupId, subject)`.
- `updateDescription(groupId, description)`.
- `setAdmins(groupId, admins)` → `POST /<groupId>/admins`.

**Interacciones:**

- `HttpService` hacia `https://graph.facebook.com/<version>/...`.
- `META_API_TOKEN`.
- Consumido por `GameMasterAgentService` y `PasatandaToolsService`.

---

## `src/whatsapp/services/orders-sync.service.ts`

**Rol:** sincroniza órdenes de pago `PaymentOrder` (modelo interno) hacia tabla `public.orders`.

**Métodos:**

- `syncDraft(order)`:
  - valida supabase enabled, que exista `amount`.
  - mapea `PaymentState` → string `order_status`.
  - upsert por `(company_id, details)`.
  - guarda metadata: `client_phone`, `details`, `payment_job_id`, `payment_url`, `referred_*`.
- `updateStatus(order)`:
  - actualiza `status` y mergea metadata.
- `findByX402JobId(jobId)`:
  - busca por `metadata->>'x402_job_id'` (nota: la metadata real guardada usa `payment_job_id`; esto puede ser legacy).

**Interacciones:**

- `SupabaseService`.
- Tipos `PaymentOrder`/`PaymentState` de `whatsapp.types.ts`.

---

## `src/whatsapp/services/pasatanda-orchestrator.service.ts`

**Rol:** orquestador “legacy” que clasifica intents con Gemini (ADK `InMemoryRunner`) y delega en agentes deterministas.

**Métodos:**

- `route(context)`:
  - obtiene `phoneNumberId`.
  - `classify(context)` (Gemini) → `{ intent, entities, confidence }`.
  - `switch(intent)` delega a:
    - `TreasurerAgentService.handlePaymentRequest`
    - `GameMasterAgentService.handleCheckStatus/handleCreateGroup/handleStartTanda`
    - `ValidatorAgentService.handleUploadProof`
  - fallback: mensaje de ayuda.
- `classify(context)`:
  - ejecuta runner y parsea JSON; si falla retorna `UNKNOWN`.

**Interacciones:**

- `GameMasterAgentService`, `TreasurerAgentService`, `ValidatorAgentService`.
- `ConfigService` (`GOOGLE_GENAI_API_KEY`, `WHATSAPP_PHONE_NUMBER_ID`).

> Nota: en el flujo actual, `WhatsappService` usa `AdkOrchestratorService` (no este orquestador legacy), por lo que este servicio parece ser legado/alterno.

---

## `src/whatsapp/services/payment-client.service.ts`

**Rol:** stub/compatibilidad temporal. El cliente legacy fue eliminado.

**Interacciones:**

- Ninguna (no contiene métodos).

---

## `src/whatsapp/services/payment-integration.service.ts`

**Rol:** cliente HTTP hacia `PAYMENT_BACKEND_URL` para negociar/verificar pagos vía `/api/pay`.

**Métodos:**

- `negotiatePayment({ orderId, amountUsd, payTo, details?, resource? })`
  - Hace `GET /api/pay` con query params.
  - Interpreta respuesta flexible:
    - `jobId` (`jobId|job_id|jobID`)
    - `accepts` (`accepts|payments`)
    - `qrBase64` (`qr_image_base64|qrBase64|qr_payload_url`)
    - `challenge` (`xdr|challenge|xdr_challenge`).
- `verifyFiat({ orderId, proofMetadata, jobId? })`
  - Construye `X-PAYMENT` base64 JSON (`{ x402Version: 1, type: 'fiat', payload: proofMetadata }`).
  - Hace `GET /api/pay` y decide `success` por status 200.
- `forwardCrypto({ orderId, xPayment })`
  - Reenvía `X-PAYMENT` tal cual.

**Interacciones:**

- `HttpService`.
- `ConfigService` (`PAYMENT_BACKEND_URL`, `PAYMENT_API_KEY`).
- Consumido por `TreasurerAgentService`, `PasatandaToolsService`, `PaymentOrdersController`, `PaymentProxyController`.

---

## `src/whatsapp/services/payment-warmup.service.ts`

**Rol:** stub obsoleto para evitar referencias a warmup legacy.

---

## `src/whatsapp/services/pinata.service.ts`

**Rol:** subir imágenes base64 a Pinata/IPFS para obtener URL pública (requisito para ciertos mensajes de WhatsApp, p.ej. header image en CTA).

**Métodos:**

- `isEnabled()`.
- `uploadImageFromBase64(base64Data, filename?)`:
  - arma `FormData`, adjunta metadata.
  - usa `PINATA_JWT` o `PINATA_API_KEY/PINATA_API_SECRET`.
  - retorna URL `https://gateway.pinata.cloud/ipfs/<hash>`.
- `getPublicUrl(ipfsHash)`.

**Interacciones:**

- `HttpService` hacia `https://api.pinata.cloud/pinning/pinFileToIPFS`.
- Consumido por `WhatsappService.dispatchAdkAction()` (para base64→URL).

---

## `src/whatsapp/services/sanitization.service.ts`

**Rol:** sanitizar texto para remover PII antes de mandarlo a modelos/almacenamiento, reemplazando por placeholders.

**Método:**

- `sanitize(text)`:
  - aplica regex para `phone`, `email`, `address`, `name`.
  - produce `SanitizedTextResult`: `sanitizedText`, `normalizedText` (lowercase + sin diacríticos), `tokens`.

**Interacciones:**

- Tipos `SanitizationToken`/`SanitizedTextResult` de `whatsapp.types.ts`.

---

## `src/whatsapp/services/soroban-client.service.ts`

**Rol:** cliente HTTP hacia endpoints Soroban (via Payment backend) para operaciones on-chain.

**Métodos:**

- `createGroup({ members, admin, amountStroops, frequencyDays, yieldEnabled?, yieldShareBps? })`
  - `POST /api/soroban/groups`.
- `payout(groupAddress, winner)`
  - `POST /api/soroban/groups/:address/payout`.
- `sweepYield(groupAddress)`
  - `POST /api/soroban/groups/:address/sweep-yield`.

**Interacciones:**

- `HttpService`.
- `PAYMENT_BACKEND_URL`, `PAYMENT_API_KEY`.

---

## `src/whatsapp/services/supabase-session.service.ts`

**Rol:** implementación de `BaseSessionService` de ADK con Supabase (tabla `adk_sessions`), con fallback en memoria.

**Métodos importantes:**

- `createSession({ appName, userId, sessionId, state })`
  - guarda en Supabase (upsert) y siempre en memoria.
- `getSession({ appName, userId, sessionId, config })`
  - lee Supabase; si falla, usa memoria.
  - aplica `config` (recent events/afterTimestamp).
- `listSessions({ appName, userId })`
- `deleteSession({ sessionId })`
- `appendEvent({ session, event })`
  - llama `super.appendEvent`.
  - limpia `temp:*` del estado (defensa) y persiste eventos/estado.

**Interacciones:**

- `SupabaseService`.
- `AdkOrchestratorService` lo usa como storage oficial de sesiones.

---

## `src/whatsapp/services/supabase.service.ts`

**Rol:** wrapper de Postgres (`pg.Pool`) configurable para Supabase/Postgres.

**Comportamiento:**

- Resuelve cadena de conexión desde:
  - `SUPABASE_DB_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`.
- Configura pool (`SUPABASE_DB_POOL_SIZE`).
- TLS/SSL:
  - opcional CA via `SUPABASE_DB_CA_CERT` / `SUPABASE_DB_CA_BASE64` / `SUPABASE_DB_CA_FILE`.
  - `SUPABASE_DB_ALLOW_SELF_SIGNED`.

**Métodos:**

- `isEnabled()`.
- `query(sql, params?)` retorna `rows`.
- `onModuleDestroy()` cierra pool.

**Interacciones:**

- Consumido por la mayoría de servicios/agentes: `GroupCreationService`, `OrdersSyncService`, `SupabaseSessionService`, etc.

---

## `src/whatsapp/services/verification.service.ts`

**Rol:** capa de verificación OTP en runtime de WhatsApp.

**Métodos:**

- `issueCode(phone)` delega a `GroupCreationService.requestVerification`.
- `confirmCode(phone, code, whatsappUsername?)`:
  - llama `GroupCreationService.verifyCode`.
  - si ok, llama `GroupCreationService.confirmVerification`.
- `isVerified(phone)`.
- `tryConfirmFromMessage(phone, text, whatsappUsername?)`:
  - extrae código del mensaje usando delimitadores `~* ... ~*` o `~* ... *~`.
  - confirma.

**Interacciones:**

- `GroupCreationService` (persistencia OTP + metadata).
- Consumido por `WhatsappService.handleTextMessage()` (antes de pasar al orquestador).

---

## `src/whatsapp/services/whatsapp-messaging.service.ts`

**Rol:** servicio tipado para enviar mensajes por WhatsApp Cloud API (texto, imagen, video, audio, documentos, interactivos, templates, etc.).

**Métodos públicos principales:**

- `sendText`, `sendImage`, `sendDocument`, `sendVideo`, `sendAudio`, `sendSticker`.
- `sendLocation`, `sendContacts`.
- `sendInteractiveButtons`, `sendInteractiveList`.
- `sendProduct`, `sendProductList`.
- `sendTemplate`.
- `sendPaymentRequest` (plantilla específica `payment_request` con componentes header/body/button).
- `sendReaction`.
- `markAsRead`.
- `uploadMedia(buffer, mimeType, filename)` → `POST /<id>/media`.

**Interacciones:**

- `HttpService`.
- `ConfigService` (`WHATSAPP_API_VERSION`, `META_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`).
- Consumido por `WhatsappService.dispatchAdkAction()`.

---

## `src/whatsapp/services/x402-payment-client.service.ts`

**Rol:** stub/compatibilidad de tipos para cliente x402 legacy.

**Incluye:**

- Interfaces `X402AcceptOption`, `X402NegotiationResponse`, `X402SettlementResponse`.
- Clase vacía `X402PaymentClientService`.

---

## `src/whatsapp/whatsapp.controller.ts`

**Rol:** controlador del webhook oficial de WhatsApp (`/webhook`).

**Rutas:**

- `GET /webhook`:
  - Verificación de suscripción (`hub.mode`, `hub.verify_token`, `hub.challenge`).
  - Delegado en `WhatsappService.verifyWebhook()`.
- `POST /webhook`:
  - Recibe eventos entrantes.
  - Normaliza payload (producción vs payload de prueba de Meta) con `normalizeWebhookPayload`.
  - Llama `WhatsappService.processIncomingMessage()`.
  - Responde `{ status: 'success' }` o `{ status: 'error' }` (responde 200 igual para no perder reintentos).

**Interacciones:**

- `WhatsappService`.
- Tipos `WhatsAppMessage` (runtime interface).

---

## `src/whatsapp/whatsapp.module.ts`

**Rol:** módulo NestJS que agrupa controllers, servicios de infraestructura, agentes y orquestadores.

**Controllers registrados:**

- `WhatsappController`, `PaymentWebhookController`, `PaymentProxyController`, `PaymentOrdersController`.

**Providers registrados (principales):**

- Core:
  - `WhatsappService`, `SupabaseService`, `GeminiService`, `PinataService`, `EncryptionService`.
- Agentes:
  - `GameMasterAgentService`, `TreasurerAgentService`, `ValidatorAgentService`.
- ADK:
  - `SupabaseSessionService`, `PasatandaToolsService`, `AdkGameMasterAgent`, `AdkTreasurerAgent`, `AdkValidatorAgent`, `AdkOrchestratorService`.
- Mensajería:
  - `WhatsAppMessagingService`.
- Servicios negocio:
  - `PaymentIntegrationService`, `SorobanClientService`, `GroupService`, `VerificationService`, `FrontendWebhookService`.

**Exports:**

- `WhatsappService`, `WhatsAppMessagingService`, `AdkOrchestratorService`.

**Interacciones:**

- Importa `HttpModule`, `ConfigModule`, y `forwardRef(() => OnboardingModule)`.

---

## `src/whatsapp/whatsapp.service.ts`

**Rol:** servicio central de WhatsApp:

- verifica webhook,
- procesa payload entrante,
- deduplica mensajes,
- decide cómo responder (verificación OTP vs orquestador ADK),
- implementa envío de mensajes (texto/imagen/template/cta url), descarga de media.

**Dependencias:**

- `ConfigService`, `HttpService`.
- `AdkOrchestratorService`: orquestación principal.
- `PinataService`: base64→URL pública.
- `VerificationService`: OTP.
- `FrontendWebhookService`: notificación al frontend.
- `WhatsAppMessagingService`: envío tipado (acciones ADK).

**Flujos principales:**

- `verifyWebhook(mode, token, challenge)`
  - compara con `WHATSAPP_VERIFY_TOKEN`.
- `processIncomingMessage(body)`
  - valida objeto `whatsapp_business_account`.
  - recorre `entry[]/changes[]`.
  - procesa `messages[]`:
    - resuelve `contactWaId`/`contactName`.
    - `handleMessage(message, phoneNumberId, contactWaId, contactName)`.
  - procesa `statuses[]` con `handleMessageStatus`.
- `handleMessage(...)`
  - deduplicación por `message.id` (`processedMessageCache` + TTL).
  - marca como leído (`markAsRead`).
  - switch por tipo:
    - `text` → `handleTextMessage`.
    - `image/video/audio/document` → `handleMediaMessage` (actualmente responde pidiendo instrucción textual).
    - `location` → `handleLocationMessage`.
    - `interactive` → `handleInteractiveMessage`.
    - `button` → `handleButtonMessage`.
- `handleTextMessage(...)`
  - intenta confirmar OTP desde el texto (`VerificationService.tryConfirmFromMessage`).
  - si verifica:
    - notifica al FE (`FrontendWebhookService.sendVerificationConfirmation`).
    - responde por WhatsApp.
  - si parece OTP pero no coincide, evita pasar a LLM.
  - caso normal: `handleWithAdkOrchestrator(...)`.
- `handleWithAdkOrchestrator(...)`
  - llama `adkOrchestrator.route(...)`.
  - despacha cada `OrchestrationAction` con `dispatchAdkAction`.
- `dispatchAdkAction(...)`
  - usa `WhatsAppMessagingService` para `text`, `template`, `interactive_*`, etc.
  - para `image` base64:
    - intenta subir a Pinata para URL pública; si falla, hace upload directo a Meta (`uploadMedia`).

**Envío (API pública usada por otros componentes):**

- `sendTextMessage`, `sendImageMessage`, `sendImageMessageFromUrl`, `sendImageFromBase64`, `sendVideoMessage`, `sendDocumentMessage`, `sendTemplateMessage`.
- `sendInteractiveCtaUrlMessage` y `sendInteractiveCtaUrlWithQr` (usa Pinata, porque WhatsApp requiere URL pública para header).
- `downloadMedia(mediaId)`.

**Interacciones:**

- Controllers:
  - `WhatsappController` usa `verifyWebhook` y `processIncomingMessage`.
  - `PaymentProxyController`/`PaymentWebhookController`/`GroupCreationController` usan métodos de envío.
- Infra externa:
  - WhatsApp Graph API (`/messages`, `/media`, `/<mediaId>`).
  - Pinata.
- Variables de entorno clave:
  - `WHATSAPP_API_VERSION`, `META_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID|PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`.

---

## `src/whatsapp/whatsapp.types.ts`

**Rol:** tipos compartidos para intents/roles/estado de pago y modelos de orquestación.

**Incluye:**

- `UserRole`, `Intent` (legacy), `PasatandaIntent` (subset), `PaymentState`.
- Sanitización: `SanitizationToken`, `SanitizedTextResult`.
- Sesión: `AdkSessionSnapshot`.
- Contexto de orquestación: `RouterMessageContext`.
- Acciones y respuesta:
  - `RouterAction` (actualmente solo `text` e `image`),
  - `AgentResponse`, `RouterResult`.
- Pagos x402:
  - `X402NegotiationData`, `X402SettlementData`.
- `PaymentOrder` (modelo interno para tracking) y `ChatHistoryItem`.

**Interacciones:**

- Consumido ampliamente por servicios (orquestación, orders-sync, whatsapp.service, etc.).

---
