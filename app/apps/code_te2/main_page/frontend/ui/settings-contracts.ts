import { isUnknownArray } from '../../../src/rpc/value-types.ts';
import type { ExplorerRpcMethod } from '../../../src/explorer/rpc/contract.ts';

export type SettingsRequest = (method: ExplorerRpcMethod, payload: Record<string, unknown>, timeoutMs?: number) => Promise<Record<string, unknown>>;
export type SettingsNotify = (method: ExplorerRpcMethod, payload: Record<string, unknown>) => void;

export function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !isUnknownArray(value)
    ? Object.fromEntries(Object.entries(value)) : {};
}

export interface ExtensionSummary {
  id: string;
  display_name: string;
  version: string;
  source: string;
  active: boolean;
  has_config: boolean;
  languages: string[];
  configuration_values: Record<string, unknown>;
}

function extensionSummary(value: unknown): ExtensionSummary {
  const row = objectValue(value);
  return {
    id: typeof row.id === 'string' ? row.id : '',
    display_name: typeof row.display_name === 'string' ? row.display_name : '',
    version: typeof row.version === 'string' ? row.version : '',
    source: typeof row.source === 'string' ? row.source : '',
    active: row.active === true, has_config: row.has_config === true,
    languages: isUnknownArray(row.languages) ? row.languages.filter((v: unknown): v is string => typeof v === 'string') : [],
    configuration_values: objectValue(row.configuration_values),
  };
}

export function settingsRequest(request: SettingsRequest) {
  return async (method: ExplorerRpcMethod, payload: Record<string, unknown>, timeoutMs?: number) => {
    const row = await request(method, payload, timeoutMs);
    const extensions: unknown[] = isUnknownArray(row.extensions) ? row.extensions : [];
    return {
      ok: row.ok === true,
      error: typeof row.error === 'string' ? row.error : '',
      count: typeof row.count === 'number' ? row.count : 0,
      schema: objectValue(row.schema), settings: objectValue(row.settings),
      config_schema: objectValue(row.config_schema), extension: extensionSummary(row.extension),
      extensions: extensions.map(extensionSummary),
      language_slots: objectValue(row.language_slots),
    };
  };
}

export interface ConfigProperty {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  anyOf?: ConfigProperty[];
  items?: ConfigProperty;
  minimum?: number;
  maximum?: number;
}

function configProperty(value: unknown): ConfigProperty {
  const row = objectValue(value);
  const property: ConfigProperty = { default: row.default };
  if (typeof row.type === 'string') property.type = row.type;
  else if (isUnknownArray(row.type)) property.type = row.type.filter((v: unknown): v is string => typeof v === 'string');
  if (typeof row.description === 'string') property.description = row.description;
  if (typeof row.minimum === 'number') property.minimum = row.minimum;
  if (typeof row.maximum === 'number') property.maximum = row.maximum;
  if (isUnknownArray(row.enum)) property.enum = row.enum;
  if (isUnknownArray(row.anyOf)) property.anyOf = row.anyOf.map(configProperty);
  if (row.items !== undefined) property.items = configProperty(row.items);
  return property;
}

export function configProperties(value: unknown): Record<string, ConfigProperty> {
  const schema = objectValue(value);
  return Object.fromEntries(Object.entries(objectValue(schema.properties ?? schema))
    .map(([key, property]) => [key, configProperty(property)]));
}
