import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type ExportColumn = { key: string; label: string };

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export function exportToCSV(filename: string, columns: ExportColumn[], rows: any[]) {
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows
    .map((r) => columns.map((c) => escape(fmt(r[c.key]))).join(","))
    .join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, `${filename}.csv`);
}

export function exportToPDF(
  title: string,
  filename: string,
  columns: ExportColumn[],
  rows: any[],
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text(title, 40, 40);
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString()} • ${rows.length} rows`, 40, 56);
  autoTable(doc, {
    startY: 70,
    head: [columns.map((c) => c.label)],
    body: rows.map((r) => columns.map((c) => fmt(r[c.key]))),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [37, 99, 235] },
  });
  doc.save(`${filename}.pdf`);
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
