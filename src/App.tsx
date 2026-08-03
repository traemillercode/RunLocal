import { useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { BottomNav } from "./components/BottomNav";
import { CitySheet, Header } from "./components/Header";
import { CITIES } from "./data/cities";
import { ToastProvider } from "./lib/toast";
import { useAppState } from "./lib/store";
import { AccountProvider } from "./state/account";
import { AdminPage } from "./pages/AdminPage";
import { EventsPage } from "./pages/EventsPage";
import { ForumPage } from "./pages/ForumPage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RacesPage } from "./pages/RacesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { VerifyPage } from "./pages/VerifyPage";

/** Routes that get a chrome-free wizard layout (no bottom nav). */
const NO_NAV_PATHS = new Set(["/verify", "/admin", "/login"]);

function Shell() {
  const store = useAppState();
  const [cityOpen, setCityOpen] = useState(false);
  const city = CITIES.find((c) => c.id === store.state.cityId) ?? CITIES[0];
  const location = useLocation();
  const noNav = NO_NAV_PATHS.has(location.pathname);
  return (
    <div className="min-h-dvh bg-[#f5f6f2] text-slate-900">
      <Header city={city} onOpenCitySheet={() => setCityOpen(true)} />
      <main key={location.pathname}>
        <Routes>
          <Route path="/" element={<EventsPage city={city} store={store} />} />
          <Route path="/races" element={<RacesPage city={city} />} />
          <Route path="/forum" element={<ForumPage city={city} />} />
          <Route path="/profile" element={<ProfilePage city={city} store={store} />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!noNav ? <BottomNav /> : null}
      <CitySheet
        open={cityOpen}
        onClose={() => setCityOpen(false)}
        cities={CITIES}
        currentCityId={city.id}
        onSelect={(c) => {
          store.setCityId(c.id);
          setCityOpen(false);
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
