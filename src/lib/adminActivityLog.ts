import { supabase } from './supabase';

export type LogAdminActivityInput = {
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

export async function logAdminActivity(
  actor: { id: string; email: string; fullName: string },
  input: LogAdminActivityInput
): Promise<void> {
  try {
    const { error } = await supabase.from('admin_activity_log').insert({
      admin_id: actor.id,
      admin_email: actor.email,
      admin_name: actor.fullName,
      action: input.action,
      resource_type: input.resourceType ?? null,
      resource_id: input.resourceId ?? null,
      summary: input.summary,
      metadata: input.metadata ?? {},
    });
    if (error) console.warn('admin_activity_log insert:', error.message);
  } catch (e) {
    console.warn('admin_activity_log failed', e);
  }
}
