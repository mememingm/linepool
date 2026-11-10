import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { Authentication, SessionGuard } from './authentication.js';
import { PasswordRecovery } from './password-recovery.js';
import { AuthController, PasswordRecoveryController, HealthController, WorkspaceController, NumberServicesController } from './controllers.js';
import { SiteAccountController } from './account-controller.js';
import { Database } from './database.js';
import { Environment } from './environment.js';
import { OriginGuard } from './http.js';
import { Ordering } from './ordering.js';
import { Workspace } from './workspace.js';
import { AdminController } from './admin-controller.js';
import { Administration, AdminGuard } from './administration.js';
import { NumberServices } from './number-services.js';
import { NumberServiceProvider, MockNumberServiceProvider } from './number-service-provider.js';
import { ReceivingProvider } from './providers/receiving-provider.js';
import { MockReceivingProvider } from './providers/mock-receiving-provider.js';
import { ReceivingSync } from './providers/receiving-sync.js';
import { AllocationExpiry } from './allocation-expiry.js';
import { BusinessThrottlerGuard } from './business-throttler.js';
import { Sandbox, SandboxController } from './sandbox.js';
import { WebhookInbox } from './providers/webhook-inbox.js';
import { UpstreamIntegration } from './upstream-integration.js';
import { PingCodeWebhookController, OnceMockWebhookController } from './providers/pingcode-webhook.js';
import { Recharge, RechargeController } from './recharge.js';
import { AgentInventory } from './agent-inventory.js';
import { AgentInventoryController } from './agent-inventory-controller.js';
import { LegacyDistributionGuard } from './legacy-distribution-guard.js';
import { ProviderSyncService } from './provider-sync.js';
import { MockWholeNumberProvider } from './providers/mock-whole-number-provider.js';
import { MockFulfillment } from './mock-fulfillment.js';
import { OnceInventory } from './once/inventory.js';
import { OnceLeasePlans } from './once/lease-plans.js';
import { OncePurchaseIntents } from './once/purchase-intents.js';
import { OnceLeaseOrdering } from './once/lease-ordering.js';
import { OnceLeases } from './once/leases.js';
import { OnceCatalogController, OnceLeaseController } from './once/lease-controller.js';
import { OnceMaintenance } from './once/maintenance.js';
import { OnceMessages } from './once/messages.js';
import { OnceOutbound, OnceMessagingWorker } from './once/outbound.js';
import { OnceChat } from './once/chat.js';
import { OnceMessageController } from './once/message-controller.js';
import { MockSmsSender } from './providers/mock-sms-sender.js';
import { PcSmsSender } from './providers/pc-sms-sender.js';
import { OncePoints } from './once/points.js';
import { OncePointsController, OnceAdminPointsController, OncePointsGuard } from './once/points-controller.js';
import { OnceMockPayment } from './once/mock-payment.js';
import { OncePointExceptions } from './once/point-exceptions.js';
import { OnceRefundHistory } from './once/refund-history.js';
import { OnceAdmin } from './once/admin.js';
import { OnceAdminController } from './once/admin-controller.js';
import { OnceAdminOperations } from './once/admin-operations.js';
import { OnceAdminViews } from './once/admin-views.js';
import { OnceIntegration } from './once/integration.js';
import { OnceOperator } from './once/operator.js';
import { PcAuthorization, MockPcProvider, PcHttpProvider, PcConnections, PcWorker, PcAuthController, PcController, PcAdminController, LocalPlatformInventory, ShopProducts } from './pc/index.js';
import { SelfServiceGuard } from './self-service-guard.js';
import { LinePoolReceiving } from './linepool-receiving.js';
import { PcShopOrdering } from './pc/shop-ordering.js';
import { ShopDelivery } from './pc/shop-delivery.js';

/** Site and process role are deployment configuration; no request can select a module or database. */
@Module({})
export class RuntimeModule {
  static forRoot(environment: Environment, database: Database): DynamicModule {
    const linepool = environment.siteId === 'linepool' && environment.isModuleEnabled('SMS_CODE');
    const once = environment.siteId === 'once' && environment.isModuleEnabled('NUMBER_LEASE');
    const providers: Provider[] = [
      { provide: Environment, useValue: environment },
      { provide: Database, useValue: database },
      Authentication, SessionGuard, PasswordRecovery, Workspace, Administration, AdminGuard, Recharge,
      ReceivingSync, WebhookInbox, LinePoolReceiving, ShopDelivery, ProviderSyncService, PcHttpProvider, LocalPlatformInventory,
      { provide: MockReceivingProvider, useFactory: (config: Environment) => new MockReceivingProvider(config), inject: [Environment] },
      { provide: ReceivingProvider, useExisting: MockReceivingProvider },
    ];
    if (once) {
      providers.push(
        OnceInventory, OnceLeasePlans, OncePurchaseIntents, OnceLeaseOrdering, OnceLeases,
        Ordering, MockWholeNumberProvider, MockFulfillment,
        OnceMessages, OnceOutbound, OnceChat, MockSmsSender, PcSmsSender,
        OncePoints, OncePointsGuard, OnceMockPayment, OncePointExceptions, OnceRefundHistory,
      );
      if (environment.isWorker) providers.push(OnceMaintenance, OnceMessagingWorker);
      else providers.push(OnceAdminOperations, OnceAdminViews, OnceAdmin, OnceIntegration, OnceOperator);
    }
    if (linepool) {
      providers.push(Ordering, NumberServices, Sandbox, UpstreamIntegration, PcShopOrdering,
        { provide: NumberServiceProvider, useClass: MockNumberServiceProvider });
      if (environment.isWorker) providers.push(AllocationExpiry);
    }
    if (environment.isWorker) {
      if (linepool || once) providers.push(MockPcProvider, PcWorker);
      return { module: RuntimeModule, providers };
    }
    providers.push(AgentInventory, ShopProducts,
      PcAuthorization, MockPcProvider, PcConnections,
      { provide: APP_GUARD, useClass: OriginGuard },
      { provide: APP_GUARD, useClass: BusinessThrottlerGuard },
      { provide: APP_GUARD, useClass: SelfServiceGuard },
      { provide: APP_GUARD, useClass: LegacyDistributionGuard });
    return {
      module: RuntimeModule,
      // Global per-account (or per-IP before login) budget; local sandboxes run several polling tabs at once.
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: environment.values.LOCAL_SANDBOX && environment.values.NODE_ENV !== 'production' ? 600 : 120 }])],
      controllers: [
        AuthController, PasswordRecoveryController, HealthController, AgentInventoryController,
        PcAuthController, PcController, PcAdminController,
        ...(linepool ? [WorkspaceController, AdminController, NumberServicesController, SandboxController, RechargeController] : [SiteAccountController]),
        ...(once ? [OnceCatalogController, OnceLeaseController, OnceMessageController, OncePointsController, OnceAdminPointsController, OnceAdminController, OnceMockWebhookController] : []),
        ...(linepool ? [PingCodeWebhookController] : []),
      ],
      providers,
    };
  }
}
