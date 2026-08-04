import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { BottomNav } from "./components/BottomNav";
import { CitySheet, Header } from "./components/Header";
import { CITIES } from "./data/cities";
import { ToastProvider } from "./lib/toast";
import { useAppState } from "./lib/store";
import { AccountProvider } from "./state/account";
import { ModeratedProvider } from "./state/moderated";
import { PublicContentProvider } from "./state/content";
import { useSelectedCity } from "./state/city";
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
import { parseRecoveryHash } from "./lib/recovery";
import * as supabase from "./lib/supabase";

/** Routes that get a chrome-free wizard layout (no bottom nav). */
const NO_NAV_PATHS = new Set(["/verify", "/admin", "/login", "/recovery"]);

function Shell() {
  const store = useAppState();
  const navigate = useNavigate();
  const { city, selectCity } = useSelectedCity();
  const [recoveryError, setRecoveryError] = useState<string>();
  useEffect(() => {
    const parsed = parseRecoveryHash(window.location.hash);
    if (!parsed) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search + "#/recovery");
    navigate("/recovery", { replace: true });
    if ("error" in parsed) { setRecoveryError(parsed.error); return; }
    void supabase.setRecoverySession(parsed.accessToken, parsed.refreshToken).then((result) => { if (!result.ok) setRecoveryError(result.message); });
  }, [navigate]);
  const [cityOpen, setCityOpen] = useState(false);
  const location = useLocation();
  const noNav = NO_NAV_PATHS.has(location.pathname);
  return (
    <div className="min-h-dvh bg-[#f5f6f2] text-slate-900">
      <Header city={city} onOpenCitySheet={() => setCityOpen(true)} />
      <main key={location.pathname}>
        <ModeratedProvider cityId={city.id}>
          <PublicContentProvider cityId={city.id}>
            <Routes>
            <Route path="/" element={<EventsPage city={city} store={store} />} />
            <Route path="/events/:eventId" element={<EventDetailPage city={city} store={store} />} />
            <Route path="/races" element={<RacesPage city={city} />} />
            <Route path="/forum" element={<ForumPage city={city} />} />
            <Route path="/profile" element={<ProfilePage city={city} store={store} />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/recovery" element={<RecoveryPage sessionError={recoveryError} />} />
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
