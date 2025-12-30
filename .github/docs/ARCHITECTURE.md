graph TD
    %% Estilos
    classDef meta fill:#e0f2f1,stroke:#004d40,stroke-width:2px;
    classDef google fill:#e8eaf6,stroke:#1a237e,stroke-width:2px;
    classDef logic fill:#fff3e0,stroke:#e65100,stroke-width:2px;
    classDef db fill:#eeeeee,stroke:#333,stroke-dasharray: 5 5;

    %% Actores Externos
    User((Usuario WSP))
    MetaAPI[Meta WhatsApp Cloud API]
    PayBE[Payment Backend]
    
    %% Google Cloud / AI Ecosystem
    subgraph Google_Gemini_Ecosystem [Google AI SDK]
        GeminiFlash[✨ Gemini 1.5 Flash - Chat/Intent]
        GeminiVision[👁️ Gemini 1.5 Pro - Vision/OCR]
    end
    class GeminiFlash,GeminiVision google;

    %% Backend Principal
    subgraph Agent_Backend [Agent Backend Node.js]
        
        %% Entrada
        Webhook[Webhook Endpoint POST /webhook]
        
        %% Orchestrator con IA
        subgraph AI_Orchestrator [Capa de Inteligencia]
            ContextManager[Gestor de Contexto Historial]
            IntentRouter[Router de Intenciones]
        end

        %% Agentes Deterministas (Ejecutores)
        subgraph Deterministic_Agents [Agentes Ejecutores]
            GameAgent[🎮 Game Master Rules]
            TreasuryAgent[💰 Treasurer Logic]
        end
        class GameAgent,TreasuryAgent logic;
        
        %% Respuesta
        ResponseBuilder[Generador de Respuesta]
    end
    class Webhook meta;

    %% Flujos
    User -->|Mensaje Texto/Imagen| MetaAPI
    MetaAPI -->|POST Payload| Webhook
    
    Webhook -->|Raw Text| ContextManager
    ContextManager -->|Prompt + Historial| GeminiFlash
    GeminiFlash -->|JSON: Intent + Entities| IntentRouter

    %% Ruteo segun intencion
    IntentRouter -->|Case: CONSULTA_JUEGO| GameAgent
    IntentRouter -->|Case: INTENCION_PAGO| TreasuryAgent
    
    %% Flujo de Vision (Comprobante)
    Webhook -->|Image URL| GeminiVision
    GeminiVision -->|JSON: Monto/Fecha/Ref| TreasuryAgent
    
    %% Ejecucion y Respuesta
    TreasuryAgent -->|Verificar/Crear Orden| PayBE
    GameAgent -->|Consultar Estado| DB[(PostgreSQL)]
    
    TreasuryAgent -->|Resultado| ResponseBuilder
    GameAgent -->|Resultado| ResponseBuilder
    
    ResponseBuilder -->|Texto Final| MetaAPI
    MetaAPI -->|WhatsApp Msg| User