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
  const margin = 36;
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString();

  // Header band
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 0, pageWidth, 64, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(dealerName || "Dealership", margin, 28);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(title, margin, 48);

  doc.setFontSize(9);
  const rightLine1 = `Report Date: ${dateStr}`;
  const rightLine2 = `Generated: ${timeStr}  •  ${rows.length} record${rows.length === 1 ? "" : "s"}`;
  doc.text(rightLine1, pageWidth - margin, 28, { align: "right" });
  doc.text(rightLine2, pageWidth - margin, 44, { align: "right" });

  // Filters block
  doc.setTextColor(60, 60, 60);
  let y = 84;
  const activeFilters = filters.filter((f) => f.value && f.value !== "all");
  if (activeFilters.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Applied Filters", margin, y);
    doc.setFont("helvetica", "normal");
    y += 4;
    const text = activeFilters.map((f) => `${f.label}: ${f.value}`).join("   •   ");
    const wrapped = doc.splitTextToSize(text, pageWidth - margin * 2);
    doc.text(wrapped, margin, y + 10);
    y += 10 + wrapped.length * 11 + 4;
  }

  autoTable(doc, {
    startY: y + 4,
    head: [columns.map((c) => c.label)],
    body: rows.map((r) => columns.map((c) => fmt(r[c.key]))),
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 9,
      cellPadding: 6,
      lineColor: [220, 220, 220],
      lineWidth: 0.5,
      textColor: [30, 30, 30],
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 10,
      halign: "left",
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      const current = data.pageNumber;
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(
        `${dealerName || ""}${dealerName ? " — " : ""}${title}`,
        margin,
        pageHeight - 16,
      );
      doc.text(`Page ${current} of ${pageCount}`, pageWidth - margin, pageHeight - 16, { align: "right" });
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
