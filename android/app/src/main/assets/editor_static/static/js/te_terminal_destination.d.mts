export function chooseTerminalDestination(dialog: {
  open(request: {
    kind: 'surface'; title: string; message: string; surface: { id: string };
    actions: { id: string; label: string; role: 'cancel' | 'accept'; primary?: boolean }[];
    defaultAction: string; cancelAction: string;
    fields: { key: string; kind: 'checkbox'; label: string; value: boolean }[];
  }): Promise<{ status: string; action?: string | null; values?: Record<string, unknown> }>;
}, preferences?: {
  read(): Promise<'ask' | 'sidebar' | 'drawer'>;
  write(value: 'ask' | 'sidebar' | 'drawer'): Promise<void>;
  onError?: (error: unknown) => void;
}): Promise<'sidebar' | 'drawer' | null>;
