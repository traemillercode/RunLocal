/**
 * Connections — the signed-in runner's private request inbox, accepted
 * connections, and verified-people search ("Find People").
 *
 * Privacy boundaries (all enforced server-side; the UI only renders what the
 * server returns — no client-side visibility logic):
 *  - Requests / connections / search require a verified signed-in runner
 *    (guests and pending/rejected profiles see the sign-in / verify gate).
 *  - Search only returns verified accounts whose searchable_by_name flag and
 *    block relationships allow this viewer (server-enforced).
 *  - Accept/Decline/Remove/Request all round-trip through the part-B helpers
 *    in src/lib/api.ts; the server re-validates every write.
 *
 * `ConnectionsPage` is the thin data wrapper (fetch + optimistic actions);
 * `ConnectionsView` is the pure presentational body (props only) so UI tests
 * can render the real markup with react-dom/server, per the
 * NotificationsCenter/EventDetailView convention.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../lib/api";
import { Chip, Icon, PillButton } from "../components/ui";
import { ModerationConfirmSheet } from "../components/ModerationConfirmSheet";
import { useAccount } from "../state/account";
import { useToast } from "../lib/toast";

export type ConnectionsTab = "requests" | "connections" | "people";

const TABS: { id: ConnectionsTab; label: string }[] = [
  { id: "requests", label: "Requests" },
  { id: "connections", label: "My Connections" },
  { id: "people", label: "Find People" },
];

export function ConnectionsPage() {
  const { me } = useAccount();
  const toast = useToast();
  const navigate = useNavigate();
  const onMessage = (c: api.ConnectionView) => {
    void api.createDirectConversation(c.id).then((r) => {
      if (r.ok) navigate(`/messages/${r.data.conversation.id}`);
      else toast(r.error.message ?? "Couldn't start a conversation.", "info");
    });
  };
  const [tab, setTab] = useState<ConnectionsTab>("requests");
  const [requests, setRequests] = useState<api.ConnectionRequestView[]>([]);
  const [connections, setConnections] = useState<api.ConnectionView[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // My Connections is a LOCAL filter (EventsPage pattern); Find People is a
  // SERVER search (?q=), so the two queries stay separate.
  const [connectionsQuery, setConnectionsQuery] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [people, setPeople] = useState<api.PeopleSearchResult[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [busyPersonId, setBusyPersonId] = useState<string | null>(null);
  // Remove-connection confirmation (ModerationConfirmSheet) state.
  const [confirmRemove, setConfirmRemove] = useState<api.ConnectionView | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Guards stale Find People responses when the user types quickly.
  const searchSeq = useRef(0);

  const signedIn = me?.status === "signed_in";
  const verified = signedIn && me.account.status === "verified";

  /** Quiet refetch used after a mutation so the list stays server-authoritative. */
  const refreshList = () => {
    void api.getConnections().then((r) => {
      if (r.ok) {
        setRequests(r.data.requests);
        setConnections(r.data.connections);
        setPendingCount(r.data.pendingCount);
      }
    });
  };
  const load = () => {
    setLoading(true);
    setError(null);
    setActionError(null);
    void api.getConnections().then((r) => {
      setLoading(false);
      if (r.ok) {
        setRequests(r.data.requests);
        setConnections(r.data.connections);
        setPendingCount(r.data.pendingCount);
      } else {
        setError(r.error.message ?? "Couldn't load connections.");
      }
    });
  };
  useEffect(() => {
    if (signedIn) {
      if (verified) load();
      else setLoading(false);
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, verified]);

  /** Accept/Decline one incoming request. Optimistic row removal + count
   * decrement; reverts both on server error (toggleNotification pattern). */
  const resolveRequest = (requestId: string, action: "accept" | "decline") => {
    if (busyRequestId) return;
    const prev = requests;
    setBusyRequestId(requestId);
    setActionError(null);
    setRequests((cur) => cur.filter((r) => r.requestId !== requestId));
    setPendingCount((c) => Math.max(0, c - 1));
    const call = action === "accept" ? api.acceptConnection(requestId) : api.declineConnection(requestId);
    void call.then((r) => {
      setBusyRequestId(null);
      if (r.ok) {
        // Accepting makes them a connection — refresh so My Connections shows
        // the accepted runner exactly as the server now knows them.
        if (action === "accept") refreshList();
        toast(action === "accept" ? "Request accepted." : "Request declined.", "success");
      } else {
        setRequests(prev);
        setPendingCount((c) => c + 1);
        setActionError(r.error.message ?? "Couldn't update the request. Try again.");
      }
    });
  };

  /** Remove an accepted connection (soft delete server-side). Optimistic row
   * removal with revert on error. */
  const runRemove = () => {
    if (!confirmRemove || removingId) return;
    const target = confirmRemove;
    const prev = connections;
    setRemovingId(target.id);
    setConfirmError(null);
    setConnections((cur) => cur.filter((c) => c.id !== target.id));
    void api.removeConnection(target.id).then((r) => {
      setRemovingId(null);
      if (r.ok) {
        setConfirmRemove(null);
        toast(`Removed ${target.name} from your connections.`, "success");
      } else {
        setConnections(prev);
        setConfirmError(r.error.message ?? "Couldn't remove this connection. Try again.");
      }
    });
  };

  /** Find People server search (q=). Empty query clears results; a sequence
   * counter drops stale responses so fast typing can't overwrite newer ones. */
  const runPeopleSearch = (q: string) => {
    setPeopleQuery(q);
    const query = q.trim();
    const seq = ++searchSeq.current;
    if (!query) {
      setPeople([]);
      setPeopleLoading(false);
      return;
    }
    setPeopleLoading(true);
    setActionError(null);
    void api.searchPeople(query).then((r) => {
      if (seq !== searchSeq.current) return;
      setPeopleLoading(false);
      if (r.ok) setPeople(r.data.people);
      else setActionError(r.error.message ?? "Couldn't search runners. Try again.");
    });
  };

  /** "Connect" on a search result. Optimistic requested_by_me + revert. */
  const connectTo = (person: api.PeopleSearchResult) => {
    if (busyPersonId) return;
    const prev = people;
    setBusyPersonId(person.id);
    setActionError(null);
    setPeople((cur) => cur.map((p) => (p.id === person.id ? { ...p, connectionState: "requested_by_me" } : p)));
    void api.requestConnection(person.id).then((r) => {
      setBusyPersonId(null);
      if (r.ok) {
        toast(`Request sent to ${person.name}.`, "success");
      } else {
        setPeople(prev);
        setActionError(r.error.message ?? "Couldn't send the request. Try again.");
      }
    });
  };

  /** "Accept Request" on a search result. Search rows carry no requestId, so
   * the id is resolved from the already-loaded inbox (match by requester). If
   * the request is no longer waiting, surface an honest message instead of
   * guessing. */
  const acceptFromSearch = (person: api.PeopleSearchResult) => {
    if (busyPersonId) return;
    const requestId = requests.find((r) => r.from.id === person.id)?.requestId;
    if (!requestId) {
      setActionError("That request is no longer waiting — check your Requests tab.");
      refreshList();
      return;
    }
    const prev = people;
    setBusyPersonId(person.id);
    setActionError(null);
    setPeople((cur) => cur.filter((p) => p.id !== person.id));
    setPendingCount((c) => Math.max(0, c - 1));
    void api.acceptConnection(requestId).then((r) => {
      setBusyPersonId(null);
      if (r.ok) {
        refreshList();
        toast(`You and ${person.name} are now connected.`, "success");
      } else {
        setPeople(prev);
        setPendingCount((c) => c + 1);
        setActionError(r.error.message ?? "Couldn't accept the request. Try again.");
      }
    });
  };

  if (!signedIn) {
    return (
      <Page>
        <h1>Connections</h1>
        <p className="mt-2 text-slate-600">Sign in to see requests and connect with runners.</p>
        <Link className="mt-5 inline-flex min-h-11 items-center rounded-[10px] bg-[#14171C] px-4 py-2 font-semibold text-white" to="/login">Sign in</Link>
      </Page>
    );
  }
  if (!verified) {
    return (
      <Page>
        <h1>Connections</h1>
        <p className="mt-2 text-slate-600">Verification is required to connect with other runners.</p>
        <Link className="mt-5 inline-flex min-h-11 items-center rounded-[10px] bg-[#14171C] px-4 py-2 font-semibold text-white" to="/verify">Verify your account</Link>
      </Page>
    );
  }
  if (loading) {
    return (
      <Page>
        <h1>Connections</h1>
        <p className="mt-8 text-center text-slate-500">Loading connections…</p>
      </Page>
    );
  }
  if (error) {
    return (
      <Page>
        <h1>Connections</h1>
        <p className="mt-3 text-slate-600">We couldn't load your connections.</p>
        <button onClick={load} className="mt-5 inline-flex min-h-11 items-center rounded-[10px] bg-[#14171C] px-4 py-2 font-semibold text-white">Try again</button>
      </Page>
    );
  }
  return (
    <ConnectionsView
      onMessage={onMessage}
      tab={tab}
      onTabChange={setTab}
      requests={requests}
      connections={connections}
      pendingCount={pendingCount}
      busyRequestId={busyRequestId}
      onAcceptRequest={(id) => resolveRequest(id, "accept")}
      onDeclineRequest={(id) => resolveRequest(id, "decline")}
      connectionsQuery={connectionsQuery}
      onConnectionsQueryChange={setConnectionsQuery}
      confirmRemove={confirmRemove}
      removingId={removingId}
      confirmError={confirmError}
      onRequestRemove={(c) => setConfirmRemove(c)}
      onCloseRemove={() => { if (!removingId) { setConfirmRemove(null); setConfirmError(null); } }}
      onConfirmRemove={runRemove}
      peopleQuery={peopleQuery}
      onPeopleQueryChange={runPeopleSearch}
      people={people}
      peopleLoading={peopleLoading}
      busyPersonId={busyPersonId}
      onConnect={connectTo}
      onAcceptFromSearch={acceptFromSearch}
      actionError={actionError}
      onClearActionError={() => setActionError(null)}
    />
  );
}

