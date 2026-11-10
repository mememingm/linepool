export interface IntegrationCheck {
  ok: boolean; connected: boolean; checkedAt: string; message: string;
  connectionKind: "LOCAL_MOCK" | "PERSISTED_APPLICATION_CONNECTION"; liveConnectionVerified: false;
  resourceCount: number; invalidResources: number; code: string | null;
}
export interface IntegrationSync {
  taskId: string; mode: string; status: string; fetched?: number; imported?: number;
  refreshed?: number; unavailable?: number; conflicts?: number; errorCode?: string | null;
  createdAt?: string; finishedAt?: string | null;
}
export interface IntegrationConfig {
  provider: string; name: string; configured: boolean; enabled: boolean; demoMode: boolean;
  accountId: string | null; authorized?: boolean; receivingMode: "worker-polling"; credentialsEditable: false;
  mappedNumbers: number; lastCheck: IntegrationCheck | null; lastSync: IntegrationSync | null;
  lastEvent: { receivedAt: string; status: string } | null;
  deliveryNote: string;
  capabilities: { numbers: boolean; receiveSms: boolean; sendSms: boolean; sendStatus: string; purchase: false; renew: false };
}
export interface UpstreamNumber { id: string; phoneNumber: string; providerNumberId: string | null; status: string; resourceExpiresAt: string | null; regionName: string | null; imported: boolean }
export interface IntegrationInput { enabled: boolean; reason: string }
