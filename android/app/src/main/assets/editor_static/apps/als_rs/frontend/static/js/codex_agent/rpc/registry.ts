import { RPC_NAMESPACES } from './namespaces.ts';
import {
  CONVERSATIONS_RPC_METHOD_DESCRIPTORS,
  CONVERSATIONS_RPC_NOTIFICATION_METHODS,
  type ConversationsRpcMethod,
} from './conversations/contract.ts';
import {
  SETTINGS_RPC_METHODS,
  SETTINGS_RPC_NAMESPACE,
  SETTINGS_RPC_NOTIFICATION_METHODS,
  type SettingsRpcMethod,
} from './settings/contract.ts';
import {
  UI_RPC_METHODS,
  UI_RPC_NAMESPACE,
  UI_RPC_NOTIFICATION_METHODS,
  type UiRpcMethod,
} from './ui/contract.ts';

export type RpcSurfaceStatus = 'planned' | 'implemented';
export type RpcRegistryStatus = 'partial' | 'implemented';

export interface RpcMethodDescriptor<Name extends string = string> {
  name: Name;
  namespace: string;
  status: RpcSurfaceStatus;
}

export interface RpcNamespaceRegistry<Name extends string = string> {
  status: RpcSurfaceStatus;
  namespace: string;
  methods: readonly RpcMethodDescriptor<Name>[];
  notifications: readonly string[];
}

export interface RpcRegistry {
  status: RpcRegistryStatus;
  compatibilityNamespace: string;
  namespaces: {
    conversations: RpcNamespaceRegistry<ConversationsRpcMethod>;
    settings: RpcNamespaceRegistry<SettingsRpcMethod>;
    ui: RpcNamespaceRegistry<UiRpcMethod>;
  };
}

export const RPC_REGISTRY: RpcRegistry = {
  status: 'implemented',
  compatibilityNamespace: '',
  namespaces: {
    conversations: {
      status: 'implemented',
      namespace: RPC_NAMESPACES.conversations,
      methods: CONVERSATIONS_RPC_METHOD_DESCRIPTORS,
      notifications: CONVERSATIONS_RPC_NOTIFICATION_METHODS,
    },
    settings: {
      status: 'implemented',
      namespace: SETTINGS_RPC_NAMESPACE,
      methods: [
        { name: SETTINGS_RPC_METHODS.configGet, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.configUpdate, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.statusGet, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionsList, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionsReload, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionEnabledSet, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionInstall, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionSplashSchemaGet, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionSplashActionRun, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionSettingsSchemaGet, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionRuntimeOptionsGet, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionRequestCardsGet, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionUiFeaturesGet, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionPlanGet, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionModelsList, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionSessionsList, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionSessionBind, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionSessionStateGet, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
        { name: SETTINGS_RPC_METHODS.extensionSessionUnload, namespace: SETTINGS_RPC_NAMESPACE, status: 'implemented' },
      ],
      notifications: [...SETTINGS_RPC_NOTIFICATION_METHODS],
    },
    ui: {
      status: 'implemented',
      namespace: UI_RPC_NAMESPACE,
      methods: [
        { name: UI_RPC_METHODS.viewGet, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
        { name: UI_RPC_METHODS.viewSet, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
        { name: UI_RPC_METHODS.hostUiGet, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
        { name: UI_RPC_METHODS.hostUiRecheck, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
        { name: UI_RPC_METHODS.filesystemHome, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
        { name: UI_RPC_METHODS.filesystemList, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
        { name: UI_RPC_METHODS.filesystemSearch, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
        { name: UI_RPC_METHODS.projectSummaryGet, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
        { name: UI_RPC_METHODS.projectGitRemote, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
        { name: UI_RPC_METHODS.projectTe2StatusGet, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
        { name: UI_RPC_METHODS.projectTe2Open, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
        { name: UI_RPC_METHODS.projectTe2Create, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
        { name: UI_RPC_METHODS.fileOpen, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
        { name: UI_RPC_METHODS.urlOpen, namespace: UI_RPC_NAMESPACE, status: 'implemented' },
      ],
      notifications: [...UI_RPC_NOTIFICATION_METHODS],
    },
  },
};

export function getRpcRegistry(): RpcRegistry {
  return RPC_REGISTRY;
}

export type RpcMethodPlaceholder = RpcMethodDescriptor;
export type RpcNamespaceRegistryPlaceholder = RpcNamespaceRegistry;
export type RpcRegistryPlaceholder = RpcRegistry;
export const RPC_REGISTRY_PLACEHOLDER = RPC_REGISTRY;
export const getRpcRegistryPlaceholder = getRpcRegistry;
