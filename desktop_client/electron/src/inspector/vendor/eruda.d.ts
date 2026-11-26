// The Eruda 3.4.3 browser APIs used by the TE2 inspector.
declare const eruda: {
  init(): void;
  get(): { toggle(): void };
  get(name: "entryBtn"): { hide(): void };
  show(name?: string): void;
  destroy(): void;
};
export default eruda;
