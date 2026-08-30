import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { initTelemetry } from "./lib/telemetry";
import { installRageClickDetector, useRouteTelemetry } from "./lib/friction";
import { FeedbackLauncher } from "./components/FeedbackSheet";
import { shouldBypassGeofence } from "./lib/geofenceBypass";
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
const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const EventsPage = lazy(() => import("./pages/EventsPage").then((m) => ({ default: m.EventsPage })));
import { DiscoverEventsPage } from "./pages/DiscoverEventsPage";
import { HomePage } from "./pages/HomePage";
import { PrivateBetaPage } from "./pages/PrivateBetaPage";
const EventDetailPage = lazy(() => import("./pages/EventDetailPage").then((m) => ({ default: m.EventDetailPage })));
const ForumPage = lazy(() => import("./pages/ForumPage").then((m) => ({ default: m.ForumPage })));
const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const MySubmissions = lazy(() => import("./pages/ProfilePage").then((m) => ({ default: m.MySubmissions })));
const RunnerProfilePage = lazy(() => import("./pages/RunnerProfilePage").then((m) => ({ default: m.RunnerProfilePage })));
const RacesPage = lazy(() => import("./pages/RacesPage").then((m) => ({ default: m.RacesPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const LegalPage = lazy(() => import("./pages/LegalPage").then((m) => ({ default: m.LegalPage })));
const VerifyPage = lazy(() => import("./pages/VerifyPage").then((m) => ({ default: m.VerifyPage })));
import { GeofenceGate } from "./components/GeofenceGate";
const SponsorPaymentPage = lazy(() => import("./pages/SponsorPaymentPage").then((m) => ({ default: m.SponsorPaymentPage })));
const SponsorInquiryPage = lazy(() => import("./pages/SponsorInquiryPage").then((m) => ({ default: m.SponsorInquiryPage })));
const TrainingPlanDetailPage = lazy(() => import("./pages/TrainingPlanDetailPage").then((m) => ({ default: m.TrainingPlanDetailPage })));
const ShoeLibraryPage = lazy(() => import("./pages/ShoeLibraryPage").then((m) => ({ default: m.ShoeLibraryPage })));
const TrainingSummaryPage = lazy(() => import("./pages/TrainingSummaryPage").then((m) => ({ default: m.TrainingSummaryPage })));
const CoachRosterPage = lazy(() => import("./pages/CoachRosterPage").then((m) => ({ default: m.CoachRosterPage })));
const CoachingPage = lazy(() => import("./pages/CoachingPage").then((m) => ({ default: m.CoachingPage })));
const CoachAthletePlanPage = lazy(() => import("./pages/CoachAthletePlanPage").then((m) => ({ default: m.CoachAthletePlanPage })));
const RecurrenceManagementPage = lazy(() => import("./pages/RecurrenceManagementPage").then((m) => ({ default: m.RecurrenceManagementPage })));
const CoachDirectoryPage = lazy(() => import("./pages/CoachDirectoryPage").then((m) => ({ default: m.CoachDirectoryPage })));
const PaceCalculatorPage = lazy(() => import("./pages/PaceCalculatorPage").then((m) => ({ default: m.PaceCalculatorPage })));
const RecoveryPage = lazy(() => import("./pages/RecoveryPage").then((m) => ({ default: m.RecoveryPage })));
const ConfirmationPage = lazy(() => import("./pages/ConfirmationPage").then((m) => ({ default: m.ConfirmationPage })));
const ProviderCallbackPage = lazy(() => import("./pages/ProviderCallbackPage").then((m) => ({ default: m.ProviderCallbackPage })));
const MyRunsPage = lazy(() => import("./pages/MyRunsPage").then((m) => ({ default: m.MyRunsPage })));
const PastEventsPage = lazy(() => import("./pages/PastEventsPage").then((m) => ({ default: m.PastEventsPage })));
const GroupsHubPage = lazy(() => import("./pages/GroupsPage").then((m) => ({ default: m.GroupsHubPage })));
import { MarketingPage } from "./pages/MarketingPage";
const RoutesPage = lazy(() => import("./pages/RoutesPage").then((m) => ({ default: m.RoutesPage })));
const RouteDetailPage = lazy(() => import("./pages/RouteDetailPage").then((m) => ({ default: m.RouteDetailPage })));
const GroupDetailPage = lazy(() => import("./pages/GroupDetailPage").then((m) => ({ default: m.GroupDetailPage })));
const GroupManagePage = lazy(() => import("./pages/GroupManagePage").then((m) => ({ default: m.GroupManagePage })));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage })));
const ConnectionsPage = lazy(() => import("./pages/ConnectionsPage").then((m) => ({ default: m.ConnectionsPage })));
const MessagesPage = lazy(() => import("./pages/MessagesPage").then((m) => ({ default: m.MessagesPage })));
const RosterPage = lazy(() => import("./pages/RosterPage").then((m) => ({ default: m.RosterPage })));
const CheckinPage = lazy(() => import("./pages/CheckinPage").then((m) => ({ default: m.CheckinPage })));
import { parseAuthCallback } from "./lib/recovery";
import * as supabase from "./lib/supabase";
import { TourHost } from "./components/TourHost";
import { NO_NAV_PATHS } from "./lib/nav";

