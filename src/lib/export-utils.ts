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
) {
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const meta: string[] = [
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
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text(title, 40, 40);
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString()} • ${rows.length} rows`, 40, 56);

  let y = 72;
  if (filters.length) {
    doc.setFontSize(8);
    const lines = filters
      .filter((f) => f.value && f.value !== "all")
      .map((f) => `${f.label}: ${f.value}`);
    if (lines.length === 0) lines.push("Filters: none");
    const wrapped = doc.splitTextToSize(`Filters — ${lines.join("  •  ")}`, 760);
    doc.text(wrapped, 40, y);
    y += wrapped.length * 11 + 4;
  }

  autoTable(doc, {
    startY: y,
    head: [columns.map((c) => c.label)],
    body: rows.map((r) => columns.map((c) => fmt(r[c.key]))),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [37, 99, 235] },
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
