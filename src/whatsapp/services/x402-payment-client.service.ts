// Cliente x402 legacy eliminado. Se mantiene stub para compatibilidad de tipos.

export interface X402AcceptOption {
  type: 'fiat' | 'crypto';
  currency?: string;
  symbol?: string;
  amountRequired?: number;
  base64QrSimple?: string;
  scheme?: string;
  network?: string;
  payTo?: string;
  maxAmountRequired?: string;
}

export interface X402NegotiationResponse {
  x402Version: number;
  resource: string;
  accepts: X402AcceptOption[];
  error?: string;
  jobId: string;
}

export interface X402SettlementResponse {
  success: boolean;
  type: 'fiat' | 'crypto';
  transaction?: string | null;
  currency?: string;
  network?: string;
  chainId?: number;
  payer?: string;
  errorReason?: string | null;
}

export class X402PaymentClientService {}
