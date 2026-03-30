/**
 * User-facing text for common Postgres / PostgREST errors from Supabase.
 */
export function formatSupabaseError(error: unknown, fallback: string): string {
  if (error === null || error === undefined) return fallback;

  const e = error as {
    code?: string;
    message?: string;
    details?: string;
  };

  const code = e.code;
  const msg = typeof e.message === 'string' ? e.message : '';

  if (code === '23503' || msg.includes('violates foreign key constraint')) {
    if (msg.includes('menu_items') || msg.includes('order_items_menu_item_id')) {
      return 'This product is still linked to past orders. Apply the Supabase migration that sets order_items.menu_item_id to ON DELETE SET NULL (then run db push), or ask your developer.';
    }
    return 'This record is still used elsewhere (for example orders). Remove or archive related data first.';
  }

  if (code === '23505' || /duplicate key|already exists/i.test(msg)) {
    if (/username|customer_profiles_username/i.test(msg)) {
      return 'That username is already taken. Choose another.';
    }
    return 'This value already exists. Use a different name or identifier.';
  }

  if (code === '23514' || msg.includes('violates check constraint')) {
    return 'Invalid data: a validation rule failed. Check required fields and allowed values.';
  }

  if (
    code === '42501' ||
    msg.includes('permission denied') ||
    msg.includes('row-level security') ||
    msg.includes('RLS')
  ) {
    return 'You do not have permission for this action.';
  }

  if (code === 'PGRST116' || /0 rows/i.test(msg)) {
    return 'Nothing was found or nothing changed.';
  }

  if (msg.length > 0 && msg.length < 400) {
    return msg;
  }

  return fallback;
}
