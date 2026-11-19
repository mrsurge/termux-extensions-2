export interface SecondaryPanelSnapshot {
  panels: { surfaceId: string; presentationId: string; label: string }[];
  active: string;
  returnedSurfaceId?: string;
}
export interface SecondaryPanelBridge {
  secondaryPanelSnapshot(): Promise<SecondaryPanelSnapshot>;
  onSecondaryPanels(listener: (state: SecondaryPanelSnapshot) => void): () => void;
  secondaryPanelAction(action: "transfer" | "return" | "select" | "files", surfaceId?: string, presentationId?: string): Promise<void>;
  placeSecondaryPanel(surfaceId: string, presentationId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
}
