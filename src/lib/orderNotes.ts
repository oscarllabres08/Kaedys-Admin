/**
 * Cart checkout appends `Customer: …` and `Email: …` lines to `orders.notes`.
 * Returns only the customer's free-text instructions, or null if there were none.
 */
export function extractCustomerInstructionFromNotes(notes: string | null): string | null {
  const raw = (notes || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return null;

  // User typed instructions: "…\n\nCustomer: …\nEmail: …"
  let s = raw.replace(/\n\nCustomer:\s[^\n]+\nEmail:\s[^\n]+\s*$/, '');
  s = s.trim();

  // No user notes: payload is only "Customer: …\nEmail: …" (no "\n\n" before Customer)
  if (/^Customer:\s[^\n]+\nEmail:\s[^\n]+$/u.test(s)) {
    return null;
  }

  return s || null;
}
