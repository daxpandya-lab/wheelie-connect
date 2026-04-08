import { Search } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";

export default function TopBar({ title }: { title: string }) {
  const { profile } = useAuth();
  const initials = (profile?.full_name || "U").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <header className="h-16 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            className="h-9 w-56 rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <NotificationBell />
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold">
          {initials}
        </div>
      </div>
    </header>
  );
}
