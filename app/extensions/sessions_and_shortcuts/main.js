// Sessions & Shortcuts (shim)
//
// This extension now hosts the framework_shells dashboard in an iframe.
// Keep JS intentionally minimal (layout-only).

export default async function initialize(container) {
  const frame = container.querySelector('.sas-frame');
  if (!frame) return;

  const resize = () => {
    try {
      const vh = Math.max(600, window.innerHeight - 160);
      frame.style.height = `${vh}px`;
    } catch (err) {
      // ignore
    }
  };

  resize();
  window.addEventListener('resize', resize);
}

