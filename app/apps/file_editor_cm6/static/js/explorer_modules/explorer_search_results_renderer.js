export function renderNameResults(container, data, deps) {
  const results = data.results || [];
  const list = document.createElement('div');
  list.className = 'fe-search-list';

  results.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'fe-search-item';
    row.onclick = async () => {
      if (item.type === 'file') {
        if (window.appOpenFileRel) {
          try {
            deps.expandToFile(item.rel);
            await window.appOpenFileRel(item.rel, deps.getProjectPath() || null);
            deps.closeDrawerIfMobile();
          } catch (e) {
            deps.toast('Failed to open file: ' + (e?.message || 'unknown error'));
          }
        } else {
          deps.toast('File opener not available');
        }
      } else if (item.type === 'dir') {
        deps.closeSearchOverlay();
        deps.expandToPath(item.rel);
      }
    };

    const icon = document.createElement('span');
    icon.className = 'fe-search-icon';
    if (item.type === 'dir') {
      icon.textContent = '📁';
    } else {
      icon.textContent = '📄';
      deps.applySetiIconToSpan(icon, deps.basename(item.rel || ''), 'file');
    }
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'fe-search-name';
    name.textContent = item.rel;
    row.appendChild(name);

    list.appendChild(row);
  });

  container.appendChild(list);
  if (data.truncated) {
    const notice = document.createElement('div');
    notice.className = 'fe-search-notice';
    notice.textContent = `Showing first ${data.count} results`;
    container.appendChild(notice);
  }
}

export function renderContentResults(container, data, deps) {
  const list = document.createElement('div');
  list.className = 'fe-search-list';

  (data.results || []).forEach((fileResult) => {
    const fileGroup = document.createElement('div');
    fileGroup.className = 'fe-search-file-group';

    const matches = fileResult.matches || [];
    const fileHeader = document.createElement('div');
    fileHeader.className = 'fe-search-file-header';
    fileHeader.textContent = `${fileResult.rel} (${matches.length})`;
    fileGroup.appendChild(fileHeader);

    matches.forEach((match) => {
      const matchRow = document.createElement('div');
      matchRow.className = 'fe-search-match';
      matchRow.onclick = async () => {
        if (window.appOpenFileRel) {
          try {
            deps.expandToFile(fileResult.rel);
            await window.appOpenFileRel(fileResult.rel, deps.getProjectPath() || null, {
              line: match.line,
              focus: false,
              scrollY: 'center',
            });
            deps.closeDrawerIfMobile();
          } catch (e) {
            deps.toast('Failed to open file: ' + (e?.message || 'unknown error'));
          }
        } else {
          deps.toast('File opener not available');
        }
      };

      const lineNum = document.createElement('span');
      lineNum.className = 'fe-search-line-num';
      lineNum.textContent = match.line;
      matchRow.appendChild(lineNum);

      const snippet = document.createElement('span');
      snippet.className = 'fe-search-snippet';
      snippet.textContent = match.snippet;
      matchRow.appendChild(snippet);

      fileGroup.appendChild(matchRow);
    });

    list.appendChild(fileGroup);
  });

  container.appendChild(list);
  if (data.truncated) {
    const notice = document.createElement('div');
    notice.className = 'fe-search-notice';
    notice.textContent = `Showing ${data.file_count} files, ${data.match_count} matches`;
    container.appendChild(notice);
  }
}
