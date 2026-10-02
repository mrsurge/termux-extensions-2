export function chooseTerminalDestination(dialog: {
  open(request: {
    kind: 'surface'; title: string; message: string; surface: { id: string };
    actions: { id: string; label: string; role: 'cancel' | 'accept'; primary?: boolean }[];
    defaultAction: string; cancelAction: string;
  }): Promise<{ status: string; action?: string | null }>;
}): Promise<'sidebar' | 'drawer' | null>;