/** Reachable from anywhere, no location check — the marketing/legal pages and account-setup flows need to work for someone outside the geofence considering a move or already mid-signup. Everything else (events, groups, messaging, etc.) requires being within GEOFENCE_RADIUS_MILES. */

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
<main key={location.pathname} data-has-nav={!noNav} className={`desktop-main page-bottom-pad${location.pathname === "/" && me?.status !== "signed_in" ? " full-bleed" : ""}`}>        <ModeratedProvider cityId={city.id}>
          <PublicContentProvider cityId={city.id}>
            {/*
              CLOSED BETA. A signed-out visitor reaching any route that is not
              public sees the private-beta page — not the geofence wall (which
              says "wrong place", untrue for someone who followed a link) and
              not an error (nothing broke). Checked BEFORE the geofence so the
              honest reason wins over the geographic one.
            */}
            {me?.status !== "signed_in" && !shouldBypassGeofence({ pathname: location.pathname, signedIn: false }) ? (
              <PrivateBetaPage />
            ) : (
            <GeofenceGate
              city={city}
              bypass={shouldBypassGeofence({
                pathname: location.pathname,
                signedIn: me?.status === "signed_in",
                isOwner: me?.status === "signed_in" ? me.account.isOwner : undefined,
                isGeofenceExempt: me?.status === "signed_in" ? me.account.isGeofenceExempt : undefined,
              })}
            >
            {/*
              Route-level code splitting (roadmap 0.10). Every page except the
              two "/" renderers loads on demand, so a runner on mobile data at a
              trailhead no longer downloads Admin, Forum, Settings, and Messages
              before seeing a single run.

              The fallback is a min-height spacer rather than a spinner: a
              chunk fetch is usually fast enough that a spinner would flash and
              read as jank, and reserving height avoids the layout shift that a
              zero-height fallback would cause.
            */}
            <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
            <Routes>
            <Route path="/" element={me?.status === "signed_in" ? <HomePage city={city} /> : <MarketingPage />} />
            <Route path="/events/manage" element={me?.status === "signed_in" ? <EventsPage city={city} store={store} /> : <MarketingPage />} />
            <Route path="/landing" element={<MarketingPage />} />
            {/*
              The BOARD is /events now, not EventsPage.
              Forced by 1.2: Home takes "/", so DiscoverEventsPage needed a home
              or the discovery board would have been routed out of existence.
              /events is also where the marketing Explore menu points and what
              D2 made public, so the public surface is the privacy-safe one —
              RunCard.attendees is optional and absent renders the going count
              alone. EventsPage stays at /events/manage (already auth-gated),
              which keeps its ~29 write and moderation references off any
              public path instead of needing a guest branch each.
            */}
            <Route path="/events" element={<DiscoverEventsPage city={city} />} />
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
            <Route path="/profile" element={<ProfilePage city={city} store={store} />} />
            <Route path="/runners/:id" element={<RunnerRoute />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:conversationId" element={<MessagesPage />} />
            {/*
              A real route, replacing the nav entry that pointed at
              /profile?section=submissions. The registry deliberately does not
              model query strings, and MySubmissions was already a standalone
              exported component — so this is a route for something that already
              stood alone, not a new page.
            */}
            <Route path="/submissions" element={me?.status === "signed_in" ? <MySubmissions signedIn /> : <MarketingPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/training-plan" element={<TrainingPlanDetailPage />} />
            <Route path="/shoes" element={<ShoeLibraryPage />} />
            <Route path="/training-summary" element={<TrainingSummaryPage />} />
            <Route path="/coach-roster" element={<CoachRosterPage />} />
            <Route path="/coaching" element={<CoachingPage />} />
            <Route path="/coach-roster/:athleteId" element={<CoachAthletePlanPage />} />
            <Route path="/recurring-schedules" element={<RecurrenceManagementPage />} />
            <Route path="/coaches" element={<CoachDirectoryPage />} />
            <Route path="/pace-calculator" element={<PaceCalculatorPage />} />
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
            </Suspense>
            </GeofenceGate>
            )}
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
/**
 * Starts telemetry for a returning user who already consented, installs the
 * rage-click detector, and fires a page view on every route change. Renders
 * nothing. Lives inside BrowserRouter because useRouteTelemetry needs
 * useLocation; every function it calls no-ops without consent.
 */
function TelemetryBootstrap() {
  useEffect(() => {
    void initTelemetry();
    return installRageClickDetector();
  }, []);
  useRouteTelemetry();
  return null;
}

export default function App() {
  return (
    <ToastProvider>
      <AccountProvider>
        <NotificationsProvider>
          <BrowserRouter>
            <TelemetryBootstrap />
            <Shell />
            <FeedbackLauncher />
            <CookieBanner />
          </BrowserRouter>
        </NotificationsProvider>
      </AccountProvider>
    </ToastProvider>
  );
}
