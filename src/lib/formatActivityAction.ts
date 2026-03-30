/**
 * Turns stored audit keys like `order.status_changed` into readable labels for the UI.
 */
export function formatActivityActionLabel(action: string): string {
  const t = action?.trim();
  if (!t) return '';
  return t
    .replace(/\./g, ' ')
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
