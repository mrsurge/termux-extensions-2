import {
  isWorkingDocumentModel, workingDocumentResources, type WorkingDocumentModel,
} from './working_document_resources.ts';

interface MonacoEditorNamespaceLike {
  editor?: {
    createModel?(value: string, language: string, uri?: unknown): unknown;
  };
}

export function createFileModel(
  monacoObj: MonacoEditorNamespaceLike | null | undefined,
  owner: object,
  fileUriFactory: (absPath: string | null | undefined) => unknown,
  content: string | null | undefined,
  lang: string | null | undefined,
  absPath: string | null | undefined,
  onAfterCreate?: (() => void) | null,
): WorkingDocumentModel {
  const namespace = monacoObj?.editor;
  if (!namespace?.createModel) throw new Error('Monaco model creation is unavailable.');
  const uri = fileUriFactory(absPath);
  if (!uri) throw new Error('Working document requires a canonical file URI.');
  const key = String(uri);
  const model = workingDocumentResources(namespace).acquire(key, owner, () => {
    const created = namespace.createModel?.(content || '', lang || 'plaintext', uri);
    if (!isWorkingDocumentModel(created)) throw new Error('Monaco returned an invalid working document model.');
    return created;
  });
  try {
    onAfterCreate?.();
  } catch (_) {}
  return model;
}

export function releaseFileModel(
  monacoObj: MonacoEditorNamespaceLike | null | undefined, owner: object, model: object,
): void {
  if (monacoObj?.editor) workingDocumentResources(monacoObj.editor).release(owner, model);
}

export function releaseFileModelOwner(
  monacoObj: MonacoEditorNamespaceLike | null | undefined, owner: object,
): void {
  if (monacoObj?.editor) workingDocumentResources(monacoObj.editor).releaseOwner(owner);
}
