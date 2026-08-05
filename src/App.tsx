import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { BottomNav } from "./components/BottomNav";
import { CitySheet, Header } from "./components/Header";
import { DesktopSidebar } from "./components/DesktopSidebar";
import { CITIES } from "./data/cities";
import { ToastProvider } from "./lib/toast";
import { useAppState } from "./lib/store";
import { AccountProvider } from "./state/account";
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
import { RacesPage } from "./pages/RacesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { VerifyPage } from "./pages/VerifyPage";
import { RecoveryPage } from "./pages/RecoveryPage";
import { ConfirmationPage } from "./pages/ConfirmationPage";
import { MyRunsPage } from "./pages/MyRunsPage";
import { PersonalRunsPage } from "./pages/PersonalRunsPage";
import { PastEventsPage } from "./pages/PastEventsPage";
import { GroupsPage } from "./pages/GroupsPage";
import { MarketingPage } from "./pages/MarketingPage";
import { GroupDetailPage } from "./pages/GroupDetailPage";
import { MyGroupsPage } from "./pages/MyGroupsPage";
import { cleanCallbackUrl, parseAuthCallback } from "./lib/recovery";
import * as supabase from "./lib/supabase";

/** Routes that get a chrome-free wizard layout (no bottom nav). */
const NO_NAV_PATHS = new Set(["/verify", "/admin", "/login", "/recovery", "/confirmation"]);

function GroupRoute() { const location = useLocation(); const id = location.pathname.split("/").pop() ?? ""; return <GroupDetailPage id={id} />; }

function Shell() {
  const store = useAppState();
  const navigate = useNavigate();
  const { refresh } = useAccount();
  const { city, selectCity } = useSelectedCity();
  const [recoveryError, setRecoveryError] = useState<string>();
  useEffect(() => {
    const parsed = parseAuthCallback(window.location.href);
    if (!parsed) return;
    window.history.replaceState(null, "", cleanCallbackUrl(window.location.href));
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
    void supabase.setRecoverySession(parsed.accessToken, parsed.refreshToken).then((result) => { if (!result.ok) setRecoveryError(result.message); });
  }, [navigate]);
  const [cityOpen, setCityOpen] = useState(false);
  const location = useLocation();
  const noNav = NO_NAV_PATHS.has(location.pathname);
  return (
<<<<<<< HEAD
    <div className="min-h-dvh bg-[#F7F8FA] text-slate-900">
=======
    <div className="min-h-dvh bg-[#f7f7f5] text-slate-900">
>>>>>>> origin/main
      <Header city={city} onOpenCitySheet={() => setCityOpen(true)} />
      <DesktopSidebar city={city} onOpenCitySheet={() => setCityOpen(true)} />
      <main key={location.pathname} className="desktop-main">
        <ModeratedProvider cityId={city.id}>
          <PublicContentProvider cityId={city.id}>
            <Routes>
            <Route path="/" element={<EventsPage city={city} store={store} />} />
            <Route path="/landing" element={<MarketingPage />} />
            <Route path="/events" element={<EventsPage city={city} store={store} />} />
            <Route path="/events/:eventId" element={<EventDetailPage city={city} store={store} />} />
            <Route path="/past-events" element={<PastEventsPage city={city} />} />
            <Route path="/groups" element={<GroupsPage city={city} />} />
            <Route path="/my-groups" element={<MyGroupsPage />} />
            <Route path="/groups/:groupId" element={<GroupRoute />} />
            <Route path="/races" element={<RacesPage city={city} />} />
            <Route path="/forum" element={<ForumPage city={city} />} />
            <Route path="/my-runs" element={<MyRunsPage />} />
            <Route path="/personal-runs" element={<PersonalRunsPage />} />
            <Route path="/profile" element={<ProfilePage city={city} store={store} />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/recovery" element={<RecoveryPage sessionError={recoveryError} />} />
            <Route path="/confirmation" element={<ConfirmationPage />} />
            <Route path="/verify" element={<VerifyPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </PublicContentProvider>
        </ModeratedProvider>
      </main>
      {!noNav ? <BottomNav /> : null}
      <CitySheet
        open={cityOpen}
        onClose={() => setCityOpen(false)}
        cities={CITIES}
        currentCityId={city.id}
        onSelect={(c) => {
          void selectCity(c.id).then(() => setCityOpen(false));
        }}
      />
    </div>
  );
}
export default function App() {
  return (
    <ToastProvider>
      <AccountProvider>
        <HashRouter>
          <Shell />
        </HashRouter>
      </AccountProvider>
    </ToastProvider>
  );
}
