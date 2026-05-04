import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, FileText, FileSpreadsheet } from "lucide-react";
import { exportToCSV, exportToPDF, type ExportColumn, type ExportFilter } from "@/lib/export-utils";

type Props = {
  title: string;
  filename: string;
  columns: ExportColumn[];
  rows: any[];
  filters?: ExportFilter[];
  disabled?: boolean;
};

export default function ExportMenu({ title, filename, columns, rows, filters = [], disabled }: Props) {
  const stamp = new Date().toISOString().slice(0, 10);
  const fname = `${filename}-${stamp}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={disabled || rows.length === 0}>
          <Download className="w-4 h-4" /> Export ({rows.length})
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => exportToCSV(fname, columns, rows, filters)}>
          <FileSpreadsheet className="w-4 h-4 mr-2" /> Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportToPDF(title, fname, columns, rows, filters)}>
          <FileText className="w-4 h-4 mr-2" /> Export as PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
