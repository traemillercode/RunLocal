import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { BottomNav } from "./components/BottomNav";
import { CitySheet, Header } from "./components/Header";
import { DesktopSidebar } from "./components/DesktopSidebar";
import { CITIES } from "./data/cities";
import { ToastProvider, useToast } from "./lib/toast";
import { CookieBanner } from "./components/CookieBanner";
import { captureUtmFromUrl } from "./lib/analytics";
import { useAppState } from "./lib/store";
import { AccountProvider } from "./state/account";
import { NotificationsProvider } from "./state/notifications";
import { ModeratedProvider } from "./state/moderated";
import { PublicContentProvider } from "./state/content";
import { useSelectedCity } from "./state/city";
import { useAccount } from "./state/account";
import * as api from "./lib/api";
import { AdminPage } from "./pages/AdminPage";
import { EventsPage } from "./pages/EventsPage";
import { EventDetailPage } from "./pages/EventDetailPage";
import { ForumPage } from "./pages/ForumPage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RunnerProfilePage } from "./pages/RunnerProfilePage";
import { RacesPage } from "./pages/RacesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LegalPage } from "./pages/LegalPage";
import { VerifyPage } from "./pages/VerifyPage";
import { GeofenceGate } from "./components/GeofenceGate";
import { SponsorPaymentPage } from "./pages/SponsorPaymentPage";
import { SponsorInquiryPage } from "./pages/SponsorInquiryPage";
import { TrainingPlanDetailPage } from "./pages/TrainingPlanDetailPage";
import { RecoveryPage } from "./pages/RecoveryPage";
import { ConfirmationPage } from "./pages/ConfirmationPage";
import { ProviderCallbackPage } from "./pages/ProviderCallbackPage";
import { MyRunsPage } from "./pages/MyRunsPage";
import { PersonalRunsPage } from "./pages/PersonalRunsPage";
import { PastEventsPage } from "./pages/PastEventsPage";
import { GroupsHubPage } from "./pages/GroupsPage";
import { MarketingPage } from "./pages/MarketingPage";
import { RoutesPage } from "./pages/RoutesPage";
import { RouteDetailPage } from "./pages/RouteDetailPage";
import { GroupDetailPage } from "./pages/GroupDetailPage";
import { GroupManagePage } from "./pages/GroupManagePage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { MessagesPage } from "./pages/MessagesPage";
import { RosterPage } from "./pages/RosterPage";
import { CheckinPage } from "./pages/CheckinPage";
import { parseAuthCallback } from "./lib/recovery";
import * as supabase from "./lib/supabase";
import { TourHost } from "./components/TourHost";
import { NO_NAV_PATHS } from "./lib/nav";

/** Reachable from anywhere, no location check — the marketing/legal pages and account-setup flows need to work for someone outside the geofence considering a move or already mid-signup. Everything else (events, groups, messaging, etc.) requires being within GEOFENCE_RADIUS_MILES. */
const GEOFENCE_BYPASS_PATHS = new Set(["/landing", "/legal", "/login", "/recovery", "/confirmation", "/callback"]);

function GroupRoute() { const location = useLocation(); const id = location.pathname.split("/").pop() ?? ""; return <GroupDetailPage id={id} />; }
function RunnerRoute() { const location = useLocation(); const id = location.pathname.split("/").pop() ?? ""; return <RunnerProfilePage id={id} />; }

