sequenceDiagram
participant U as Usuario (WA/FE)
participant FE as Frontend (Next.js)
participant A as AgentBE (WhatsApp API)
participant SB as Supabase
participant P as PayBE (x402/Fiat)
participant S as Soroban
participant WA as WhatsApp Cloud
autonumber

    U->>FE: Form onboarding (tel, grupo, Bs, USDC, FX)
    FE->>A: GET /api/verify
    A->>FE: Tu codigo de verificacion es XXXX
    U->>WA: enviar mensaje de verificacion al numero del bot
    WA-->>U: Verificacion correcta
    WA-->>A: /webhook extraer numero de whatsapp, username
    U->>FE: Enviar formulario
    FE->>A: POST api/onboarding
    Note over FE, A: NO CREA CONTRATOS DE SOROBAN AUN (no se da inicio a la tanda)
    A->>A: crea keypairs de stellar
    A->>SB: INSERT/UPSERT user
    A->>WA: Crear grupo WA
    WA-->>U: enviar link de invitacion del grupo al whatsapp
    alt agregar miembros al grupo de whastapp
      U->>WA: se une al grupo mediante invitacion
    WA-->>A: envia el evento de ingreso al webhook
    A->>A: detecta nuevo miembro y comienza el registro
      WA-->>U: enviar dm de inicializacion al numero nuevo
      U->>WA: envia informacion con la confirmacion de registro
      A->>A: crea keypairs de stellar
      A->>SB: INSERT/UPSERT user

      Note over P, S: no se crea grupo, solo user
    end
    U->>WA: Admin escribe en el grupo "iniciar tanda" (o comando equivalente)
    WA-->>A: webhook grupal con group_id y sender admin
    Note over A, P: SE DA INICIO A LA TANDA (se despliega contrato y se genera la primera orden)
     A->>P: POST /api/soroban/groups (amountPerRound in stroops)
    P->>S: crea nuevo contrato PasanakuGroup via factory
    P-->>A: groupAddress
    A->>SB: UPDATE groups.status=ACTIVE, contract_address=groupAddress
    A->>SB: INSERT payment_orders (orden inicial), xdr_challenge/qr_payload_url
    A-->>WA: Mensaje al grupo/admin con link dinámico /pagos/{orderId}

    Note over U, WA: inicia payment-flow (ver payment-flow.md)
