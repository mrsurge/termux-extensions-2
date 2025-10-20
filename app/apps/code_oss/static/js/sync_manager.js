
const createSyncManager = ({
  onModeChange = () => {},
  resumeDelay = 1500,
} = {}) => {
  let mode = 'streaming'; // 'streaming' or 'editing'
  let timer = null;

  const setMode = (newMode) => {
    if (mode === newMode) return;
    mode = newMode;
    console.log(`[SyncManager] Mode changed to: ${mode}`);
    onModeChange(mode);
  };

  const enterEditMode = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    setMode('editing');
    timer = setTimeout(() => {
      timer = null;
      exitEditMode();
    }, resumeDelay);
  };

  const exitEditMode = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    setMode('streaming');
  };

  const isStreaming = () => mode === 'streaming';
  const isEditing = () => mode === 'editing';

  return {
    enterEditMode,
    exitEditMode,
    isStreaming,
    isEditing,
    getMode: () => mode,
  };
};

export { createSyncManager };