function Shell() {
  const store = useAppState();
  const navigate = useNavigate();
  const { refresh, me } = useAccount();
  const { city, selectCity } = useSelectedCity();
  const toast = useToast();
  const [recoveryError, setRecoveryError] = useState<string>();
  useEffect(() => { captureUtmFromUrl(); }, []);
  useEffect(() => {
    const parsed = parseAuthCallback(window.location.href);
    if (!parsed) return;
    // Let the router replace the callback entry when it selects the destination.
    // Do not mutate the global history entry here: callback cancellation/back
    // must still be able to return to the meaningful app page that initiated it.
    if (parsed.kind === "confirmation") {
      navigate("/confirmation", { replace: true });
      void supabase.getConfirmationSession(parsed).then(async (session) => {
        if (!session.ok) return;
        const linked = await api.loginCheck(session.accessToken);
        if (linked.ok) {
          await refresh();
          navigate(linked.data.account.status === "verified" ? "/profile" : "/verify", { replace: true });
        }
      });
      return;
    }
    navigate(parsed.kind === "recovery" ? "/recovery" : "/confirmation?error=" + encodeURIComponent(parsed.error), { replace: true });
    if (parsed.kind === "error") { if (parsed.flow === "recovery") setRecoveryError(parsed.error); return; }
    const recoveryPromise = parsed.code
      ? supabase.setRecoverySessionFromCode(parsed.code)
      : supabase.setRecoverySession(parsed.accessToken!, parsed.refreshToken!);
    void recoveryPromise.then((result) => { if (!result.ok) setRecoveryError(result.message); });
  }, [navigate]);
  const [cityOpen, setCityOpen] = useState(false);
  const location = useLocation();
  const noNav = NO_NAV_PATHS.has(location.pathname) || (location.pathname === "/sponsor" || location.pathname.startsWith("/sponsor/"));
  return (
    <div className="min-h-dvh bg-[#f7f7f5] text-slate-900">
      <Header city={city} onOpenCitySheet={() => setCityOpen(true)} />
      <DesktopSidebar city={city} onOpenCitySheet={() => setCityOpen(true)} />
<main key={location.pathname} className={`desktop-main${location.pathname === "/" && me?.status !== "signed_in" ? " full-bleed" : ""}`}>        <ModeratedProvider cityId={city.id}>
          <PublicContentProvider cityId={city.id}>
            <GeofenceGate
              city={city}
              bypass={
                GEOFENCE_BYPASS_PATHS.has(location.pathname) ||
                (location.pathname === "/sponsor" || location.pathname.startsWith("/sponsor/")) ||
                (location.pathname === "/" && me?.status !== "signed_in") ||
                (me?.status === "signed_in" && (me.account.isOwner === true || me.account.isGeofenceExempt === true))
              }
            >
            <Routes>
            <Route path="/" element={me?.status === "signed_in" ? <EventsPage city={city} store={store} /> : <MarketingPage />} />
            <Route path="/landing" element={<MarketingPage />} />
            <Route path="/events" element={<EventsPage city={city} store={store} />} />
            <Route path="/events/:eventId" element={<EventDetailPage city={city} store={store} />} />
            <Route path="/past-events" element={<PastEventsPage city={city} />} />
            <Route path="/groups" element={<GroupsHubPage city={city} />} />
            <Route path="/my-groups" element={<Navigate to="/groups?tab=mine" replace />} />
            <Route path="/groups/:groupId" element={<GroupRoute />} />
            <Route path="/groups/:groupId/manage" element={<GroupManagePage id={location.pathname.split("/").at(-2) ?? ""} />} />
            <Route path="/groups/:groupId/roster" element={<RosterPage />} />
            <Route path="/checkin" element={<CheckinPage />} />
            <Route path="/races" element={<RacesPage city={city} />} />
            <Route path="/routes" element={<RoutesPage />} />
            <Route path="/routes/:routeId" element={<RouteDetailPage />} />
            <Route path="/forum" element={<ForumPage city={city} />} />
            <Route path="/my-runs" element={<MyRunsPage />} />
            <Route path="/personal-runs" element={<PersonalRunsPage />} />
            <Route path="/profile" element={<ProfilePage city={city} store={store} />} />
            <Route path="/runners/:id" element={<RunnerRoute />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:conversationId" element={<MessagesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/training-plan" element={<TrainingPlanDetailPage />} />
            <Route path="/legal" element={<LegalPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/recovery" element={<RecoveryPage sessionError={recoveryError} />} />
            <Route path="/confirmation" element={<ConfirmationPage />} />
            <Route path="/callback" element={<ProviderCallbackPage />} />
            <Route path="/verify" element={<VerifyPage />} />
            <Route path="/sponsor/:sponsorId" element={<SponsorPaymentPage />} />
            <Route path="/sponsor" element={<SponsorInquiryPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </GeofenceGate>
          </PublicContentProvider>
        </ModeratedProvider>
      </main>
      {!noNav ? <BottomNav /> : null}
      <TourHost />
      <CitySheet
        open={cityOpen}
        onClose={() => setCityOpen(false)}
        cities={CITIES}
        currentCityId={city.id}
        onSelect={(c) => {
          void selectCity(c.id).then((r) => {
            if (r.ok) { setCityOpen(false); toast("Home city updated.", "success"); }
            else toast(r.error.message ?? "Couldn't save that city. Try again.", "info");
          });
        }}
      />
    </div>
  );
}
export default function App() {
  return (
    <ToastProvider>
      <AccountProvider>
        <NotificationsProvider>
          <BrowserRouter>
            <Shell />
            <CookieBanner />
          </BrowserRouter>
        </NotificationsProvider>
      </AccountProvider>
    </ToastProvider>
  );
}
