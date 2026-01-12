export interface CDPCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
}

export interface CDPAuthData {
  timestamp: number;
  domain: string;
  cookies: CDPCookie[];
  syncedAt: string;
}

export interface CDPSyncMessage {
  type: "SYNC_COOKIES";
  timestamp: number;
  domain: string;
  cookies: CDPCookie[];
}

export interface CDPAckMessage {
  type: "ACK";
  success: boolean;
  cookieCount: number;
}

export interface CDPErrorMessage {
  type: "ERROR";
  error: string;
}

export type CDPMessage = CDPSyncMessage | CDPAckMessage | CDPErrorMessage;

export interface CDPConfig {
  host: string;
  authFile?: string;
  tls?: CDPTLSConfig;
}

export interface CDPTLSConfig {
  rejectUnauthorized?: boolean;
  caFile?: string;
}
