import type { Order, OrderItem } from './supabase';

export type OrderWithItems = Order & { order_items: OrderItem[] };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Placed date & time in one readable string (locale-aware). */
function formatPlacedDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** One line per item: "Name ×qty", HTML line breaks between lines for Excel. */
function formatProductsLinesHtml(items: OrderItem[]): string {
  if (!items.length) return '';
  return items
    .map((i) => `${escapeHtml(i.menu_item_name)} ×${String(i.quantity)}`)
    .join('<br/>');
}

/**
 * Excel-friendly HTML table (save as .xls). One row per order; products listed in one cell.
 * Order total is last column (centered). No customer personal data.
 */
export function buildArchivedOrdersReportExcelHtml(orders: OrderWithItems[]): string {
  const headers = [
    'Order number',
    'Date & time (placed)',
    'Products (name × qty)',
    'Order total (PHP)',
  ];

  const headerRow = `<tr>${headers
    .map((h, i) => {
      const align = i === 3 ? ' style="text-align:center;font-weight:bold"' : ' style="font-weight:bold"';
      return `<th${align}>${escapeHtml(h)}</th>`;
    })
    .join('')}</tr>`;

  const bodyRows: string[] = [];

  for (const order of orders) {
    const orderNum = escapeHtml(order.id.slice(0, 8));
    const placed = escapeHtml(formatPlacedDateTime(order.created_at));
    const total = (order.final_amount ?? 0).toFixed(2);
    const items = order.order_items?.length ? order.order_items : [];
    const productsHtml = formatProductsLinesHtml(items);

    bodyRows.push(
      `<tr><td>${orderNum}</td><td>${placed}</td><td style="vertical-align:top">${productsHtml || '&nbsp;'}</td><td style="text-align:center">${escapeHtml(total)}</td></tr>`
    );
  }

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
<meta charset="utf-8">
<meta name="ExcelCreated" content="1">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Archived orders</x:Name></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body>
<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt">
<thead>${headerRow}</thead>
<tbody>
${bodyRows.join('\n')}
</tbody>
</table>
</body>
</html>`;
}

/**
 * Excel-friendly HTML table for sales reports (one row per order; products listed in one cell).
 * Used by SalesReportsPanel (Online vs POS walk-in monitoring).
 */
export function buildSalesReportExcelHtml(orders: OrderWithItems[]): string {
  const headers = [
    'Order number',
    'Date & time (placed)',
    'Channel',
    'Payment method',
    'Products (name × qty)',
    'Order total (PHP)',
  ];

  const headerRow = `<tr>${headers
    .map((h, i) => {
      const align = i === headers.length - 1 ? ' style="text-align:center;font-weight:bold"' : ' style="font-weight:bold"';
      return `<th${align}>${escapeHtml(h)}</th>`;
    })
    .join('')}</tr>`;

  const bodyRows: string[] = [];

  for (const order of orders) {
    const orderNum = escapeHtml(order.id.slice(0, 8));
    const placed = escapeHtml(formatPlacedDateTime(order.created_at));
    const channel = (order.order_channel || 'online') === 'pos' ? 'POS (Walk-in)' : 'Online Order';
    const payment = order.payment_method ?? '';
    const total = (order.final_amount ?? 0).toFixed(2);
    const items = order.order_items?.length ? order.order_items : [];
    const productsHtml = formatProductsLinesHtml(items);

    bodyRows.push(
      `<tr><td>${orderNum}</td><td>${placed}</td><td>${escapeHtml(channel)}</td><td>${escapeHtml(payment)}</td><td style="vertical-align:top">${productsHtml || '&nbsp;'}</td><td style="text-align:center">${escapeHtml(total)}</td></tr>`
    );
  }

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
<meta charset="utf-8">
<meta name="ExcelCreated" content="1">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sales report</x:Name></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body>
<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt">
<thead>${headerRow}</thead>
<tbody>
${bodyRows.join('\n')}
</tbody>
</table>
</body>
</html>`;
}

export function downloadArchivedOrdersExcel(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
