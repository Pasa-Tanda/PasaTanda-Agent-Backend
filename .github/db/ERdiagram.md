Project PasanakuBot_V4 {
database_type: 'PostgreSQL'
Note: 'Base de datos PasanakuBot V4. Optimizada para X402 y OCR de comprobantes.'
}

// ... [LAS TABLAS users, user_bank_accounts, groups, memberships, rounds SE MANTIENEN IGUAL] ...
// (Copia las tablas anteriores aquí, no cambian)

Table users {
id integer [pk, increment]
phone_number varchar [unique, not null]
username varchar
stellar_public_key varchar [unique, not null]
wallet_type varchar [default: 'EXTERNAL']
wallet_secret_enc varchar
preferred_currency varchar [default: 'BOB']
created_at timestamp [default: `now()`]
}

Table user_bank_accounts {
id integer [pk, increment]
user_id integer [ref: > users.id]
alias_name varchar
country_code varchar
bank_name varchar
account_details_json jsonb
is_default boolean
created_at timestamp
}

Table groups {
id integer [pk, increment]
group_whatsapp_id varchar [unique]
name varchar
contract_address varchar
total_cycle_amount_usdc decimal
frequency_days integer
yield_enabled boolean
status varchar [note: 'DRAFT hasta que el admin escriba "iniciar tanda"; luego ACTIVE y ya no se modifica']
}

Table memberships {
id integer [pk, increment]
user_id integer [ref: > users.id]
group_id integer [ref: > groups.id]
turn_number integer
payout_bank_account_id integer [ref: > user_bank_accounts.id]
is_admin boolean
}

Table rounds {
id integer [pk, increment]
group_id integer [ref: > groups.id]
round_number integer
winner_user_id integer [ref: > users.id]
status varchar
start_date timestamp
due_date timestamp
}

// =========================================
// TABLA PRINCIPAL MODIFICADA
// =========================================

Table payment_orders {
id varchar [pk, note: 'UUID del link dinámico (/pagos/uuid)']
user_id integer [ref: > users.id]
group_id integer [ref: > groups.id]
round_id integer [ref: > rounds.id]

// --- Montos ---
amount_fiat decimal [note: 'Monto esperado en Bs']
currency_fiat varchar [default: 'BOB']
amount_crypto_usdc decimal [note: 'Monto equivalente en USDC a depositar en contrato']

payment_method varchar [note: 'QR_SIMPLE, STELLAR_WALLET']

// --- Estados del Flujo ---
status varchar [default: 'PENDING', note: 'DRAFT (guardado al crear tanda), CLAIMED_BY_USER, VERIFIED, COMPLETED, REJECTED']

// --- Soporte Fiat (QR + Comprobante) ---
qr_payload_url varchar [note: 'Link IPFS al QR generado']
proof_screenshot_url varchar [note: 'Foto del voucher subida por usuario']

proof_metadata jsonb [note: 'NUEVO: Datos extraídos vía OCR para enviar a PayBE. Ej: { "ref": "12345", "bank": "BNB", "date": "2024-01-01" }']

// --- Soporte Crypto (X402) ---
xdr_challenge text [note: 'NUEVO: La transacción XDR sin firmar generada en Fase 1. Necesaria para validar la firma en Fase 3']

// --- Auditoría ---
rejection_reason varchar
created_at timestamp [default: `now()`]
expires_at timestamp
}

Table transactions {
id integer [pk, increment]
payment_order_id varchar [ref: - payment_orders.id]
user_id integer [ref: > users.id]
group_id integer [ref: > groups.id]
round_id integer [ref: > rounds.id]

type varchar [note: 'DEPOSIT_TO_POOL, PAYOUT_TO_USER, OFFRAMP_FIAT']
amount_usdc decimal
stellar_tx_hash varchar
status varchar [note: 'SUCCESS, FAILED']
created_at timestamp [default: `now()`]
}
