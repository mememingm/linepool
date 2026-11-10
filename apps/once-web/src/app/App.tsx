import { Component, lazy, Suspense, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useApp } from "./AppProvider";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { Shell } from "../components/Shell";
import { DataState, WorkspaceBoundary } from "../components/ui";
import {
  AuthLoading,
  AuthPage,
  AuthUnavailable,
  ForgotPasswordPage,
  HelpPage,
  LandingPage,
  ResetPasswordPage,
} from "../pages/PublicPages";
import { OverviewPage } from "../pages/OverviewPage";
import { NumbersPage } from "../pages/NumbersPage";
import { MessagesPage, InboxPage, SendPage } from "../pages/MessagesPages";
import {
  BillingPage,
  SettingsPage,
  SubscriptionPage,
  VoicePage,
} from "../pages/AccountPages";
import { WizardPage } from "../pages/WizardPage";
import { PointsPage } from "../pages/PointsPage";
// Operators only: keep the admin console out of the customer bundle.
const AdminApp = lazy(() => import("../admin/AdminShell"));
const AgentPage = lazy(() => import("../pages/AgentPage"));
function ProtectedWorkspace() {
  const { account, checking, authError } = useApp();
  const location = useLocation();
  if (checking) return <AuthLoading />;
  if (authError) return <AuthUnavailable />;
  if (!account)
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo: location.pathname + location.search }}
      />
    );
  if (account.authKind === "PINCLODE") return <Navigate to={account.role === "ADMIN" ? "/admin/overview" : "/agent"} replace />;
  return (
    <WorkspaceProvider key={account.id}>
      <Shell />
    </WorkspaceProvider>
  );
}
function WorkspacePage() {
  return (
    <WorkspaceBoundary>
      <Outlet />
    </WorkspaceBoundary>
  );
}
function InboxRoute() { return <InboxPage />; }
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("ONCE rendering error:", error);
  }
  render() {
    return this.state.failed ? (
      <main className="content">
        <DataState
          title="页面暂时无法显示"
          description="请重新载入页面，账户数据不会因此改变。"
          retry={() => location.reload()}
        />
      </main>
    ) : (
      this.props.children
    );
  }
}
export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage register />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/agent" element={<Suspense fallback={<AuthLoading />}><AgentPage /></Suspense>} />
      <Route path="/numbers/new" element={<WizardPage />} />
      <Route path="/app" element={<ProtectedWorkspace />}>
        <Route index element={<Navigate to="overview" replace />} />
        <Route element={<WorkspacePage />}>
          <Route path="overview" element={<OverviewPage />} />
          <Route path="numbers" element={<NumbersPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="inbox" element={<InboxRoute />} />
          <Route path="send" element={<SendPage />} />
          <Route path="subscription" element={<SubscriptionPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="points" element={<PointsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="voice" element={<VoicePage />} />
          <Route path="new" element={<WizardPage embedded />} />
          <Route path="*" element={<Navigate to="/app/overview" replace />} />
        </Route>
      </Route>
      <Route path="/admin/*" element={<Suspense fallback={<AuthLoading />}><AdminApp /></Suspense>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
