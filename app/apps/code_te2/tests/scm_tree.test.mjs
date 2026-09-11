import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { buildTree } from '../src/explorer/history/vscode_scm/tree/build.mjs';

test('pinned upstream async tree lazily expands, collapses and disposes', async () => {
  const result = await buildTree();
  assert.equal(Object.keys(result.metafile.inputs).length, 164);
  const win = new Window();
  const names = ['window', 'document', 'navigator', 'customElements', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'ResizeObserver', 'MouseEvent', 'KeyboardEvent', 'UIEvent'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let tree;
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: win[name] });
    // Browser globals must precede upstream module evaluation, just as in the app.
    const js = result.outputFiles.find(file => file.path.endsWith('.js'));
    const { CompressibleAsyncDataTree } = await import(`data:text/javascript;base64,${Buffer.from(js.contents).toString('base64')}`);
    const container = win.document.createElement('div');
    win.document.body.append(container);
    const root = { id: 'root' };
    const commit = { id: 'commit' };
    const file = { id: 'file' };
    const reads = [];
    let disposed = 0;
    tree = new CompressibleAsyncDataTree('TE2 history test', container,
      { getHeight: () => 22, getTemplateId: () => 'row' },
      { isIncompressible: () => true },
      [{
        templateId: 'row',
        renderTemplate: element => element,
        renderElement: (node, _index, element) => { element.textContent = node.element.id; },
        renderCompressedElements: () => assert.fail('commit/file rows must not compress'),
        disposeTemplate: () => { disposed++; },
      }],
      {
        hasChildren: element => element !== file,
        getChildren: async element => { reads.push(element.id); return element === root ? [commit] : [file]; },
      },
      { identityProvider: { getId: element => element.id }, compressionEnabled: false, accessibilityProvider: { getAriaLabel: element => element.id, getWidgetAriaLabel: () => 'History' } });
    tree.layout(220, 500);
    await tree.setInput(root);
    assert.deepEqual(reads, ['root']);
    assert.equal(tree.isCollapsed(commit), true);
    await tree.expand(commit);
    assert.deepEqual(reads, ['root', 'commit']);
    assert.equal(tree.isCollapsed(commit), false);
    tree.setSelection([file]);
    assert.deepEqual(tree.getSelection(), [file]);
    tree.collapse(commit);
    assert.equal(tree.isCollapsed(commit), true);
    // Disposal occurs with an active-node update pending: no production grace timer.
    tree.dispose();
    tree = undefined;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(disposed > 0, 'native row templates are disposed');
  } catch (error) {
    // Avoid printing the entire base64 module URL in a failed assertion stack.
    if (error instanceof Error) error.stack = error.stack?.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, 'upstream-tree');
    throw error;
  } finally {
    tree?.dispose();
    await win.happyDOM.abort();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
