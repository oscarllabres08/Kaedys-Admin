import { supabase } from './supabase';

const PAYMENT_PROOFS_BUCKET = 'payment-proofs';
const PUBLIC_MARKER = '/object/public/payment-proofs/';

export function paymentProofObjectPathFromPublicUrl(imageUrl: string): string | null {
  try {
    const u = new URL(imageUrl);
    const i = u.pathname.indexOf(PUBLIC_MARKER);
    if (i === -1) return null;
    return decodeURIComponent(u.pathname.slice(i + PUBLIC_MARKER.length));
  } catch {
    return null;
  }
}

/** Remove payment proof file from Storage and clear `payment_proof_url` on the order row. */
export async function deletePaymentProofAndClearUrl(orderId: string, paymentProofUrl: string): Promise<void> {
  const path = paymentProofObjectPathFromPublicUrl(paymentProofUrl);
  if (path) {
    const { error } = await supabase.storage.from(PAYMENT_PROOFS_BUCKET).remove([path]);
    if (error) console.warn('delete payment proof storage', error);
  }
  const { error: upErr } = await supabase.from('orders').update({ payment_proof_url: null }).eq('id', orderId);
  if (upErr) console.warn('clear payment_proof_url', upErr);
}
