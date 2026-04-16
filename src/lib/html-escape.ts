/**
 * Escapes HTML special characters in a string to prevent XSS when
 * interpolating user-supplied content into HTML email bodies or
 * any other HTML context.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
