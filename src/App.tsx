import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import DashboardLayout from "@/components/DashboardLayout";
import DashboardPage from "@/pages/DashboardPage";
import CustomersPage from "@/pages/CustomersPage";
import LeadsPage from "@/pages/LeadsPage";
import ServiceBookingsPage from "@/pages/ServiceBookingsPage";
import TestDrivesPage from "@/pages/TestDrivesPage";
import ConversationsPage from "@/pages/ConversationsPage";
import CampaignsPage from "@/pages/CampaignsPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import SettingsPage from "@/pages/SettingsPage";
import SuperAdminPage from "@/pages/SuperAdminPage";
import UserManagementPage from "@/pages/UserManagementPage";
import FlowBuilderPage from "@/pages/FlowBuilderPage";
import AutomationsPage from "@/pages/AutomationsPage";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,        // 30s before refetch
      gcTime: 5 * 60 * 1000,       // 5min cache retention
      refetchOnWindowFocus: false,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public auth routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* Protected routes */}
            <Route element={<ProtectedRoute />}>
              <Route element={<DashboardLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/leads" element={<LeadsPage />} />
                <Route path="/service-bookings" element={<ServiceBookingsPage />} />
                <Route path="/test-drives" element={<TestDrivesPage />} />
                <Route path="/conversations" element={<ConversationsPage />} />
                <Route path="/campaigns" element={<CampaignsPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/team" element={<UserManagementPage />} />
                <Route path="/flow-builder" element={<FlowBuilderPage />} />
                <Route path="/automations" element={<AutomationsPage />} />
                <Route path="/super-admin" element={
                  <ProtectedRoute requiredRoles={["super_admin"]}>
                    <SuperAdminPage />
                  </ProtectedRoute>
                } />
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
