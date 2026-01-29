export type CDPCookieSameSite =
  | "no_restriction"
  | "lax"
  | "strict"
  | "unspecified";

export type CDPCookiePriority = "low" | "medium" | "high";

export type CDPCookiePartitionKey = Record<string, unknown>;

export interface CDPCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite?: CDPCookieSameSite;
  hostOnly?: boolean;
  session?: boolean;
  storeId?: string;
  sameParty?: boolean;
  priority?: CDPCookiePriority;
  partitionKey?: CDPCookiePartitionKey;
}

export interface CDPSiteAuthData {
  timestamp: number;
  domain: string;
  cookies: CDPCookie[];
  syncedAt: string;
}

export interface CDPAuthDataV1 extends CDPSiteAuthData {
  version?: 1;
}

export interface CDPAuthDataV2 {
  version: 2;
  sites: Record<string, CDPSiteAuthData>;
}

export type CDPAuthData = CDPAuthDataV1 | CDPAuthDataV2;

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
