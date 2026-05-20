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

  autoTable(doc, {
    startY: y,
    head: [columns.map((c) => c.label)],
    body: rows.map((r) => columns.map((c) => fmt(r[c.key]))),
    margin: { left: margin, right: margin, top: 70, bottom: 40 },
    styles: {
      fontSize: 9,
      cellPadding: 6,
      lineColor: border,
      lineWidth: 0.5,
      textColor: slate,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: slate,
      fontStyle: "bold",
      fontSize: 9.5,
      halign: "left",
      lineColor: border,
      lineWidth: 0.5,
    },
    alternateRowStyles: { fillColor: zebra },
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
