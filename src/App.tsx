import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import SubscriptionGate from "@/components/SubscriptionGate";
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
import SubscriptionExpiredPage from "@/pages/SubscriptionExpiredPage";
import PublicChatPage from "@/pages/PublicChatPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
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
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/chat/:dealerId" element={<PublicChatPage />} />

            {/* Subscription expired */}
            <Route element={<ProtectedRoute />}>
              <Route path="/subscription-expired" element={<SubscriptionExpiredPage />} />
            </Route>

            {/* Protected routes with subscription gate */}
            <Route element={<ProtectedRoute />}>
              <Route element={<SubscriptionGate />}>
                <Route element={<DashboardLayout />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/leads" element={<LeadsPage />} />
                  <Route path="/service-bookings" element={<ServiceBookingsPage />} />
                  <Route path="/test-drives" element={<TestDrivesPage />} />
                  <Route path="/conversations" element={<ConversationsPage />} />
                  <Route path="/campaigns" element={
                    <ProtectedRoute requiredRoles={["tenant_admin", "super_admin"]}>
                      <CampaignsPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/analytics" element={
                    <ProtectedRoute requiredRoles={["tenant_admin", "super_admin"]}>
                      <AnalyticsPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/flow-builder" element={
                    <ProtectedRoute requiredRoles={["tenant_admin", "super_admin"]}>
                      <FlowBuilderPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/automations" element={
                    <ProtectedRoute requiredRoles={["tenant_admin", "super_admin"]}>
                      <AutomationsPage />
                    </ProtectedRoute>
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/team" element={<UserManagementPage />} />
                  <Route path="/super-admin" element={
                    <ProtectedRoute requiredRoles={["super_admin"]}>
                      <SuperAdminPage />
                    </ProtectedRoute>
                  } />
                </Route>
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