/**
 * Presentational Connections body — no hooks, driven entirely by props so SSR
 * tests render the real markup. Three in-page tabs (ForumSectionTabs pattern:
 * role="tablist"/"tab" + aria-selected, content-sized pills). The active
 * tab's panel is role="tabpanel".
 */
export function ConnectionsView({
  tab,
  onTabChange,
  requests,
  connections,
  pendingCount,
  busyRequestId,
  onAcceptRequest,
  onDeclineRequest,
  connectionsQuery,
  onConnectionsQueryChange,
  confirmRemove,
  removingId,
  confirmError,
  onRequestRemove,
  onCloseRemove,
  onConfirmRemove,
  peopleQuery,
  onPeopleQueryChange,
  people,
  peopleLoading,
  busyPersonId,
  onConnect,
  onAcceptFromSearch,
  actionError,
  onClearActionError,
  onMessage,
}: {
  tab: ConnectionsTab;
  onTabChange: (t: ConnectionsTab) => void;
  requests: api.ConnectionRequestView[];
  connections: api.ConnectionView[];
  pendingCount: number;
  busyRequestId: string | null;
  onAcceptRequest: (requestId: string) => void;
  onDeclineRequest: (requestId: string) => void;
  connectionsQuery: string;
  onConnectionsQueryChange: (q: string) => void;
  confirmRemove: api.ConnectionView | null;
  removingId: string | null;
  confirmError: string | null;
  onRequestRemove: (c: api.ConnectionView) => void;
  onCloseRemove: () => void;
  onConfirmRemove: () => void;
  peopleQuery: string;
  onPeopleQueryChange: (q: string) => void;
  people: api.PeopleSearchResult[];
  peopleLoading: boolean;
  busyPersonId: string | null;
  onConnect: (p: api.PeopleSearchResult) => void;
  onAcceptFromSearch: (p: api.PeopleSearchResult) => void;
  actionError: string | null;
  onClearActionError: () => void;
  onMessage?: (c: api.ConnectionView) => void;
}) {
  // My Connections filtering is local (name/username) — the server list is
  // already privacy-filtered, so this never leaks anything.
  const filteredConnections = useMemo(() => {
    const q = connectionsQuery.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.username ?? "").toLowerCase().includes(q),
    );
  }, [connections, connectionsQuery]);

  return (
    <Page>
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1>Connections</h1>
          <p className="mt-2 text-sm text-slate-500">
            Requests, the runners you're connected to, and verified people to run with.
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Connections" className="mt-4 flex justify-between gap-1.5 rounded-2xl bg-slate-100 p-1.5">
        {TABS.map((t) => {
          const active = tab === t.id;
          const count = t.id === "requests" ? pendingCount : 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={t.id === "requests" && pendingCount > 0 ? `Requests, ${pendingCount} pending` : t.label}
              onClick={() => onTabChange(t.id)}
              className={`flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-[13px] font-semibold transition-colors ${
                active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 active:bg-white"
              }`}
            >
              {t.label}
              {count > 0 ? (
                <span aria-hidden="true" className="grid min-w-[20px] place-items-center rounded-full bg-[#FF5741] px-1 text-[10px] font-extrabold leading-[18px] text-[#14171C]">
                  {count > 9 ? "9+" : count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {actionError ? (
        <div role="alert" className="mt-4 flex items-start justify-between gap-3 rounded-xl bg-rose-50 p-3 text-[13px] font-medium text-rose-800 ring-1 ring-rose-200">
          <span>{actionError}</span>
          <button type="button" onClick={onClearActionError} className="shrink-0 font-bold underline">Dismiss</button>
        </div>
      ) : null}

      {tab === "requests" ? (
        <section aria-label="Pending requests" role="tabpanel" className="mt-4">
          {requests.length === 0 ? (
            <EmptyState icon="userPlus" title="No pending requests" body="When another runner asks to connect, their request shows up here." />
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
              {requests.map((r) => (
                <li key={r.requestId} className="flex items-center gap-3 px-4 py-3.5">
                  <Link to={`/runners/${r.from.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar profile={r.from} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold text-slate-900">{r.from.name}</span>
                      {r.from.username ? <span className="block truncate text-xs text-slate-500">@{r.from.username}</span> : null}
                    </span>
                  </Link>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <PillButton variant="primary" className="min-h-11 px-3 text-[13px]" disabled={busyRequestId === r.requestId} ariaLabel={`Accept request from ${r.from.name}`} onClick={() => onAcceptRequest(r.requestId)}>
                      <Icon name="check" className="h-4 w-4" /> {busyRequestId === r.requestId ? "…" : "Accept"}
                    </PillButton>
                    <PillButton variant="ghost" className="min-h-11 px-3 text-[13px]" disabled={busyRequestId === r.requestId} ariaLabel={`Decline request from ${r.from.name}`} onClick={() => onDeclineRequest(r.requestId)}>
                      Decline
                    </PillButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "connections" ? (
        <section aria-label="My connections" role="tabpanel" className="mt-4">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              inputMode="search"
              aria-label="Search connections"
              placeholder="Search by name or username"
              value={connectionsQuery}
              onChange={(e) => onConnectionsQueryChange(e.target.value)}
              className="h-12 w-full appearance-none rounded-full border border-slate-200 bg-white pl-11 pr-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60 [&::-webkit-search-cancel-button]:appearance-none"
            />
          </div>
          {filteredConnections.length === 0 ? (
            connections.length === 0 ? (
              <div className="mt-4">
                <EmptyState icon="users" title="No connections yet" body="Runners you connect with appear here, where you can jump to their public profile." />
              </div>
            ) : (
              <p className="mt-6 text-center text-sm text-slate-500">No connections match "{connectionsQuery}".</p>
            )
          ) : (
            <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
              {filteredConnections.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3.5">
                  <Link to={`/runners/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar profile={c} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold text-slate-900">{c.name}</span>
                      {c.username ? <span className="block truncate text-xs text-slate-500">@{c.username}</span> : null}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => onMessage?.(c)}
                    className="min-h-11 shrink-0 rounded-[10px] bg-[#14171C] px-3 text-xs font-bold text-white active:opacity-90"
                  >
                    Message
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestRemove(c)}
                    disabled={removingId === c.id}
                    aria-label={`Remove ${c.name} from connections`}
                    className="min-h-11 shrink-0 rounded-[10px] px-3 text-xs font-bold text-slate-500 active:bg-slate-100 disabled:text-slate-300"
                  >
                    {removingId === c.id ? "Removing…" : "Remove"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "people" ? (
        <section aria-label="Find People" role="tabpanel" className="mt-4">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              inputMode="search"
              aria-label="Find runners"
              placeholder="Search verified runners by name"
              value={peopleQuery}
              onChange={(e) => onPeopleQueryChange(e.target.value)}
              className="h-12 w-full appearance-none rounded-full border border-slate-200 bg-white pl-11 pr-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60 [&::-webkit-search-cancel-button]:appearance-none"
            />
          </div>
          {peopleQuery.trim() === "" ? (
            <p className="mt-8 text-center text-sm text-slate-500">
              Type a name or username to find verified runners. Results are limited to people who've chosen to be found.
            </p>
          ) : peopleLoading ? (
            <p className="mt-8 text-center text-sm text-slate-500">Searching…</p>
          ) : people.length === 0 ? (
            <div className="mt-4">
              <EmptyState icon="search" title="No runners found" body={`Nothing matches "{peopleQuery.trim()}". Try another name.`} />
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3.5">
                  <Link to={`/runners/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar profile={p} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold text-slate-900">{p.name}</span>
                      {p.username ? <span className="block truncate text-xs text-slate-500">@{p.username}</span> : null}
                    </span>
                  </Link>
                  <div className="flex shrink-0 items-center">
                    {p.connectionState === "connected" ? (
                      <Chip tone="emerald">Connected</Chip>
                    ) : p.connectionState === "requested_by_me" ? (
                      <PillButton variant="ghost" disabled className="min-h-11 px-3 text-[13px]">Requested</PillButton>
                    ) : p.connectionState === "requested_to_me" ? (
                      <PillButton variant="secondary" className="min-h-11 px-3 text-[13px]" disabled={busyPersonId === p.id} ariaLabel={`Accept request from ${p.name}`} onClick={() => onAcceptFromSearch(p)}>
                        <Icon name="check" className="h-4 w-4" /> Accept Request
                      </PillButton>
                    ) : (
                      <PillButton variant="secondary" className="min-h-11 px-3 text-[13px]" disabled={busyPersonId === p.id} ariaLabel={`Connect with ${p.name}`} onClick={() => onConnect(p)}>
                        <Icon name="userPlus" className="h-4 w-4" /> Connect
                      </PillButton>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <ModerationConfirmSheet
        open={confirmRemove !== null}
        onClose={onCloseRemove}
        title="Remove this connection?"
        entity={confirmRemove?.name ?? ""}
        impact="You'll no longer see each other's shared content. You can send a new request later."
        confirmLabel="Remove connection"
        tone="neutral"
        busy={removingId !== null}
        error={confirmError}
        onConfirm={onConfirmRemove}
      />
    </Page>
  );
}

function Avatar({ profile }: { profile: { profilePhotoUrl?: string | null; name: string } }) {
  if (profile.profilePhotoUrl) {
    return <img src={profile.profilePhotoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white" />;
  }
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-[12px] font-bold text-slate-600">
      {initials(profile.name)}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200/70">
      <Icon name={icon} className="h-10 w-10 text-slate-300" />
      <p className="mt-3 font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
    </div>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading">
      {children}
    </div>
  );
}
