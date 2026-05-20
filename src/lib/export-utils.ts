import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type ExportColumn = { key: string; label: string };
export type ExportFilter = { label: string; value: string };

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function buildFilenameSuffix(filters: ExportFilter[]) {
  const parts = filters.filter((f) => f.value && f.value !== "all").map((f) => slug(`${f.label}-${f.value}`));
  return parts.length ? `__${parts.join("_")}` : "";
}

export function exportToCSV(
  filename: string,
  columns: ExportColumn[],
  rows: any[],
  filters: ExportFilter[] = [],
  dealerName?: string,
) {
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const meta: string[] = [
    ...(dealerName ? [`# Dealer: ${dealerName}`] : []),
    `# Generated: ${new Date().toLocaleString()}`,
    `# Rows: ${rows.length}`,
    ...filters.map((f) => `# ${f.label}: ${f.value || "—"}`),
    "",
  ];
  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => escape(fmt(r[c.key]))).join(",")).join("\n");
  const csv = [...meta, header, body].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, `${filename}${buildFilenameSuffix(filters)}.csv`);
}

export function exportToPDF(
  title: string,
  filename: string,
  columns: ExportColumn[],
  rows: any[],
  filters: ExportFilter[] = [],
  dealerName?: string,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString();

  const navy: [number, number, number] = [30, 58, 95];
  const slate: [number, number, number] = [30, 41, 59];
  const muted: [number, number, number] = [100, 116, 139];
  const border: [number, number, number] = [229, 231, 235];
  const zebra: [number, number, number] = [249, 250, 251];

  const drawHeader = () => {
    // Thin navy accent line at the very top
    doc.setDrawColor(navy[0], navy[1], navy[2]);
    doc.setLineWidth(2);
    doc.line(0, 0, pageWidth, 0);

    // Title left
    doc.setTextColor(slate[0], slate[1], slate[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(title.toUpperCase(), margin, 38);

    // Dealer + timestamp right
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    if (dealerName) {
      doc.setTextColor(slate[0], slate[1], slate[2]);
      doc.text(dealerName, pageWidth - margin, 28, { align: "right" });
    }
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.setFontSize(9);
    doc.text(`Generated: ${dateStr} • ${timeStr}`, pageWidth - margin, 42, { align: "right" });

    // Divider
    doc.setDrawColor(border[0], border[1], border[2]);
    doc.setLineWidth(0.5);
    doc.line(margin, 54, pageWidth - margin, 54);
  };

  drawHeader();

  // Report Parameters block
  let y = 72;
  const activeFilters = filters.filter((f) => f.value && f.value !== "all");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(slate[0], slate[1], slate[2]);
  doc.text("Report Parameters", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(muted[0], muted[1], muted[2]);
  const paramsText = activeFilters.length
    ? activeFilters.map((f) => `${f.label} = ${f.value}`).join("  |  ")
    : "No filters applied — showing all records";
  const recordCountText = `${rows.length} record${rows.length === 1 ? "" : "s"}`;
  const wrapped = doc.splitTextToSize(
    `Filters Applied: ${paramsText}   •   ${recordCountText}`,
    pageWidth - margin * 2,
  );
  doc.text(wrapped, margin, y + 12);
  y += 12 + wrapped.length * 11 + 8;

  // --- Consolidate columns for clean print layout (PDF only) ---
  // 1) Hide internal/system columns
  const BLACKLIST = /(session_id|metadata|tenant_id|^id$|_id$|assigned_to$)/i;
  let printCols = columns.filter((c) => !BLACKLIST.test(c.key));

  const has = (k: string) => printCols.some((c) => c.key === k);
  const drop = (...keys: string[]) => {
    printCols = printCols.filter((c) => !keys.includes(c.key));
  };
  const insertAfter = (afterKey: string, col: ExportColumn) => {
    const idx = printCols.findIndex((c) => c.key === afterKey);
    if (idx >= 0) printCols.splice(idx + 1, 0, col);
    else printCols.unshift(col);
  };

  // 2) Merge customer_name + phone_number → Customer
  if (has("customer_name") && has("phone_number")) {
    insertAfter("customer_name", { key: "__customer", label: "Customer" });
    drop("customer_name", "phone_number");
  }

  // 3) Merge vehicle_type + vehicle_model + registration_number → Vehicle Details
  const vehicleKeys = ["vehicle_type", "vehicle_model", "registration_number", "vehicle_number"];
  if (vehicleKeys.some(has)) {
    const anchor = vehicleKeys.find(has)!;
    insertAfter(anchor, { key: "__vehicle", label: "Vehicle Details" });
    drop(...vehicleKeys);
  }

  // Row resolver for merged keys
  const resolve = (row: any, key: string): string => {
    if (key === "__customer") {
      return [fmt(row.customer_name), fmt(row.phone_number)].filter(Boolean).join("\n");
    }
    if (key === "__vehicle") {
      const model = [fmt(row.vehicle_type), fmt(row.vehicle_model)].filter(Boolean).join(" ");
      const reg = fmt(row.registration_number || row.vehicle_number);
      return [model, reg].filter(Boolean).join("\n");
    }
    return fmt(row[key]);
  };

  // 4) Proportional column widths (weights). Long-text fields get more room.
  const weightFor = (key: string): number => {
    if (key === "__customer") return 2.2;
    if (key === "__vehicle") return 2.2;
    if (/(issue_description|notes|work_notes|parts_required|description|quotation)/i.test(key)) return 3;
    if (/(service_type|vehicle_interest|email)/i.test(key)) return 2;
    if (/(status|approval|source)/i.test(key)) return 1.1;
    if (/(date|time|created|updated)/i.test(key)) return 1.2;
    return 1.4;
  };
  const usableWidth = pageWidth - margin * 2;
  const weights = printCols.map((c) => weightFor(c.key));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const columnStyles: Record<number, { cellWidth: number }> = {};
  printCols.forEach((_, i) => {
    columnStyles[i] = { cellWidth: (usableWidth * weights[i]) / totalWeight };
  });

  autoTable(doc, {
    startY: y,
    head: [printCols.map((c) => c.label)],
    body: rows.map((r) => printCols.map((c) => resolve(r, c.key))),
    margin: { left: margin, right: margin, top: 70, bottom: 40 },
    tableWidth: usableWidth,
    styles: {
      fontSize: 9,
      cellPadding: { top: 6, right: 6, bottom: 6, left: 6 },
      lineColor: border,
      lineWidth: 0.5,
      textColor: slate,
      overflow: "linebreak",
      valign: "top",
      minCellHeight: 18,
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: slate,
      fontStyle: "bold",
      fontSize: 9.5,
      halign: "left",
      valign: "middle",
      lineColor: border,
      lineWidth: 0.5,
      cellPadding: { top: 9, right: 6, bottom: 9, left: 6 },
      minCellHeight: 24,
    },
    bodyStyles: { lineHeight: 1.25 },
    alternateRowStyles: { fillColor: zebra },
    columnStyles,
    didDrawPage: (data) => {
      if (data.pageNumber > 1) drawHeader();
      const pageCount = doc.getNumberOfPages();
      const current = data.pageNumber;
      doc.setFontSize(8);
      doc.setTextColor(muted[0], muted[1], muted[2]);
      doc.text(`Page ${current} of ${pageCount}`, pageWidth / 2, pageHeight - 18, { align: "center" });
    },
  });


  doc.save(`${filename}${buildFilenameSuffix(filters)}.pdf`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
