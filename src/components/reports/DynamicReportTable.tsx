import { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCellValue } from "@/hooks/useDynamicColumns";

interface Column {
  key: string;
  label: string;
  visible: boolean;
}

interface Props<T> {
  columns: Column[];
  rows: T[];
  emptyMessage?: string;
  rowActions?: (row: T) => ReactNode;
}

export default function DynamicReportTable<T extends { id: string; metadata?: Record<string, unknown> | null }>(
  { columns, rows, emptyMessage = "No data", rowActions }: Props<T>,
) {
  const visible = columns.filter((c) => c.visible);

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 glass-card rounded-xl text-muted-foreground text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              {visible.map((c) => (
                <TableHead key={c.key} className="whitespace-nowrap text-xs font-medium">
                  {c.label}
                </TableHead>
              ))}
              {rowActions && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                {visible.map((c) => (
                  <TableCell key={c.key} className="text-sm whitespace-nowrap max-w-[240px] truncate">
                    {getCellValue(r as any, c.key)}
                  </TableCell>
                ))}
                {rowActions && <TableCell>{rowActions(r)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
