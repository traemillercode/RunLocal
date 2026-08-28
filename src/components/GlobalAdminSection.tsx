/**
 * Global Admin — Site Settings / CMS (part of AdminPage).
 *
 * Everything here is reason-gated and audited server-side (every read and
 * write attaches the reason and appends an admin.cms_settings / admin.cms_city
 * audit entry). Design rules:
 *   - Settings responses carry opaque image refs, never data URLs — uploads
 *     POST the bytes once and only the ref is stored/displayed.
 *   - Provider OAuth credentials are deployment-managed (server env vars).
 *     This UI shows honest configured/missing state (names of missing vars
 *     only) and never offers to edit secrets it doesn't have.
 *   - No dynamic editing is claimed where it isn't available.
 */
import { useMemo, useState } from "react";
import { Icon, PillButton } from "./ui";
import * as api from "../lib/api";

const inputCls =
  "h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-[14px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";
const reasonCls =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[14px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";
const labelCls = "mb-1 block text-xs font-semibold text-slate-600";
const BOTTOM_NAV_LABELS: Record<string, string> = { home: "Events (home)", races: "Races", clubs: "Clubs", forum: "Forum" };
const TAG_LABELS: Record<string, string> = { runTypes: "Run types", credentialBodies: "Credential bodies", qa: "Q&A topics", ratings: "Ratings" };
const PROVIDER_LABELS: Record<string, string> = { strava: "Strava", garmin: "Garmin", coros: "Coros", suunto: "Suunto" };

function Err({ msg }: { msg: string }) {
  return <p className="flex items-start gap-2 rounded-xl bg-red-50 p-3.5 text-[13px] leading-relaxed text-red-800">{msg}</p>;
}
function Info({ msg }: { msg: string }) {
  return <p className="flex items-start gap-2 rounded-xl bg-sky-50 p-3.5 text-[13px] leading-relaxed text-sky-900">{msg}</p>;
}

/** Split a comma-separated string into trimmed, de-duplicated items. */
function splitList(raw: string): string[] {
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

export function GlobalAdminSection() {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overview, setOverview] = useState<api.AdminCmsOverview | null>(null);

  // Editable settings draft (mirrors the loaded overview settings).
  const [title, setTitle] = useState("");
  const [wordmark, setWordmark] = useState("");
  const [tagline, setTagline] = useState("");
  const [primary, setPrimary] = useState("");
  const [accent, setAccent] = useState("");
  const [surface, setSurface] = useState("");
  const [annText, setAnnText] = useState("");
  const [annLink, setAnnLink] = useState("");
  const [annOn, setAnnOn] = useState(false);
  const [bottomNav, setBottomNav] = useState<string[]>([]);
  const [providers, setProviders] = useState<Record<string, boolean>>({});
  const [tags, setTags] = useState<Record<string, string>>({});
  const [strings, setStrings] = useState<Array<{ k: string; v: string }>>([]);
  const [logoRef, setLogoRef] = useState<string | null>(null);
  const [faviconRef, setFaviconRef] = useState<string | null>(null);

  // City editor state
  const [newCity, setNewCity] = useState({ name: "", state: "", slug: "" });
  const [cityBusy, setCityBusy] = useState<string | null>(null);

  const reasonOr = (what: string): string | null => {
    if (!reason.trim() || reason.trim().length < 5) {
      setError(`Enter a reason (min 5 characters) to ${what}.`);
      return null;
    }
    return reason.trim();
  };

  const load = async () => {
    const r = reasonOr("open Global Admin");
    if (!r) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await api.adminCmsOverview(r);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.status === 401 ? "Your admin session expired — sign in again." : res.error.message ?? "Could not load Global Admin.");
      return;
    }
    const s = res.data.settings;
    setOverview(res.data);
    setTitle(s.title);
    setWordmark(s.wordmark);
    setTagline(s.tagline);
    setPrimary(s.primary);
    setAccent(s.accent);
    setSurface(s.surface);
    setAnnOn(s.announcement !== null);
    setAnnText(s.announcement?.text ?? "");
    setAnnLink(s.announcement?.link ?? "");
    setBottomNav([...s.bottomNav]);
    setProviders({ ...s.providers });
    setTags(Object.fromEntries(Object.entries(s.tags).map(([k, v]) => [k, v.join(", ")])));
    setStrings(Object.entries(s.strings).map(([k, v]) => ({ k, v })));
    setLogoRef(s.logoRef);
    setFaviconRef(s.faviconRef);
    setNewCity({ name: "", state: "", slug: "" });
  };

  const saveSettings = async () => {
    const r = reasonOr("save site settings");
    if (!r) return;
    if (!annOn && (annText.trim() || annLink.trim())) {
      setError("Announcement text is set but the announcement is off — turn it on or clear the text.");
      return;
    }
    const stringsRec = Object.fromEntries(strings.map((x) => [x.k.trim(), x.v]).filter(([k]) => k !== ""));
    const payload: Partial<api.SiteSettingsView> = {
      title: title.trim(),
      wordmark: wordmark.trim(),
      tagline: tagline.trim(),
      primary: primary.trim(),
      accent: accent.trim(),
      surface: surface.trim(),
      announcement: annOn ? { text: annText.trim(), ...(annLink.trim() ? { link: annLink.trim() } : {}) } : null,
      bottomNav,
      providers,
      tags: Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, splitList(v)])),
      strings: stringsRec,
      logoRef,
      faviconRef,
    };
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await api.adminSaveCmsSettings(payload, r);
    setBusy(false);
    if (!res.ok) {
      const map: Record<string, string> = {
        invalid_color: "Colors must be 6-digit hex codes (e.g. #14171C).",
        invalid_url: "Announcement links must start with https://.",
        invalid_text: "Title, wordmark, and tagline have invalid lengths.",
        invalid_bottom_nav: "The bottom navigation has invalid entries.",
        invalid_provider_flags: "Provider toggles are invalid.",
        invalid_tags: "One of the tag lists is invalid (max 50 items, 60 chars each).",
        invalid_strings: "Content strings are invalid (max 40 keys).",
        invalid_announcement: "Announcement text is required when the announcement is on.",
        invalid_ref: "Image reference is invalid.",
      };
      setError(map[res.error.code] ?? res.error.message ?? "Settings were not saved.");
      return;
    }
    setNotice("Site settings saved (audited).");
    if (res.data.settings) {
      setTitle(res.data.settings.title);
      setWordmark(res.data.settings.wordmark);
      setTagline(res.data.settings.tagline);
      setPrimary(res.data.settings.primary);
      setAccent(res.data.settings.accent);
      setSurface(res.data.settings.surface);
      setLogoRef(res.data.settings.logoRef);
      setFaviconRef(res.data.settings.faviconRef);
      setAnnOn(res.data.settings.announcement !== null);
      setAnnText(res.data.settings.announcement?.text ?? "");
      setAnnLink(res.data.settings.announcement?.link ?? "");
      setBottomNav([...res.data.settings.bottomNav]);
      setProviders({ ...res.data.settings.providers });
      setTags(Object.fromEntries(Object.entries(res.data.settings.tags).map(([k, v]) => [k, v.join(", ")])));
      setStrings(Object.entries(res.data.settings.strings).map(([k, v]) => ({ k, v })));
    }
  };

  const uploadRef = async (kind: "logo" | "favicon", dataUrl: string) => {
    const r = reasonOr(`upload the ${kind === "logo" ? "logo" : "favicon"}`);
    if (!r) return;
    setBusy(true);
    setError(null);
    const res = await api.adminCmsUpload(dataUrl, r);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.code === "image_too_large" ? "Image is larger than 4 MB." : res.error.message ?? "Upload failed.");
      return;
    }
    if (kind === "logo") setLogoRef(res.data.ref);
    else setFaviconRef(res.data.ref);
    setNotice(`Uploaded — ref ${res.data.ref.slice(0, 18)}… saved locally. Press “Save settings” to persist it.`);
  };

  const readFile = (kind: "logo" | "favicon") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (dataUrl) void uploadRef(kind, dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // ---- city actions ------------------------------------------------------
  const saveCityRow = async (city: api.SiteConfig["cities"][number]) => {
    const r = reasonOr("save the city entity");
    if (!r) return;
    setCityBusy(city.id);
    setError(null);
    setNotice(null);
    const res = await api.adminSaveCity({ id: city.id, name: city.name, state: city.state, slug: city.slug, status: city.status, accent: city.accent ?? undefined, headerImageRef: city.headerImageRef ?? undefined }, r);
    setCityBusy(null);
    if (!res.ok) {
      setError(res.error.code === "duplicate_slug" ? "Another city already uses that slug." : res.error.message ?? "City was not saved.");
      return;
    }
    setNotice(`Saved ${res.data.city.name}, ${res.data.city.state}.`);
    void load();
  };
  const addCity = async () => {
    const r = reasonOr("add a city");
    if (!r) return;
    if (!newCity.name.trim() || !newCity.state.trim() || !newCity.slug.trim()) {
      setError("Name, state, and slug are all required to add a city.");
      return;
    }
    setCityBusy("__new__");
    setError(null);
    const res = await api.adminSaveCity({ name: newCity.name.trim(), state: newCity.state.trim(), slug: newCity.slug.trim().toLowerCase(), status: "active" }, r);
    setCityBusy(null);
    if (!res.ok) {
      setError(res.error.code === "duplicate_slug" ? "Another city already uses that slug." : res.error.message ?? "City was not added.");
      return;
    }
    setNotice(`Added ${res.data.city.name}, ${res.data.city.state}.`);
    void load();
  };
  const deactivateCity = async (id: string) => {
    const r = reasonOr("deactivate the city");
    if (!r) return;
    if (!window.confirm("Deactivate this city? It will stop appearing in the public city list and new signups, while existing members keep their home city.")) return;
    setCityBusy(id);
    setError(null);
    const res = await api.adminDeactivateCity(id, r);
    setCityBusy(null);
    if (!res.ok) {
      setError(res.error.message ?? "Could not deactivate the city.");
      return;
    }
    setNotice(`Deactivated ${res.data.city.name}.`);
    void load();
  };
  const reactivateCity = async (city: api.SiteConfig["cities"][number]) => {
    void saveCityRow({ ...city, status: "active" });
  };
  const uploadHeader = async (cityId: string, dataUrl: string) => {
    const r = reasonOr("upload a city header image");
    if (!r) return;
    setCityBusy(cityId);
    setError(null);
    const up = await api.adminCmsUpload(dataUrl, r);
    if (!up.ok) {
      setCityBusy(null);
      setError(up.error.message ?? "Upload failed.");
      return;
    }
    const city = overview?.cities.find((c) => c.id === cityId);
    if (!city) {
      setCityBusy(null);
      return;
    }
    const res = await api.adminSaveCity({ id: city.id, name: city.name, state: city.state, slug: city.slug, status: city.status, accent: city.accent ?? undefined, headerImageRef: up.data.ref }, r);
    setCityBusy(null);
    if (!res.ok) {
      setError(res.error.message ?? "City was not saved.");
      return;
    }
    setNotice(`Header image saved for ${res.data.city.name}.`);
    void load();
  };
  const readHeaderFile = (cityId: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") void uploadHeader(cityId, reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const integrationsByProvider = useMemo(() => {
    const m: Record<string, api.CmsIntegration> = {};
    for (const i of overview?.integrations ?? []) m[i.provider] = i;
    return m;
  }, [overview]);

  return (
    <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <div>
        <h2 className="text-[15px] font-bold text-slate-900">Global Admin — site settings &amp; CMS</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          Brand identity, theme, announcement, navigation, provider availability, and the city registry for every market. Every
          read and save is reason-required and audited. Featured &amp; pinned content is managed per city in the City dashboard above.
        </p>
      </div>
      <div className="mt-3 space-y-3">
        <textarea rows={2} placeholder="Reason for accessing Global Admin (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} className={reasonCls} />
        <PillButton variant="primary" className="w-full" disabled={busy} onClick={() => void load()}>
          <Icon name="shield" className="h-4 w-4" /> {busy ? "Working…" : overview ? "Reload settings & cities" : "Load settings & cities"}
        </PillButton>
        {error ? <Err msg={error} /> : null}
        {notice ? <Info msg={notice} /> : null}
      </div>

      {overview ? (
        <div className="mt-5 space-y-6">
          {/* Integrations — honest deployment-managed state */}
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Activity integrations</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
              “Offered” toggles whether runners see and can connect the provider. “Configured” reflects the deployment environment:
              OAuth credentials are set in server env vars and cannot be edited from this UI — nothing is stored or returned here.
            </p>
            <ul className="mt-2 space-y-2">
              {Object.entries(PROVIDER_LABELS).map(([id, label]) => {
                const info = integrationsByProvider[id];
                return (
                  <li key={id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{label}</p>
                        <p className="text-[11px] text-slate-500">
                          {info ? (info.configured ? "Deployment credentials configured" : `Not configured — missing ${info.missing.join(", ") || "credentials"}`) : "—"}
                        </p>
                      </div>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                        <input
                          type="checkbox"
                          checked={providers[id] !== false}
                          onChange={(e) => setProviders((p) => ({ ...p, [id]: e.target.checked }))}
                          className="h-4 w-4 accent-[#14171C]"
                        />
                        Offered
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Brand identity */}
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Brand &amp; theme</h3>
            <div className="mt-2 grid gap-3">
              <label className="block">
                <span className={labelCls}>Site title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className={inputCls} placeholder="Kimbio" />
              </label>
              <label className="block">
                <span className={labelCls}>Wordmark</span>
                <input value={wordmark} onChange={(e) => setWordmark(e.target.value)} maxLength={100} className={inputCls} placeholder="Kimbio" />
              </label>
              <label className="block">
                <span className={labelCls}>Tagline</span>
                <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={200} className={inputCls} placeholder="Find your local run." />
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["Primary", primary, setPrimary],
                    ["Accent", accent, setAccent],
                    ["Surface", surface, setSurface],
                  ] as const
                ).map(([label, value, setter]) => (
                  <label key={label} className="block">
                    <span className={labelCls}>{label} (hex)</span>
                    <input value={value} onChange={(e) => setter(e.target.value)} maxLength={7} placeholder="#14171C" className={`${inputCls} font-mono`} />
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Brand images */}
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Brand images</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
              Images are stored server-side under an opaque ref and served from the public ref route once referenced. The app shell
              will render these once brand assets are wired into the UI.
            </p>
            <div className="mt-2 grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">Logo</p>
                  <p className="truncate text-[11px] text-slate-500">{logoRef ? `ref ${logoRef}` : "No logo uploaded"}</p>
                </div>
                <label className="min-h-9 cursor-pointer rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 active:bg-slate-200">
                  Upload (PNG/JPEG/WebP, ≤4 MB)
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={readFile("logo")} />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">Favicon</p>
                  <p className="truncate text-[11px] text-slate-500">{faviconRef ? `ref ${faviconRef}` : "No favicon uploaded"}</p>
                </div>
                <label className="min-h-9 cursor-pointer rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 active:bg-slate-200">
                  Upload (PNG/JPEG/WebP, ≤4 MB)
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={readFile("favicon")} />
                </label>
              </div>
            </div>
          </div>

          {/* Announcement */}
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Announcement banner</h3>
            <div className="mt-2 space-y-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={annOn} onChange={(e) => setAnnOn(e.target.checked)} className="h-4 w-4 accent-[#14171C]" />
                Show announcement
              </label>
              {annOn ? (
                <>
                  <label className="block">
                    <span className={labelCls}>Text</span>
                    <input value={annText} onChange={(e) => setAnnText(e.target.value)} maxLength={300} className={inputCls} placeholder="e.g. New: Columbia winter series is open" />
                  </label>
                  <label className="block">
                    <span className={labelCls}>Link (optional, must be https)</span>
                    <input value={annLink} onChange={(e) => setAnnLink(e.target.value)} maxLength={500} className={inputCls} placeholder="https://…" />
                  </label>
                </>
              ) : null}
            </div>
          </div>

          {/* Bottom nav */}
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Bottom navigation</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">Which tabs appear in the app's bottom navigation.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(BOTTOM_NAV_LABELS).map(([id, label]) => {
                const on = bottomNav.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setBottomNav((nav) => (on ? nav.filter((n) => n !== id) : [...nav, id]))}
                    className={`min-h-9 rounded-full px-3 text-xs font-semibold transition-colors ${on ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-500 active:bg-slate-200"}`}
                    aria-pressed={on}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tag lists */}
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Tag lists</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">Comma-separated values offered as options in forms and filters.</p>
            <div className="mt-2 grid gap-3">
              {Object.entries(TAG_LABELS).map(([id, label]) => (
                <label key={id} className="block">
                  <span className={labelCls}>{label}</span>
                  <input value={tags[id] ?? ""} onChange={(e) => setTags((t) => ({ ...t, [id]: e.target.value }))} className={inputCls} placeholder="Comma separated" />
                </label>
              ))}
            </div>
          </div>

          {/* Content strings */}
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Content strings</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">Free-form key/value copy (e.g. empty-state text) the app can render by key.</p>
            <div className="mt-2 space-y-2">
              {strings.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={row.k}
                    onChange={(e) => setStrings((rows) => rows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
                    maxLength={60}
                    placeholder="key"
                    className={`${inputCls} w-1/3 font-mono`}
                    aria-label="String key"
                  />
                  <input
                    value={row.v}
                    onChange={(e) => setStrings((rows) => rows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
                    maxLength={500}
                    placeholder="value"
                    className={inputCls}
                    aria-label="String value"
                  />
                  <button
                    type="button"
                    onClick={() => setStrings((rows) => rows.filter((_, j) => j !== i))}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 active:bg-slate-200"
                    aria-label={`Remove string ${row.k || i + 1}`}
                  >
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <PillButton variant="ghost" onClick={() => setStrings((rows) => [...rows, { k: "", v: "" }])}>
                <Icon name="plus" className="h-4 w-4" /> Add string
              </PillButton>
            </div>
          </div>

          {/* Save settings */}
          <div>
            <PillButton variant="primary" className="w-full" disabled={busy} onClick={() => void saveSettings()}>
              Save site settings
            </PillButton>
            <p className="mt-1.5 text-center text-[11px] text-slate-400">Saves with the reason above; audited as admin.cms_settings.</p>
          </div>

          {/* Cities */}
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-500">Cities</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
              The city registry behind the public city list and signup validation. Deactivating stops new signups for that city;
              existing members keep their home city. Slug changes affect URLs.
            </p>
            <ul className="mt-2 space-y-2">
              {overview.cities.map((city) => (
                <CityRow
                  key={city.id}
                  city={city}
                  busy={cityBusy === city.id}
                  onSave={saveCityRow}
                  onDeactivate={deactivateCity}
                  onReactivate={reactivateCity}
                  onUploadHeader={readHeaderFile(city.id)}
                />
              ))}
              {overview.cities.length === 0 ? <li className="rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-500">No cities yet — add the first one below.</li> : null}
            </ul>
            <div className="mt-3 rounded-xl border border-slate-200 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Add city</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <input value={newCity.name} onChange={(e) => setNewCity((c) => ({ ...c, name: e.target.value }))} maxLength={80} placeholder="Name" className={inputCls} aria-label="New city name" />
                <input value={newCity.state} onChange={(e) => setNewCity((c) => ({ ...c, state: e.target.value }))} maxLength={40} placeholder="State" className={inputCls} aria-label="New city state" />
                <input value={newCity.slug} onChange={(e) => setNewCity((c) => ({ ...c, slug: e.target.value }))} maxLength={50} placeholder="slug" className={`${inputCls} font-mono`} aria-label="New city slug" />
              </div>
              <PillButton variant="secondary" className="mt-2 w-full" disabled={cityBusy === "__new__"} onClick={() => void addCity()}>
                Add city
              </PillButton>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CityRow({
  city,
  busy,
  onSave,
  onDeactivate,
  onReactivate,
  onUploadHeader,
}: {
  city: api.SiteConfig["cities"][number];
  busy: boolean;
  onSave: (c: api.SiteConfig["cities"][number]) => void;
  onDeactivate: (id: string) => void;
  onReactivate: (c: api.SiteConfig["cities"][number]) => void;
  onUploadHeader: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [name, setName] = useState(city.name);
  const [state, setState] = useState(city.state);
  const [slug, setSlug] = useState(city.slug);
  const [accent, setAccent] = useState(city.accent ?? "");
  const active = city.status === "active";
  const dirty = name !== city.name || state !== city.state || slug !== city.slug || accent !== (city.accent ?? "");
  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">
          {city.name}, {city.state}
        </p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-500"}`}>
          {active ? "Active" : "Inactive"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Name" className={inputCls} aria-label={`${city.name} name`} />
        <input value={state} onChange={(e) => setState(e.target.value)} maxLength={40} placeholder="State" className={inputCls} aria-label={`${city.name} state`} />
        <input value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={50} placeholder="slug" className={`${inputCls} font-mono`} aria-label={`${city.name} slug`} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          Accent hex
          <input value={accent} onChange={(e) => setAccent(e.target.value)} maxLength={7} placeholder="#14171C" className="h-9 w-24 rounded-lg border border-slate-300 bg-white px-2 font-mono text-xs outline-none focus:border-[#14171C]" aria-label={`${city.name} accent`} />
        </label>
        <label className="ml-auto inline-flex min-h-9 cursor-pointer items-center rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-600 active:bg-slate-200">
          Header image
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onUploadHeader} />
        </label>
        {active ? (
          <button type="button" disabled={busy} onClick={() => void onDeactivate(city.id)} className="min-h-9 rounded-full px-3 text-xs font-semibold text-red-600 active:bg-red-50">
            Deactivate
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void onReactivate(city)} className="min-h-9 rounded-full px-3 text-xs font-semibold text-emerald-700 active:bg-emerald-50">
            Reactivate
          </button>
        )}
        <PillButton variant="secondary" disabled={busy || !dirty} onClick={() => void onSave({ ...city, name, state, slug, accent: accent || null })}>
          Save
        </PillButton>
      </div>
      {city.headerImageRef ? (
        <p className="mt-1.5 truncate text-[11px] text-slate-400">header ref {city.headerImageRef}</p>
      ) : null}
    </li>
  );
}
