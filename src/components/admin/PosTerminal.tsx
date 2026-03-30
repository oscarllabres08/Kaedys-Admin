import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { MenuItem, supabase } from '../../lib/supabase';
import { formatSupabaseError } from '../../lib/formatSupabaseError';

type Line = { item: MenuItem; quantity: number };

function maxQtyForLine(item: MenuItem): number {
  if (!item.track_stock) return 999;
  return Math.max(0, item.stock_quantity ?? 0);
}

function getMainCategoryLabel(item: MenuItem): string {
  if (item.category === 'Others') return (item.custom_category ?? item.category ?? 'Others').trim();
  return (item.category ?? 'Others').trim();
}

export default function PosTerminal({
  menuItems,
  onSaleComplete,
}: {
  menuItems: MenuItem[];
  onSaleComplete: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const paymentOptions = ['Cash', 'GCash', 'Maya', 'PayPal'] as const;
  type PaymentMethod = (typeof paymentOptions)[number];
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const paymentWrapRef = useRef<HTMLDivElement | null>(null);
  const [notes, setNotes] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [posError, setPosError] = useState<string | null>(null);
  const [addedNote, setAddedNote] = useState<string | null>(null);
  const [pulseItemId, setPulseItemId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!paymentOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const el = paymentWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setPaymentOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPaymentOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [paymentOpen]);

  const showPosError = (message: string) => {
    setPosError(message);
    window.setTimeout(() => {
      setPosError((prev) => (prev === message ? null : prev));
    }, 3800);
  };

  const availableMenu = useMemo(
    () =>
      menuItems.filter((m) => {
        if (!m.is_available) return false;
        if (!m.track_stock) return true;
        return (m.stock_quantity ?? 0) > 0;
      }),
    [menuItems]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return availableMenu;
    return availableMenu.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        getMainCategoryLabel(m).toLowerCase().includes(q)
    );
  }, [availableMenu, search]);

  const addLine = (item: MenuItem) => {
    const maxQ = maxQtyForLine(item);
    if (maxQ <= 0) return;

    setLines((prev) => {
      const i = prev.findIndex((l) => l.item.id === item.id);
      if (i === -1) return [...prev, { item, quantity: 1 }];
      const next = [...prev];
      if (next[i].quantity >= maxQ) return prev;
      setPulseItemId(item.id);
      setAddedNote('Added');
      window.setTimeout(() => setPulseItemId((v) => (v === item.id ? null : v)), 650);
      window.setTimeout(() => setAddedNote(null), 800);
      next[i] = { ...next[i], quantity: next[i].quantity + 1 };
      return next;
    });
  };

  const setQty = (id: string, q: number) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.item.id === id);
      if (i === -1) return prev;
      const item = prev[i].item;
      const maxQ = maxQtyForLine(item);
      const n = Math.max(0, Math.min(q, maxQ));
      if (n === 0) return prev.filter((l) => l.item.id !== id);
      const next = [...prev];
      next[i] = { ...next[i], quantity: n };
      return next;
    });
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.item.id !== id));
  };

  const subtotal = lines.reduce((s, l) => s + l.item.price * l.quantity, 0);

  const submit = async () => {
    if (lines.length === 0 || busy) return;

    const cashNum = Number(cashReceived);
    if (paymentMethod === 'Cash') {
      if (!Number.isFinite(cashNum) || cashNum <= 0) {
        showPosError('Please enter the cash amount given by the customer.');
        return;
      }
      if (cashNum + 0.0001 < subtotal) {
        showPosError(`Insufficient cash. Need at least ₱${subtotal.toFixed(2)}.`);
        return;
      }
    }

    setBusy(true);
    try {

      const pItems = lines.map((l) => ({
        menu_item_id: l.item.id,
        menu_item_name: l.item.name,
        quantity: l.quantity,
        price: l.item.price,
        subtotal: l.item.price * l.quantity,
      }));

      const changeDue =
        paymentMethod === 'Cash' ? Math.max(0, cashNum - subtotal) : 0;
      const cashNote =
        paymentMethod === 'Cash'
          ? `[Cash received: ₱${cashNum.toFixed(2)} | *change: ₱${changeDue.toFixed(2)}]\n`
          : '';

      const finalNotes = `${notes.trim() ? `${notes.trim()}\n\n` : ''}${cashNote}`.trim() || null;

      const { data, error } = await supabase.rpc('place_pos_order', {
        p_total_amount: subtotal,
        p_final_amount: subtotal,
        p_payment_method: paymentMethod,
        p_items: pItems,
        p_notes: finalNotes,
      });
      if (error) throw error;
      if (!data) throw new Error('No order id');
      setLines([]);
      setNotes('');
      setCashReceived('');
      onSaleComplete();
    } catch (e) {
      showPosError(formatSupabaseError(e, 'Could not complete sale'));
    } finally {
      setBusy(false);
    }
  };

  const cashNum = Number(cashReceived);
  const changeDue = paymentMethod === 'Cash' && Number.isFinite(cashNum) ? cashNum - subtotal : 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_min(100%,420px)] gap-4">
      <div className="bg-neutral-900 rounded-xl border border-yellow-500/30 p-4 md:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <h3 className="text-xl font-bold text-yellow-300">Products</h3>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu…"
            className="flex-1 min-w-0 px-3 py-3 rounded-xl border border-yellow-500/25 bg-black/40 text-base text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-400/60"
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-[min(75vh,680px)] overflow-y-auto pr-1">
          {filtered.map((item) => {
            const maxQ = maxQtyForLine(item);
            const disabled = maxQ <= 0;
            const isPulsing = pulseItemId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => addLine(item)}
                className={`text-left rounded-xl border p-2.5 transition-all ${
                  disabled
                    ? 'border-white/10 bg-black/20 opacity-50 cursor-not-allowed'
                    : isPulsing
                      ? 'border-emerald-500/60 bg-emerald-500/10 ring-2 ring-emerald-400/60 hover:border-emerald-400/70 hover:bg-emerald-500/15 animate-pulse'
                      : 'border-yellow-500/25 bg-black/35 hover:border-yellow-400/50 hover:bg-black/50'
                }`}
              >
                <div className="aspect-[5/4] rounded-lg overflow-hidden border border-white/10 mb-2">
                  <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                </div>
                <p className="text-base font-semibold text-yellow-100 line-clamp-2 leading-snug">{item.name}</p>
                <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">
                  {getMainCategoryLabel(item)}
                </p>
                <p className="text-base text-emerald-200/90 mt-1 font-bold">₱{Number(item.price).toFixed(2)}</p>
                {item.track_stock ? (
                  <p className="text-sm text-gray-400 mt-0.5">Stock: {item.stock_quantity ?? 0}</p>
                ) : null}
              </button>
            );
          })}
        </div>
        {filtered.length === 0 ? (
          <p className="text-base text-gray-400 text-center py-6">No matching products in stock.</p>
        ) : null}
      </div>

      <div className="bg-neutral-900 rounded-xl border border-yellow-500/30 p-4 md:p-5 flex flex-col min-h-[320px]">
        <div className="flex items-center gap-2 mb-3">
          <ShoppingCart className="w-5 h-5 text-yellow-400" />
          <h3 className="text-xl font-bold text-yellow-300">Current sale</h3>
        </div>
        {posError ? (
          <div className="mb-3 rounded-xl border border-red-500/30 bg-red-950/35 px-3 py-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-bold text-red-200">Error</p>
              <p className="text-sm text-red-100/90 mt-0.5 break-words">{posError}</p>
            </div>
            <button
              type="button"
              onClick={() => setPosError(null)}
              className="shrink-0 rounded-lg border border-red-500/30 text-red-200 hover:bg-red-500/15 px-2 py-1 text-base font-bold"
              aria-label="Dismiss"
            >
              X
            </button>
          </div>
        ) : null}
        {addedNote ? (
          <p className="text-sm text-emerald-200 font-semibold -mt-4 mb-2 animate-pulse">
            {addedNote}
          </p>
        ) : null}

        <div className="flex-1 overflow-y-auto space-y-2 min-h-[120px] mb-4">
          {lines.length === 0 ? (
            <p className="text-base text-gray-400 text-center py-10">Add items from the grid.</p>
          ) : (
            lines.map((line) => (
              <div
                key={line.item.id}
                className="flex items-start gap-2 rounded-lg border border-yellow-500/15 bg-black/30 p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-gray-100 leading-snug">{line.item.name}</p>
                  <p className="text-base text-gray-400">₱{line.item.price.toFixed(2)} each</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label="Decrease"
                    onClick={() => setQty(line.item.id, line.quantity - 1)}
                    className="p-2 rounded-lg bg-black/50 border border-white/10 text-gray-200 hover:bg-white/10"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-10 text-center text-lg font-bold text-yellow-200">{line.quantity}</span>
                  <button
                    type="button"
                    aria-label="Increase"
                    onClick={() => setQty(line.item.id, line.quantity + 1)}
                    className="p-2 rounded-lg bg-black/50 border border-white/10 text-gray-200 hover:bg-white/10"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => removeLine(line.item.id)}
                    className="p-2 rounded-lg text-red-300 hover:bg-red-500/15 ml-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 border-t border-yellow-500/15 pt-4">
          <div>
            <label className="block text-base font-semibold text-gray-400 mb-1">Payment</label>
            <div ref={paymentWrapRef} className="relative">
              <button
                type="button"
                onClick={() => setPaymentOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-3 px-3 py-3 rounded-xl border border-yellow-500/25 bg-black/50 text-gray-100 text-base focus:outline-none focus:ring-2 focus:ring-yellow-400/60"
                aria-haspopup="listbox"
                aria-expanded={paymentOpen}
              >
                <span className="truncate">{paymentMethod}</span>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform ${paymentOpen ? 'rotate-180' : 'rotate-0'}`}
                />
              </button>

              {paymentOpen ? (
                <div
                  role="listbox"
                  className="absolute z-[70] mt-2 w-full overflow-hidden rounded-xl border border-yellow-500/25 bg-neutral-950/95 shadow-lg"
                >
                  {paymentOptions.map((opt) => {
                    const selected = opt === paymentMethod;
                    return (
                      <button
                        key={opt}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setPaymentMethod(opt);
                          setCashReceived('');
                          setPaymentOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left text-base transition-colors ${
                          selected
                            ? 'bg-yellow-400/20 text-yellow-200'
                            : 'bg-transparent text-gray-100 hover:bg-white/10'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          {paymentMethod === 'Cash' && (
            <div>
              <label className="block text-base font-semibold text-gray-400 mb-1">
                Cash received (₱)
              </label>
              <input
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value)}
                inputMode="decimal"
                className="w-full px-3 py-3 rounded-xl border border-yellow-500/25 bg-black/40 text-base text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-400/60"
                placeholder={`e.g. ${subtotal.toFixed(2)}`}
              />
              <div className="mt-1 text-base text-gray-400">
                *change:{' '}
                <span
                  className={`font-semibold ${
                    Number.isFinite(changeDue) && changeDue >= 0 ? 'text-emerald-200' : 'text-red-300'
                  }`}
                >
                  ₱{Number.isFinite(changeDue) ? Math.max(0, changeDue).toFixed(2) : '0.00'}
                </span>
              </div>
            </div>
          )}
          <div>
            <label className="block text-base font-semibold text-gray-400 mb-1">Notes (optional)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Table, name on receipt…"
              className="w-full px-3 py-3 rounded-xl border border-yellow-500/25 bg-black/40 text-base text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-400/60"
            />
          </div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-base text-gray-400">Total</p>
              <p className="text-3xl font-extrabold text-yellow-300 tabular-nums">₱{subtotal.toFixed(2)}</p>
            </div>
            <button
              type="button"
              disabled={lines.length === 0 || busy}
              onClick={() => void submit()}
              className="px-5 py-4 rounded-xl bg-emerald-600 text-white font-bold text-base hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Complete sale
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
