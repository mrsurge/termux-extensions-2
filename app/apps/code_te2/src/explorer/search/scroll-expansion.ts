/** One-way expansion: scroll reveals retained objects; existing rows never evict.
 * The listener belongs to the results element, so removing it releases the lane.
 * Buttons remain usable by keyboard and when there is no scrollable overflow.
 */
export function installScrollExpansion(container: HTMLElement): void {
  container.onscroll = () => {
    const bounds = container.getBoundingClientRect();
    if (!container.isConnected || bounds.height <= 0) return;
    for (const button of container.querySelectorAll<HTMLButtonElement>('[data-scroll-more]')) {
      const row = button.getBoundingClientRect();
      if (!button.disabled && row.height > 0 && row.bottom >= bounds.top && row.top <= bounds.bottom + 120) {
        button.click();
        break;
      }
    }
  };
}
