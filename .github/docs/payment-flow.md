sequenceDiagram
    actor User as Usuario (WhatsApp/Web)
    participant FE as Frontend (Next.js)
    participant AgentBE as Agent Backend (Orquestador)
    participant PayBE as Payment Backend (Pasarela/HotWallet)
    participant Bank as Banco (Fiat)
    participant Stellar as Blockchain (Soroban)
    autonumber

    rect rgb(230, 240, 255)
        note right of User: --- FASE 1: GENERACIÓN DE COBRO (Discovery) ---
        AgentBE->>AgentBE: Cron Job: Nuevo ciclo de pago
        AgentBE->>PayBE: GET /api/pay (Sin Payload)
        par Preparación de Métodos
            PayBE->>Bank: Genera QR Simple
            PayBE->>PayBE: Genera Challenge X402 (Unsigned Transaction XDR)
        end
        PayBE-->>AgentBE: 402 Payment Required
        Note right of PayBE: Header: WWW-Authenticate: x402 <Challenge_XDR><br/>Body: { qr_url: "ipfs://..." }
      AgentBE->>AgentBE: agregar direccion del contrato en el payload "payTo" andes de subir el XDRChallenge a supabase
        AgentBE->>User: WhatsApp: "Es tu turno. Paga aquí: /pagos/{uuid}"
    end

    rect rgb(255, 253, 230)
        note right of User: --- FASE 2: INTENCIÓN DE PAGO (CLIENTE) ---
        User->>FE: Abre Link (/pagos/{uuid})
        FE->>AgentBE: GET /orders/{uuid}
        AgentBE-->>FE: Return: { status: "PENDING", challenge_xdr: "...", qr_url: "..." }
        
        alt Selección: PAGO CON QR (Fiat)
            FE->>User: Muestra QR
            User->>Bank: Transferencia Bancaria
            Bank-->>User: Comprobante
            User->>FE: Sube Comprobante
            FE->>AgentBE: POST /claim (Body: Proof URL)
            AgentBE->>AgentBE: OCR/Extracción Datos
            AgentBE->>AgentBE: Status: CLAIMED_BY_USER
            AgentBE-->>FE: OK ("Verificando...")
        else Selección: PAGO CON WALLET (Crypto X402)
            FE->>User: Botón "Pagar con Wallet"
            User->>FE: Conecta Wallet
            FE->>FE: Decodifica Challenge XDR
            FE->>User: Solicita Firma (Freighter)
            User->>FE: Firma la Transacción
            FE->>AgentBE: POST /claim (Body: Signed_XDR_Envelope)
            AgentBE->>AgentBE: Status: PROCESSING_CRYPTO
        end
    end

    rect rgb(230, 255, 230)
        note right of User: --- FASE 3: VERIFICACIÓN UNIFICADA (GET /api/pay) ---
        
        alt CAMINO A: Verificación Fiat (Con Payload)
            AgentBE->>PayBE: GET /api/pay
            Note right of AgentBE: Body: { proof_metadata: { ... } }
            
            PayBE->>PayBE: Detecta Payload -> Modo Fiat
            PayBE->>Bank: Consulta API Banco
            
            alt Banco Confirma
                PayBE->>PayBE: Ejecuta On-Ramp (HotWallet -> Contract)
                PayBE->>Stellar: deposit_for(Backend, User, Amount)
                Stellar-->>PayBE: Success TxHash
                PayBE-->>AgentBE: 200 OK (Body: { tx_hash: "..." })
                AgentBE->>AgentBE: Status: COMPLETED
                AgentBE->>User: WhatsApp: "Pago Fiat validado y registrado en Blockchain."
            else Banco Rechaza
                PayBE-->>AgentBE: 404 Not Found / 400 Bad Request
                AgentBE->>AgentBE: Status: REJECTED
                AgentBE->>User: WhatsApp: "Error: Comprobante inválido."
            end
        
        else CAMINO B: Verificación Crypto (Con Authorization Header)
            AgentBE->>PayBE: GET /api/pay
            Note right of AgentBE: Header: Authorization: x402 <Signed_XDR>
            
            PayBE->>PayBE: Detecta Auth Header -> Modo X402
            PayBE->>PayBE: Valida Firmas y Secuencia
            PayBE->>Stellar: Submit Transaction (XDR firmado por user)
            
            alt Tx Confirmada
                Stellar-->>PayBE: Tx Success & Events
                PayBE-->>AgentBE: 200 OK (Resource Released / Receipt)
                AgentBE->>AgentBE: Status: COMPLETED
                AgentBE->>User: WhatsApp: "Pago Crypto exitoso."
            else Tx Fallida
                Stellar-->>PayBE: Error Code
                PayBE-->>AgentBE: 402 Payment Required (Re-Challenge o Error)
                AgentBE->>User: WhatsApp: "Error en la transacción crypto."
            end
        end
    end

    rect rgb(255, 235, 235)
        note right of User: --- FASE 4: OFF-RAMP (RETIRO) ---
        Note over Stellar: (Sin cambios en lógica de retiro)
        AgentBE->>AgentBE: Detecta Ganador
        AgentBE->>User: "¿Retiro Banco o Wallet?"
        
        alt CUENTA BANCARIA
            User->>AgentBE: "Banco"
            AgentBE->>PayBE: POST /offramp
            PayBE->>Stellar: Withdraw
            PayBE->>Bank: Transferencia
            AgentBE->>User: "Dinero enviado."
        else WALLET STELLAR
            User->>AgentBE: "Wallet"
            AgentBE->>Stellar: Call payout()
            Stellar->>User: USDC Transfer
            AgentBE->>User: "USDC enviados."
        end
    end