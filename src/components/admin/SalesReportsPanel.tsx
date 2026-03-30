import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, TrendingUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { buildSalesReportExcelHtml, downloadArchivedOrdersExcel, type OrderWithItems } from '../../lib/exportArchivedOrdersCsv';

type ChannelFilter = 'all' | 'online' | 'pos';

type SalesRow = {
  id: string;
  created_at: string;
  final_amount: number;
  order_channel: string | null;
  payment_method: string | null;
};

function toIso(d: Date) {
  return d.toISOString();
}

function monthName(monthIndex0: number) {
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return names[Math.max(0, Math.min(11, monthIndex0))] ?? 'Month';
}

function startEndForMonthYear(month: number, year: number): { start: Date; end: Date } {
  const monthIndex0 = Math.max(0, Math.min(11, month - 1));
  const start = new Date(year, monthIndex0, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex0 + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function startEndForToday(d: Date): { start: Date; end: Date } {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export default function SalesReportsPanel() {
  const now = new Date();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');

  const [dateMode, setDateMode] = useState<'month' | 'today'>('today');
  const [todayDate, setTodayDate] = useState<Date>(() => new Date());

  const range = useMemo(() => {
    if (dateMode === 'today') return startEndForToday(todayDate);
    return startEndForMonthYear(month, year);
  }, [dateMode, month, year, todayDate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from('orders')
        .select('id, final_amount, order_channel, created_at, payment_method')
        .eq('status', 'completed')
        .gte('created_at', toIso(range.start))
        .lte('created_at', toIso(range.end))
        .order('created_at', { ascending: false });
      if (qErr) throw qErr;
      setRows((data || []) as SalesRow[]);
    } catch (e) {
      console.error(e);
      setError('Could not load sales. Apply the latest database migration if columns are missing.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    let all = 0;
    let online = 0;
    let pos = 0;
    for (const r of rows) {
      const v = Number(r.final_amount) || 0;
      all += v;
      const ch = r.order_channel || 'online';
      if (ch === 'pos') pos += v;
      else online += v;
    }
    return { all, online, pos, count: rows.length };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (channelFilter === 'all') return rows;
    return rows.filter((r) => (r.order_channel || 'online') === channelFilter);
  }, [rows, channelFilter]);

  const exportExcel = useCallback(async () => {
    if (filteredRows.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from('orders')
        .select('*, order_items (*)')
        .eq('status', 'completed')
        .gte('created_at', toIso(range.start))
        .lte('created_at', toIso(range.end))
        .order('created_at', { ascending: false });

      if (qErr) throw qErr;
      const list = (data || []) as OrderWithItems[];
      const selected =
        channelFilter === 'all'
          ? list
          : list.filter((o) => (o.order_channel || 'online') === channelFilter);

      if (selected.length === 0) {
        setError('No records to export for this selection.');
        return;
      }

      const html = buildSalesReportExcelHtml(selected);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadArchivedOrdersExcel(
        html,
        `kaedys-sales-report-${year}-${String(month).padStart(2, '0')}-${channelFilter}-${stamp}.xls`
      );
    } catch (e) {
      console.error(e);
      setError('Could not export sales report. Apply the latest database migration if needed.');
    } finally {
      setExporting(false);
    }
  }, [channelFilter, filteredRows.length, month, range.end, range.start, year]);

  const yearOptions = useMemo(() => {
    const base = now.getFullYear();
    const years: number[] = [];
    for (let y = base - 5; y <= base + 1; y++) years.push(y);
    return years;
  }, [now]);

  return (
    <div className="bg-neutral-900 rounded-xl border border-yellow-500/30 p-4 md:p-6">
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 mb-6">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-yellow-400" />
          <h2 className="text-xl font-bold text-yellow-300">Sales &amp; revenue</h2>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-end gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-400">Month</label>
            <select
              value={month}
            onChange={(e) => {
              setDateMode('month');
              setMonth(Number(e.target.value));
            }}
              className="px-3 py-2 rounded-lg border border-yellow-500/25 bg-black/40 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400/60"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {monthName(m - 1)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-400">Year</label>
            <select
              value={year}
            onChange={(e) => {
              setDateMode('month');
              setYear(Number(e.target.value));
            }}
              className="px-3 py-2 rounded-lg border border-yellow-500/25 bg-black/40 text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400/60"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              setTodayDate(d);
              setDateMode('today');
              setMonth(d.getMonth() + 1);
              setYear(d.getFullYear());
            }}
            className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
              dateMode === 'today'
                ? 'bg-yellow-400 text-black border-yellow-400'
                : 'border-yellow-500/25 text-gray-300 hover:bg-white/5'
            }`}
          >
            Today
          </button>
        </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={filteredRows.length === 0 || exporting}
              onClick={() => void exportExcel()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border border-yellow-500/30 text-yellow-200 hover:bg-yellow-400/10 disabled:opacity-40"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Exporting...' : 'Export Excel'}
            </button>
          </div>
        </div>
      </div>

      <p className="text-sm text-gray-400 mb-4">
        {dateMode === 'today' ? 'Today' : `${monthName(month - 1)} ${year}`} · completed orders only
      </p>

      <div className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-yellow-500/20 bg-black/35 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Total sales</p>
          <p className="text-2xl font-extrabold text-yellow-300 tabular-nums mt-1">₱{totals.all.toFixed(2)}</p>
          <p className="text-xs text-gray-500 mt-2">{totals.count} orders</p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-black/35 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Online orders</p>
          <p className="text-2xl font-extrabold text-emerald-200 tabular-nums mt-1">₱{totals.online.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-sky-500/20 bg-black/35 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Walk-in (POS)</p>
          <p className="text-2xl font-extrabold text-sky-200 tabular-nums mt-1">₱{totals.pos.toFixed(2)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => setChannelFilter('all')}
          className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
            channelFilter === 'all'
              ? 'bg-yellow-400 text-black border-yellow-400'
              : 'border-yellow-500/25 text-gray-300 hover:bg-white/5'
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setChannelFilter('online')}
          className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
            channelFilter === 'online'
              ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30'
              : 'border-yellow-500/25 text-gray-300 hover:bg-white/5'
          }`}
        >
          Online Orders
        </button>
        <button
          type="button"
          onClick={() => setChannelFilter('pos')}
          className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
            channelFilter === 'pos'
              ? 'bg-sky-500/20 text-sky-200 border-sky-500/30'
              : 'border-yellow-500/25 text-gray-300 hover:bg-white/5'
          }`}
        >
          Walk in (POS)
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-yellow-400 animate-spin" />
        </div>
      ) : error ? (
        <p className="text-red-300 text-sm">{error}</p>
      ) : filteredRows.length === 0 ? (
        <p className="text-gray-400 text-center py-8 text-base">No records for this selection.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-yellow-500/15">
          <table className="min-w-full text-left text-base">
            <thead className="sticky top-0 bg-neutral-950/95 backdrop-blur-sm border-b border-yellow-500/20 text-sm uppercase tracking-wide text-gray-300">
              <tr>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">When</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Tag</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Order</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Payment</th>
                <th className="px-4 py-3 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-yellow-500/10">
              {filteredRows.map((r) => {
                const ch = r.order_channel || 'online';
                const tagLabel = ch === 'pos' ? 'POS (Walk-in)' : 'Online Order';
                const tagClass =
                  ch === 'pos'
                    ? 'bg-sky-500/15 text-sky-200 border border-sky-500/30'
                    : 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30';
                return (
                  <tr key={r.id} className="bg-black/20 hover:bg-black/35">
                    <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap tabular-nums">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-full text-[11px] font-semibold ${tagClass}`}>
                        {tagLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-yellow-200 font-semibold whitespace-nowrap">
                      #{r.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-200 whitespace-nowrap">
                      {r.payment_method || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-yellow-300 tabular-nums">
                      ₱{Number(r.final_amount || 0).toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
