import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { CycleProvider } from './context/CycleContext'
import { TweaksProvider } from './context/TweaksContext'
import { OrgProvider } from './context/OrgContext'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { AppShell } from './components/layout/AppShell'
import { LoginPage } from './pages/auth/LoginPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { LandingPage } from './pages/LandingPage'
import { OnboardingWizard } from './pages/onboarding/OnboardingWizard'
import { ProfileSetupPage } from './pages/onboarding/ProfileSetupPage'
import { DashboardPage } from './pages/DashboardPage'
import { OKRsPage } from './pages/OKRsPage'
import { KPIsPage } from './pages/KPIsPage'
import { ScorecardPage } from './pages/ScorecardPage'
import { OneOnOnesPage } from './pages/OneOnOnesPage'
import { MyFocusPage } from './pages/MyFocusPage'
import { MyContributionPage } from './pages/MyContributionPage'
import { UnitPage } from './pages/UnitPage'
import { MyUnitsPage } from './pages/MyUnitsPage'
import { CheckInPage } from './pages/CheckInPage'
import { TeamCheckinPage } from './pages/TeamCheckinPage'
import { CascadePage } from './pages/CascadePage'
import { UserManagementPage } from './pages/UserManagementPage'
import { ReviewPage } from './pages/ReviewPage'
import { TeamReviewPage } from './pages/TeamReviewPage'
import { CyclesPage } from './pages/CyclesPage'
import { CycleSummaryPage } from './pages/CycleSummaryPage'
import { NotificationPreferencesPage } from './pages/NotificationPreferencesPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { SecurityPage } from './pages/SecurityPage'
import { ObjectivesPage } from './pages/ObjectivesPage'
import { PeoplePage } from './pages/PeoplePage'
import { StructurePage } from './pages/StructurePage'
import { AccountPage } from './pages/AccountPage'
import { RetroPage } from './pages/RetroPage'
import { HistoryPage } from './pages/HistoryPage'
import { PendingApprovalPage } from './pages/PendingApprovalPage'

export default function App() {
  return (
    <BrowserRouter>
      <TweaksProvider>
        <AuthProvider>
          <OrgProvider>
            <CycleProvider>
              <Routes>
                {/* Public routes */}
                <Route path="/"          element={<LandingPage />} />
                <Route path="/login"          element={<LoginPage />} />
                <Route path="/signup"         element={<Navigate to="/register" replace />} />
                <Route path="/register"       element={<RegisterPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />

                {/* Onboarding — requires auth but org not required */}
                <Route element={<ProtectedRoute />}>
                  <Route path="/onboarding"         element={<OnboardingWizard />} />
                  <Route path="/onboarding/profile" element={<ProfileSetupPage />} />
                  <Route path="/pending-approval"   element={<PendingApprovalPage />} />
                </Route>

                {/* Protected routes inside AppShell */}
                <Route element={<ProtectedRoute />}>
                  <Route element={<AppShell />}>
                    <Route path="/dashboard"          element={<DashboardPage />} />
                    <Route path="/okrs"               element={<OKRsPage />} />
                    <Route path="/kpis"               element={<KPIsPage />} />
                    <Route path="/scorecard"          element={<ScorecardPage />} />
                    <Route path="/1on1s"              element={<OneOnOnesPage />} />
                    <Route path="/settings/structure" element={<StructurePage />} />
                    <Route path="/my-focus"           element={<MyFocusPage />} />
                    <Route path="/my-contribution"    element={<MyContributionPage />} />
                    <Route path="/units/:id"           element={<UnitPage />} />
                    <Route path="/settings/my-units"   element={<MyUnitsPage />} />
                    <Route path="/check-in"            element={<CheckInPage />} />
                    <Route path="/check-in/team"        element={<TeamCheckinPage />} />
                    <Route path="/cascade"             element={<CascadePage />} />
                    <Route path="/settings/users"     element={<UserManagementPage />} />
                    <Route path="/review"             element={<ReviewPage />} />
                    <Route path="/review/team"        element={<TeamReviewPage />} />
                    <Route path="/cycles"             element={<CyclesPage />} />
                    <Route path="/cycles/:id/summary"           element={<CycleSummaryPage />} />
                    <Route path="/settings/notifications"      element={<NotificationPreferencesPage />} />
                    <Route path="/settings/security"           element={<SecurityPage />} />
                    <Route path="/analytics"                   element={<AnalyticsPage />} />
                    <Route path="/objectives"                  element={<ObjectivesPage />} />
                    <Route path="/people"                      element={<PeoplePage />} />
                    <Route path="/settings/account"            element={<AccountPage />} />
                    <Route path="/retro"                       element={<RetroPage />} />
                    <Route path="/history"                     element={<HistoryPage />} />
                  </Route>
                </Route>

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </CycleProvider>
          </OrgProvider>
        </AuthProvider>
      </TweaksProvider>
    </BrowserRouter>
  )
}
