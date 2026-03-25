import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

type OrderInsertRow = {
  id: string;
  user_id: string;
  final_amount: number;
  payment_method: 'COD' | 'GCash';
  delivery_address: string;
  contact_phone: string;
  notes: string | null;
  created_at: string;
};

type AdminOrderNotificationsProps = {
  enabled: boolean;
  soundSrc?: string | null;
};

type NotificationItem = {
  id: string;
  orderId: string;
  createdAt: string;
  paymentMethod: 'COD' | 'GCash';
  finalAmount: number;
  contactPhone: string;
  deliveryAddress: string;
  specialInstructions: string | null;
};

function extractSpecialInstructions(notes: string | null): string | null {
  const raw = (notes || '').trim();
  if (!raw) return null;
  const instruction = raw.split('\n\nCustomer:')[0]?.trim();
  return instruction || null;
}

export default function AdminOrderNotifications({
  enabled,
  soundSrc = null,
}: AdminOrderNotificationsProps) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSeenCreatedAtRef = useRef<string | null>(null);

  const audio = useMemo(() => {
    if (!soundSrc) return null;
    const el = new Audio(soundSrc);
    el.preload = 'auto';
    el.volume = 1;
    return el;
  }, [soundSrc]);

  useEffect(() => {
    audioRef.current = audio;
    return () => {
      audioRef.current = null;
    };
  }, [audio]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const poll = async (isInitial: boolean) => {
      if (cancelled) return;

      try {
        // On first run, just capture the latest created_at so we don't fire notifications for old orders.
        if (isInitial) {
          const { data } = await supabase
            .from('orders')
            .select('created_at')
            .order('created_at', { ascending: false })
            .limit(1);
          if (data && data[0]) {
            lastSeenCreatedAtRef.current = data[0].created_at as string;
          }
        } else {
          const lastSeen = lastSeenCreatedAtRef.current;
          let query = supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: true })
            .limit(10);

          if (lastSeen) {
            query = query.gt('created_at', lastSeen);
          }

          const { data } = await query;
          if (data && data.length > 0) {
            const rows = data as OrderInsertRow[];
            const newLast = rows[rows.length - 1].created_at;
            lastSeenCreatedAtRef.current = newLast;

            const newItems: NotificationItem[] = rows.map((row) => ({
              id: `${row.id}-${row.created_at}`,
              orderId: row.id,
              createdAt: row.created_at,
              paymentMethod: row.payment_method,
              finalAmount: Number(row.final_amount ?? 0),
              contactPhone: row.contact_phone,
              deliveryAddress: row.delivery_address,
              specialInstructions: extractSpecialInstructions(row.notes),
            }));

            if (newItems.length > 0) {
              setItems((prev) => [...newItems.reverse(), ...prev].slice(0, 5));

              try {
                const a = audioRef.current;
                if (a) {
                  a.currentTime = 0;
                  void a.play();
                }
              } catch {
                // ignore
              }

              // Notify other parts of the admin app (e.g. orders list) that
              // a new order has arrived so they can refresh if needed.
              try {
                window.dispatchEvent(
                  new CustomEvent('kaedys:new-order', {
                    detail: { count: newItems.length, lastOrderId: newItems[0]?.orderId },
                  })
                );
              } catch {
                // ignore
              }
            }
          }
        }
      } catch (err) {
        console.error('Error polling orders for notifications', err);
      } finally {
        if (!cancelled) {
          window.setTimeout(() => poll(false), 5000);
        }
      }
    };

    void poll(true);

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Auto-dismiss
  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((it) =>
      window.setTimeout(() => {
        setItems((prev) => prev.filter((p) => p.id !== it.id));
      }, 10000)
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [items]);

  if (!enabled) return null;

  return (
    <div className="fixed top-4 right-4 z-[80] flex flex-col gap-3 w-[min(420px,calc(100vw-2rem))]">
      {items.map((n) => (
        <div
          key={n.id}
          className="rounded-2xl border border-yellow-500/25 bg-neutral-950/95 backdrop-blur shadow-2xl overflow-hidden"
        >
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-2xl border border-yellow-500/25 bg-yellow-400/10 flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5 text-yellow-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-yellow-200 truncate">
                      New order #{n.orderId.slice(0, 8)}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {new Date(n.createdAt).toLocaleString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                      {' · '}
                      {n.paymentMethod}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((p) => p.id !== n.id))}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10"
                    aria-label="Dismiss notification"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-yellow-500/15 bg-black/30 p-2.5">
                    <p className="text-[10px] font-semibold text-gray-400">Total</p>
                    <p className="mt-0.5 text-sm font-extrabold text-yellow-300">
                      ₱{n.finalAmount.toFixed(2)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-yellow-500/15 bg-black/30 p-2.5">
                    <p className="text-[10px] font-semibold text-gray-400">Contact</p>
                    <p className="mt-0.5 text-sm font-semibold text-gray-100 break-words">
                      {n.contactPhone}
                    </p>
                  </div>
                </div>

                {n.specialInstructions ? (
                  <div className="mt-2 rounded-xl border border-yellow-500/15 bg-black/30 p-2.5">
                    <p className="text-[10px] font-semibold text-gray-400">Special instructions</p>
                    <p className="mt-0.5 text-xs text-gray-200 whitespace-pre-wrap break-words line-clamp-3">
                      {n.specialInstructions}
                    </p>
                  </div>
                ) : null}

                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      window.location.hash = '#orders';
                      setItems((prev) => prev.filter((p) => p.id !== n.id));
                    }}
                    className="text-xs font-semibold text-yellow-300 hover:text-yellow-200"
                  >
                    View orders
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

