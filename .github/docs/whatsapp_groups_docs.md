# Contexto Técnico: Integración de WhatsApp Groups API (Cloud API)

## 1. Alcance de la Implementación
El objetivo es extender las capacidades del **Agent Backend (AgentBE)** para gestionar programáticamente los grupos de chat donde ocurre el juego del Pasanaku.
Actualmente, el envío de mensajes individuales (1 a 1) y webhooks ya está configurado. Esta sección se enfoca **exclusivamente en la gestión de Grupos**.

**Responsable:** El agente `GameMasterAgent` será el principal consumidor de estos endpoints para orquestar la creación y actualización de los grupos de juego.

## 2. Documentación Oficial de Referencia (Meta)
Para la implementación, el LLM debe basarse estrictamente en la especificación REST de la **WhatsApp Business Cloud API**.

* **Referencia General de Grupos:**
    [https://developers.facebook.com/docs/whatsapp/cloud-api/reference/groups](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/groups)
    *(Esta es la fuente de verdad para todos los endpoints relacionados con grupos).*

* **Códigos de Error y Debugging:**
    [https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes)

## 3. Requerimientos Funcionales (Mapeo a API)

El servicio `GroupManagerService` debe implementar métodos para cubrir las siguientes necesidades del negocio, utilizando los endpoints HTTP documentados en el enlace anterior:

### A. Creación de Grupos (Inicio de Tanda)
* **Acción:** El bot debe poder crear un nuevo grupo cuando una Tanda pasa de "Configuración" a "Activa".
* **Datos requeridos:** Título del grupo (ej: "Pasanaku Enero"), y participantes iniciales (al menos uno adicional al admin/bot).
* **Permisos:** El bot debe quedar configurado como Administrador del grupo automáticamente.

### B. Gestión de Participantes (Membresía)
* **Añadir Participantes:** Cuando un usuario acepta la invitación, el bot debe agregarlo al grupo existente.
* **Eliminar Participantes:** Si un usuario abandona la tanda o es expulsado por falta de pago, el bot debe removerlo del grupo.
* **Documentación relevante:** Buscar en la referencia los métodos para `participants`.

### C. Actualización de Metadatos (Estado del Juego)
* **Cambiar Asunto (Subject):** El bot actualizará el nombre del grupo para reflejar el estado de la ronda.
    * *Ejemplo:* De "Pasanaku Enero" -> "Ronda 2: Turno de Juan".
* **Cambiar Descripción:** El bot debe poder actualizar la descripción del grupo con las reglas básicas o la fecha del próximo pago.

### D. Gestión de Administradores
* **Promover/Dismiss:** Capacidad para otorgar permisos de administrador a usuarios humanos confiables (ej: el creador de la tanda) o revocar permisos.

## 4. Consideraciones de Implementación para el LLM
1.  **Límites de la API:** Revisa la documentación para entender los límites de participantes y frecuencia de actualizaciones del "Subject" del grupo.
2.  **Webhooks de Grupos:** Asegúrate de que el controlador de Webhooks existente (configurado con Google ADK) esté preparado para recibir eventos de tipo `groups` (cambios en el nombre, participantes que salen, etc.), no solo `messages`.
3.  **Client Wrapper:** Crea una clase/servicio `GroupService` que encapsule las llamadas `axios` o `fetch` a estos endpoints, manejando la autenticación (Bearer Token) igual que en el servicio de mensajería actual.