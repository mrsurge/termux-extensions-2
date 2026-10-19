import { createDeclarativeForm } from '../../../main_page/frontend/ui/declarative-modal.ts';
import { createModalFrame } from '../../../main_page/frontend/ui/modal-kit/modal-frame.tsx';

type ToastFn = (message: string) => void;

export interface NewProjectModalResult {
    type: 'local' | 'clone';
    url: string;
}

export function showNewProjectModal(
    toastFn?: ToastFn,
    document: Document = globalThis.document,
): Promise<NewProjectModalResult> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let previousType: unknown = 'local';
        const cancel = () => finish(null);
        const frame = createModalFrame(document, {
            id: 'fe-new-project-modal',
            surfaceId: 'code-te2.new-project',
            title: 'New Project',
            width: 'min(460px, 92vw)',
            onClose: cancel,
        });
        const form = createDeclarativeForm(frame.body, {
            fields: [
                {key: 'type', label: 'Project type', kind: 'select', options: [
                    {value: 'local', label: 'Local Project — create an empty folder'},
                    {value: 'clone', label: 'Clone Repository — clone from a Git URL'},
                ]},
                {key: 'url', label: 'Git URL', kind: 'text',
                    placeholder: 'https://github.com/user/repo.git',
                    visibleWhen: {field: 'type', equals: 'clone'}},
            ],
        }, {type: 'local', url: ''}, {
            onChange(values) {
                if (typeof values.url === 'string' && values.url.trim()) urlInput.removeAttribute('aria-invalid');
                if (values.type === 'clone' && previousType !== 'clone') {
                    frame.root.ownerDocument.defaultView?.setTimeout(() => {
                        if (!settled && form.getValues().type === 'clone') urlInput.focus();
                    }, 0);
                }
                previousType = values.type;
            },
        });
        const input = frame.body.querySelector<HTMLInputElement>('input');
        if (!input) {
            form.destroy(); frame.dispose();
            throw new Error('New Project form did not create its Git URL input');
        }
        const urlInput = input;
        urlInput.setAttribute('aria-label', 'Git URL');
        urlInput.setAttribute('autocapitalize', 'off');
        urlInput.setAttribute('autocorrect', 'off');
        urlInput.spellcheck = false;
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'fe-btn';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', cancel);
        const continueButton = document.createElement('button');
        continueButton.type = 'button';
        continueButton.className = 'fe-btn fe-btn-primary';
        continueButton.textContent = 'Continue';
        continueButton.addEventListener('click', accept);
        frame.footer.append(cancelButton, continueButton);
        frame.root.addEventListener('keydown', onKeyDown);
        frame.root.classList.add('show');
        frame.root.setAttribute('aria-hidden', 'false');
        document.body.append(frame.root);

        function finish(value: NewProjectModalResult | null): void {
            if (settled) return;
            settled = true;
            frame.root.removeEventListener('keydown', onKeyDown);
            cancelButton.removeEventListener('click', cancel);
            continueButton.removeEventListener('click', accept);
            form.destroy();
            frame.dispose();
            frame.root.remove();
            if (value) resolve(value);
            else reject('cancelled');
        }
        function accept(): void {
            const values = form.getValues();
            const type = values.type === 'clone' ? 'clone' : 'local';
            const url = typeof values.url === 'string' ? values.url.trim() : '';
            if (type === 'clone' && !url) {
                toastFn?.('Please enter a valid Git URL');
                urlInput.setAttribute('aria-invalid', 'true');
                urlInput.focus();
                return;
            }
            finish({type, url});
        }
        function onKeyDown(event: KeyboardEvent): void {
            if (event.defaultPrevented || event.isComposing) return;
            if (event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation(); cancel();
            } else if (event.key === 'Enter' && event.target === urlInput) {
                event.preventDefault(); accept();
            }
        }
    });
}
