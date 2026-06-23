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
import ErrorBoundary from "@/components/ErrorBoundary";
import AnalyticsPage from "@/pages/AnalyticsPage";
import SettingsPage from "@/pages/SettingsPage";
import SuperAdminPage from "@/pages/SuperAdminPage";
import DealerOperationsPage from "@/pages/DealerOperationsPage";
import UserManagementPage from "@/pages/UserManagementPage";
import FlowBuilderPage from "@/pages/FlowBuilderPage";
import AutomationsPage from "@/pages/AutomationsPage";
import AIInsightsPage from "@/pages/AIInsightsPage";
import IntegrationsPage from "@/pages/IntegrationsPage";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import SubscriptionExpiredPage from "@/pages/SubscriptionExpiredPage";
import PublicChatPage from "@/pages/PublicChatPage";
import EstimateApprovalPage from "@/pages/EstimateApprovalPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Long stale window + no refetch-on-mount so navigating between
      // sidebar tabs serves cached data instantly instead of re-fetching
      // and re-rendering the page-level loading spinners.
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
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
            <Route path="/chat/:tenantSlug/:flowId" element={<PublicChatPage />} />
            <Route path="/estimate/:bookingId" element={<EstimateApprovalPage />} />

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
                      <ErrorBoundary fallbackTitle="Campaigns failed to load">
                        <CampaignsPage />
                      </ErrorBoundary>
                    </ProtectedRoute>
                  } />
                  <Route path="/analytics" element={
                    <ProtectedRoute requiredRoles={["tenant_admin", "super_admin"]}>
                      <AnalyticsPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/ai-insights" element={
                    <ProtectedRoute requiredRoles={["tenant_admin", "super_admin"]}>
                      <ErrorBoundary fallbackTitle="AI Insights failed to load">
                        <AIInsightsPage />
                      </ErrorBoundary>
                    </ProtectedRoute>
                  } />
                  <Route path="/integrations" element={
                    <ProtectedRoute requiredRoles={["tenant_admin", "super_admin"]}>
                      <ErrorBoundary fallbackTitle="Integrations failed to load">
                        <IntegrationsPage />
                      </ErrorBoundary>
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
                  } />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/team" element={<UserManagementPage />} />
                  <Route path="/super-admin" element={
                    <ProtectedRoute requiredRoles={["super_admin"]}>
                      <SuperAdminPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/dealer-operations" element={
                    <ProtectedRoute requiredRoles={["super_admin"]}>
                      <DealerOperationsPage />
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
