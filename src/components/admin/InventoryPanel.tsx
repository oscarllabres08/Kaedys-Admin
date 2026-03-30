import { useCallback, useEffect, useState } from 'react';
import { Loader2, Package } from 'lucide-react';
import { MenuItem, supabase } from '../../lib/supabase';
import { formatSupabaseError } from '../../lib/formatSupabaseError';

export type StockMovementRow = {
  id: string;
  menu_item_id: string;
  quantity_delta: number;
  reason: string;
  order_id: string | null;
  notes: string | null;
  created_at: string;
};

export default function InventoryPanel({
  menuItems,
  onMenuChanged,
}: {
  menuItems: MenuItem[];
  onMenuChanged: () => void;
}) {
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [adjustItem, setAdjustItem] = useState<MenuItem | null>(null);
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [toggleBusy, setToggleBusy] = useState<string | null>(null);

  const loadMovements = useCallback(async () => {
    setLoadingMovements(true);
    try {
      const { data, error } = await supabase
        .from('stock_movements')
        .select('id, menu_item_id, quantity_delta, reason, order_id, notes, created_at')
        .order('created_at', { ascending: false })
        .limit(150);
      if (error) throw error;
      setMovements((data || []) as StockMovementRow[]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMovements(false);
    }
  }, []);

  useEffect(() => {
    void loadMovements();
  }, [loadMovements]);

  const nameByMenuId = useCallback(
    (id: string) => menuItems.find((m) => m.id === id)?.name ?? id.slice(0, 8),
    [menuItems]
  );

  const handleToggleTrack = async (item: MenuItem) => {
    setToggleBusy(item.id);
    try {
      const next = !item.track_stock;
      const { error } = await supabase.from('menu_items').update({ track_stock: next }).eq('id', item.id);
      if (error) throw error;
      await onMenuChanged();
    } catch (e) {
      window.alert(formatSupabaseError(e, 'Could not update'));
    } finally {
      setToggleBusy(null);
    }
  };

  const submitAdjust = async () => {
    if (!adjustItem) return;
    const n = parseInt(adjustDelta, 10);
    if (!Number.isFinite(n) || n === 0) {
      window.alert('Enter a non-zero whole number (positive to add stock, negative to remove).');
      return;
    }
    setAdjustBusy(true);
    try {
      const { error } = await supabase.rpc('adjust_menu_stock', {
        p_menu_item_id: adjustItem.id,
        p_delta: n,
        p_notes: adjustNotes.trim() || null,
      });
      if (error) throw error;
      setAdjustItem(null);
      setAdjustDelta('');
      setAdjustNotes('');
      await onMenuChanged();
      await loadMovements();
    } catch (e) {
      window.alert(formatSupabaseError(e, 'Adjustment failed'));
    } finally {
      setAdjustBusy(false);
    }
  };

  const sorted = [...menuItems].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <section className="bg-neutral-900 rounded-xl border border-yellow-500/30 p-4 md:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Package className="w-5 h-5 text-yellow-400" />
          <h2 className="text-xl font-bold text-yellow-300">Stock by product</h2>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Turn on <span className="text-gray-200">Track stock</span> to deduct inventory on online and POS sales. Use
          adjustments to correct counts or receive deliveries.
        </p>
        <div className="overflow-x-auto rounded-xl border border-yellow-500/15">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-black/40 text-gray-400 uppercase tracking-wide text-xs">
              <tr>
                <th className="px-3 py-2.5">Product</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Track</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Qty</th>
                <th className="px-3 py-2.5">Adjust</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-yellow-500/10">
              {sorted.map((item) => (
                <tr key={item.id} className="bg-black/20">
                  <td className="px-3 py-2.5 text-gray-100 font-medium max-w-[14rem] break-words">{item.name}</td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      disabled={toggleBusy === item.id}
                      onClick={() => void handleToggleTrack(item)}
                      className={`text-xs font-semibold px-2 py-1 rounded-lg border ${
                        item.track_stock
                          ? 'border-emerald-500/40 text-emerald-200 bg-emerald-500/10'
                          : 'border-white/15 text-gray-400 bg-black/30'
                      }`}
                    >
                      {toggleBusy === item.id ? '…' : item.track_stock ? 'On' : 'Off'}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-yellow-100 font-semibold">
                    {item.track_stock ? item.stock_quantity ?? 0 : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustItem(item);
                        setAdjustDelta('');
                        setAdjustNotes('');
                      }}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-yellow-400/15 text-yellow-200 border border-yellow-500/30 hover:bg-yellow-400/25"
                    >
                      Adjust
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-neutral-900 rounded-xl border border-yellow-500/30 p-4 md:p-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-lg font-bold text-yellow-300">Recent stock movements</h3>
          <button
            type="button"
            onClick={() => void loadMovements()}
            className="text-sm font-semibold text-yellow-200/90 hover:text-yellow-100"
          >
            Refresh
          </button>
        </div>
        {loadingMovements ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-yellow-400 animate-spin" />
          </div>
        ) : movements.length === 0 ? (
          <p className="text-sm text-gray-400">No movements logged yet.</p>
        ) : (
          <div className="overflow-x-auto max-h-[min(50vh,400px)] overflow-y-auto rounded-xl border border-yellow-500/15">
            <table className="min-w-full text-left text-base">
              <thead className="sticky top-0 bg-neutral-950/95 text-gray-400 text-sm uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Δ</th>
                  <th className="px-3 py-2">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-yellow-500/10">
                {movements.map((m) => (
                  <tr key={m.id} className="bg-black/15">
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap tabular-nums text-sm">
                      {new Date(m.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-gray-100">{nameByMenuId(m.menu_item_id)}</td>
                    <td
                      className={`px-3 py-2 font-semibold tabular-nums ${
                        m.quantity_delta >= 0 ? 'text-emerald-300' : 'text-red-300'
                      }`}
                    >
                      {m.quantity_delta > 0 ? '+' : ''}
                      {m.quantity_delta}
                    </td>
                    <td className="px-3 py-2 text-gray-300 text-sm">
                      {m.reason}
                      {m.notes ? ` — ${m.notes}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adjustItem ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close"
            onClick={() => !adjustBusy && setAdjustItem(null)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-yellow-500/30 bg-neutral-950 p-5 shadow-2xl">
            <h4 className="text-lg font-bold text-yellow-300 mb-1">Adjust stock</h4>
            <p className="text-sm text-gray-400 mb-4 break-words">{adjustItem.name}</p>
            <p className="text-xs text-gray-500 mb-2">
              Current:{' '}
              <span className="text-yellow-100 font-semibold">
                {adjustItem.track_stock ? adjustItem.stock_quantity ?? 0 : '—'}
              </span>
            </p>
            <label className="block text-xs font-semibold text-gray-400 mb-1">Quantity change</label>
            <input
              type="number"
              value={adjustDelta}
              onChange={(e) => setAdjustDelta(e.target.value)}
              placeholder="e.g. 10 or -2"
              className="w-full px-3 py-2 rounded-xl border border-yellow-500/25 bg-black/40 text-gray-100 mb-3"
            />
            <label className="block text-xs font-semibold text-gray-400 mb-1">Note (optional)</label>
            <input
              value={adjustNotes}
              onChange={(e) => setAdjustNotes(e.target.value)}
              placeholder="Delivery, spoilage…"
              className="w-full px-3 py-2 rounded-xl border border-yellow-500/25 bg-black/40 text-gray-100 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                disabled={adjustBusy}
                onClick={() => setAdjustItem(null)}
                className="px-4 py-2 rounded-lg bg-white/10 text-gray-200 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={adjustBusy}
                onClick={() => void submitAdjust()}
                className="px-4 py-2 rounded-lg bg-yellow-400 text-black text-sm font-semibold inline-flex items-center gap-2"
              >
                {adjustBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
