export interface WorkingDocumentModel {
  uri: { toString(): string };
  getValue(): string;
  getLanguageId(): string;
  isDisposed(): boolean;
  onDidChangeContent(listener: () => void): { dispose(): void };
  dispose(): void;
}

interface Entry {
  key: string;
  model: WorkingDocumentModel;
  owners: Set<object>;
}

/** Presentation leases only; backend membership remains the document authority. */
export class WorkingDocumentResources {
  private readonly entries = new Map<string, Entry>();
  private readonly byModel = new WeakMap<object, Entry>();

  acquire(key: string, owner: object, create: () => WorkingDocumentModel): WorkingDocumentModel {
    let entry = this.entries.get(key);
    if (entry?.model.isDisposed()) throw new Error('A leased working document was disposed outside its resource owner.');
    if (!entry) {
      const model = create();
      if (model.uri.toString() !== key) {
        model.dispose();
        throw new Error('Working document URI does not match its resource key.');
      }
      entry = { key, model, owners: new Set() };
      this.entries.set(key, entry);
      this.byModel.set(model, entry);
    }
    entry.owners.add(owner);
    return entry.model;
  }

  release(owner: object, model: object): void {
    const entry = this.byModel.get(model);
    if (!entry || !entry.owners.delete(owner)) return;
    if (!entry.owners.size) {
      this.entries.delete(entry.key);
      this.byModel.delete(model);
      entry.model.dispose();
    }
  }

  releaseOwner(owner: object): void {
    for (const entry of [...this.entries.values()]) this.release(owner, entry.model);
  }
}

const resources = new WeakMap<object, WorkingDocumentResources>();

export function workingDocumentResources(namespace: object): WorkingDocumentResources {
  let owner = resources.get(namespace);
  if (!owner) {
    owner = new WorkingDocumentResources();
    resources.set(namespace, owner);
  }
  return owner;
}

export function isWorkingDocumentModel(value: unknown): value is WorkingDocumentModel {
  return value !== null && typeof value === 'object' &&
    'uri' in value && value.uri !== null && typeof value.uri === 'object' &&
    'toString' in value.uri && typeof value.uri.toString === 'function' &&
    'getValue' in value && typeof value.getValue === 'function' &&
    'getLanguageId' in value && typeof value.getLanguageId === 'function' &&
    'isDisposed' in value && typeof value.isDisposed === 'function' &&
    'onDidChangeContent' in value && typeof value.onDidChangeContent === 'function' &&
    'dispose' in value && typeof value.dispose === 'function';
}
