(function() {
  const root = document.getElementById('fe-file-tree');
  const nodes = root.querySelectorAll('li.fe-tree-node[data-git-status]');
  console.log('Nodes with git-status:', nodes.length);
  
  nodes.forEach(n => {
    const status = n.dataset.gitStatus;
    const kind = n.dataset.kind;
    const rel = n.dataset.rel;
    
    // Try to find parent dir
    const parentUl = n.parentElement;
    const parentDir = parentUl?.closest('li.fe-tree-node[data-kind="dir"]');
    
    console.log(`${rel} (${kind}, ${status}) -> parent: ${parentDir?.dataset?.rel || 'NONE'}`);
  });
})();
