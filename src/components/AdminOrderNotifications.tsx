import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CheckCircle2, MousePointerClick, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { extractCustomerInstructionFromNotes } from '../lib/orderNotes';

type OrderInsertRow = {
  id: string;
  user_id: string;
  final_amount: number;
  payment_method: string;
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
  paymentMethod: string;
  finalAmount: number;
  contactPhone: string;
  deliveryAddress: string;
  specialInstructions: string | null;
};

function playFallbackBeep(ctx: AudioContext) {
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(920, ctx.currentTime);
    g.gain.setValueAtTime(0.1, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.12);
  } catch {
    // ignore
  }
}

export default function AdminOrderNotifications({
  enabled,
  soundSrc = null,
}: AdminOrderNotificationsProps) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  const soundUnlockedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
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

  const unlockAudio = useCallback(async () => {
    const html = audioRef.current;
    if (html) {
      try {
        html.volume = 0.001;
        await html.play();
        html.pause();
        html.currentTime = 0;
        html.volume = 1;
      } catch {
        // still try Web Audio below
      }
    }

    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx && !audioContextRef.current) {
      try {
        const ctx = new Ctx();
        await ctx.resume();
        audioContextRef.current = ctx;
      } catch {
        // ignore
      }
    } else if (audioContextRef.current?.state === 'suspended') {
      try {
        await audioContextRef.current.resume();
      } catch {
        // ignore
      }
    }

    soundUnlockedRef.current = true;
    setSoundUnlocked(true);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onFirstInteraction = () => {
      void unlockAudio();
    };
    window.addEventListener('pointerdown', onFirstInteraction, { passive: true });
    window.addEventListener('keydown', onFirstInteraction);
    return () => {
      window.removeEventListener('pointerdown', onFirstInteraction);
      window.removeEventListener('keydown', onFirstInteraction);
    };
  }, [enabled, unlockAudio]);

  const playAlertSound = useCallback(async () => {
    if (!soundUnlockedRef.current) return;

    const html = audioRef.current;
    if (html) {
      try {
        html.currentTime = 0;
        await html.play();
        return;
      } catch {
        // fall through to beep
      }
    }

    const ctx = audioContextRef.current;
    if (ctx && ctx.state === 'running') {
      playFallbackBeep(ctx);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const poll = async (isInitial: boolean) => {
      if (cancelled) return;

      try {
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
              specialInstructions: extractCustomerInstructionFromNotes(row.notes),
            }));

            if (newItems.length > 0) {
              setItems((prev) => [...newItems.reverse(), ...prev].slice(0, 5));

              void playAlertSound();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playAlertSound stable; avoid restarting poll
  }, [enabled]);

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
    <div className="fixed top-4 right-4 z-[85] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3">
      {!soundUnlocked ? (
        <button
          type="button"
          onClick={() => void unlockAudio()}
          className="group relative w-full overflow-hidden rounded-2xl border-2 border-yellow-400/55 bg-gradient-to-br from-yellow-500/[0.12] via-neutral-950/95 to-neutral-950/95 px-3 py-3 text-left shadow-[0_0_28px_rgba(250,204,21,0.12)] backdrop-blur transition-all hover:border-yellow-400/90 hover:shadow-[0_0_36px_rgba(250,204,21,0.22)] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/80 sm:px-4 sm:py-3.5"
        >
          <span
            className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-yellow-400/25 ring-offset-0 ring-offset-transparent animate-pulse"
            aria-hidden
          />
          <div className="relative flex gap-3">
            <div className="relative flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl border border-yellow-500/35 bg-black/50 shadow-inner">
              <VolumeX className="h-6 w-6 text-yellow-300" aria-hidden />
              <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-yellow-400 text-black shadow-md ring-2 ring-neutral-950 animate-bounce">
                <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
              </span>
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="flex flex-wrap items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-yellow-300">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-yellow-400" aria-hidden />
                Tap to hear new orders
              </p>
              <p className="mt-1 text-[11px] leading-snug text-gray-200">
                The browser mutes alerts until you interact.{' '}
                <span className="font-semibold text-white">Tap this card</span> or press a key — once — to
                unlock sounds.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-400 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-black shadow-md">
                  <MousePointerClick className="h-3 w-3" aria-hidden />
                  Tap here
                </span>
                <span className="text-[10px] font-medium text-yellow-200/90">← Required step</span>
              </div>
            </div>
          </div>
        </button>
      ) : (
        <div
          role="status"
          aria-live="polite"
          className="flex w-full items-start gap-3 rounded-2xl border border-emerald-500/45 bg-gradient-to-br from-emerald-500/[0.14] via-neutral-950/95 to-neutral-950/95 px-3 py-2.5 shadow-[0_0_20px_rgba(16,185,129,0.12)] backdrop-blur sm:px-4 sm:py-3"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/35 bg-emerald-500/15">
            <Volume2 className="h-5 w-5 text-emerald-300" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
              Order sounds are on
            </p>
            <p className="mt-1 text-[11px] leading-snug text-gray-200">
              New orders will play an alert in this tab. If you stop hearing it, refresh the page and tap
              once again — browsers can suspend audio after idle.
            </p>
          </div>
        </div>
      )}

      {items.map((n) => (
          <div
            key={n.id}
            className="overflow-hidden rounded-2xl border border-yellow-500/25 bg-neutral-950/95 shadow-2xl backdrop-blur"
          >
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-yellow-500/25 bg-yellow-400/10">
                  <Bell className="h-5 w-5 text-yellow-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-yellow-200">
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
                      className="rounded-lg p-1.5 text-gray-300 hover:bg-white/10 hover:text-white"
                      aria-label="Dismiss notification"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-xl border border-yellow-500/15 bg-black/30 p-2.5">
                      <p className="text-[10px] font-semibold text-gray-400">Total</p>
                      <p className="mt-0.5 text-sm font-extrabold text-yellow-300">
                        ₱{n.finalAmount.toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-yellow-500/15 bg-black/30 p-2.5">
                      <p className="text-[10px] font-semibold text-gray-400">Contact</p>
                      <p className="mt-0.5 break-words text-sm font-semibold text-gray-100">
                        {n.contactPhone}
                      </p>
                    </div>
                  </div>

                  {n.specialInstructions ? (
                    <div className="mt-2 rounded-xl border border-yellow-500/15 bg-black/30 p-2.5">
                      <p className="text-[10px] font-semibold text-gray-400">Special instructions</p>
                      <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-xs text-gray-200">
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
