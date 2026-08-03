import { useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { BottomNav } from "./components/BottomNav";
import { CitySheet, Header } from "./components/Header";
import { CITIES } from "./data/cities";
import { ToastProvider } from "./lib/toast";
import { useAppState } from "./lib/store";
import { EventsPage } from "./pages/EventsPage";
import { ForumPage } from "./pages/ForumPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RacesPage } from "./pages/RacesPage";

function Shell() {
  const store = useAppState();
  const [cityOpen, setCityOpen] = useState(false);
  const city = CITIES.find((c) => c.id === store.state.cityId) ?? CITIES[0];
  const location = useLocation();

  return (
    <div className="min-h-dvh bg-[#f5f6f2] text-slate-900">
      <Header city={city} isDemo={store.isDemo} onOpenCitySheet={() => setCityOpen(true)} />

      <main key={location.pathname}>
        <Routes>
          <Route path="/" element={<EventsPage city={city} store={store} />} />
          <Route path="/races" element={<RacesPage city={city} />} />
          <Route path="/forum" element={<ForumPage city={city} store={store} />} />
          <Route path="/profile" element={<ProfilePage city={city} store={store} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <BottomNav />

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
      <HashRouter>
        <Shell />
      </HashRouter>
    </ToastProvider>
  );
}
