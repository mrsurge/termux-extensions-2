import { RPC_NAMESPACES } from '../namespaces.ts';

export type JsonObject = Record<string, unknown>;

export const SETTINGS_RPC_NAMESPACE = RPC_NAMESPACES.settings;
export const SETTINGS_RPC_IMPLEMENTATION_STATUS = 'implemented' as const;
export const SETTINGS_RPC_METHODS = {
  configGet: 'config.get',
  configUpdate: 'config.update',
  statusGet: 'status.get',
  extensionsList: 'extensions.list',
  extensionsReload: 'extensions.reload',
  extensionEnabledSet: 'extension.enabled.set',
  extensionInstall: 'extension.install',
  extensionSplashSchemaGet: 'extension.splashSchema.get',
  extensionSplashActionRun: 'extension.splashAction.run',
  extensionSettingsSchemaGet: 'extension.settingsSchema.get',
  extensionSettingsSchemaFragmentGet: 'extension.settingsSchema.fragment.get',
  extensionRuntimeOptionsGet: 'extension.runtimeOptions.get',
  extensionProviderInfoGet: 'extension.providerInfo.get',
  extensionSchemaInteractionRun: 'extension.schemaInteraction.run',
  extensionRequestCardsGet: 'extension.requestCards.get',
  extensionUiFeaturesGet: 'extension.uiFeatures.get',
  extensionPlanGet: 'extension.plan.get',
  extensionModelsList: 'extension.models.list',
  extensionSessionsList: 'extension.sessions.list',
  extensionSessionBind: 'extension.session.bind',
  extensionSessionStateGet: 'extension.session.state.get',
  extensionSessionUnload: 'extension.session.unload',
} as const;

export type SettingsRpcMethod =
  typeof SETTINGS_RPC_METHODS[keyof typeof SETTINGS_RPC_METHODS];

export const SETTINGS_RPC_NOTIFICATION_METHODS = [
  'extensions.updated',
  'config.updated',
  'extension.providerInfo.updated',
] as const;

export type SettingsRpcNotificationMethod =
  typeof SETTINGS_RPC_NOTIFICATION_METHODS[number];

export const SETTINGS_RPC_ANCHOR_MODULES = [
  'settings/ui_flow.ts',
  'host/runtime.ts',
  'conversation_drawer/actions.ts',
  'extension_settings.ts',
  'settings_schema.ts',
] as const;
