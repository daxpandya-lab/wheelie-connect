import { Outlet } from "react-router-dom";
import AppSidebar from "@/components/AppSidebar";

export default function DashboardLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
