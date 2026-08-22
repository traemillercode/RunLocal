/**
 * Messages — inbox of 1:1 and group conversations, plus the thread view.
 *
 * Every write round-trips through the server (src/server/api.ts), which
 * re-checks participantIds and connection status on every request — this
 * page only renders what the server returns, same convention as Connections.
 *
 * Two routes share this one component: `/messages` (inbox) and
 * `/messages/:conversationId` (thread). On mobile this reads as two full
 * screens; on desktop it could later split into a side-by-side layout, but
 * this first pass keeps one thread visible at a time everywhere.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../lib/api";
import { Icon, PillButton } from "../components/ui";
import { useAccount } from "../state/account";
import { useToast } from "../lib/toast";

const QUICK_REACTIONS = ["👍", "🎉", "😂", "🔥", "❤️"];

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function ConversationRow({ convo, active }: { convo: api.ConversationSummary; active: boolean }) {
  const preview = convo.lastMessage ? (convo.lastMessage.body ?? "Message removed") : "Say hello 👋";
  return (
    <Link
      to={`/messages/${convo.id}`}
      className={`flex items-center gap-3 rounded-2xl p-3 ${active ? "bg-slate-100" : "hover:bg-slate-50"}`}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#14171C] text-sm font-bold text-white">
        {convo.isGroup ? <Icon name="users" className="h-5 w-5" /> : initials(convo.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-bold text-slate-900">{convo.name}</p>
        <p className="truncate text-[13px] text-slate-500">{preview}</p>
      </div>
    </Link>
  );
}

function NewGroupSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [connections, setConnections] = useState<api.ConnectionView[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    void api.getConnections().then((r) => { if (r.ok) setConnections(r.data.connections); });
  }, []);
  const toggle = (id: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const create = () => {
    if (!name.trim() || selected.size < 2 || creating) return;
    setCreating(true);
    void api.createGroupConversation(name.trim(), [...selected]).then((r) => {
      setCreating(false);
      if (r.ok) onCreated(r.data.conversation.id);
      else toast(r.error.message ?? "Couldn't create the group.", "info");
    });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-slate-900">New group</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100"><Icon name="close" className="h-5 w-5" /></button>
        </div>
        <input
          type="text"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name"
          className="mt-4 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
        />
        <p className="mt-4 text-[13px] font-semibold text-slate-600">Add at least 2 connections</p>
        {connections === null ? (
          <p className="mt-3 text-sm text-slate-500">Loading…</p>
        ) : connections.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">You don't have any connections yet — connect with people first.</p>
        ) : (
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {connections.map((c) => (
              <label key={c.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-slate-50">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 rounded border-slate-300" />
                <span className="text-[14px] font-semibold text-slate-800">{c.name}</span>
              </label>
            ))}
          </div>
        )}
        <button
          type="button"
          disabled={!name.trim() || selected.size < 2 || creating}
          onClick={create}
          className="mt-5 h-11 w-full rounded-full bg-[#14171C] text-sm font-bold text-white disabled:opacity-40"
        >
          {creating ? "Creating…" : "Create group"}
        </button>
      </div>
    </div>
  );
}

function Inbox() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<api.ConversationSummary[] | null>(null);
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void api.getConversations().then((r) => { if (live && r.ok) setConversations(r.data.conversations); });
    return () => { live = false; };
  }, []);
  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Messages</h1>
        <button type="button" onClick={() => setGroupSheetOpen(true)} className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-2 text-[13px] font-bold text-slate-700 active:bg-slate-200">
          <Icon name="users" className="h-4 w-4" /> New group
        </button>
      </div>
      {conversations === null ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : conversations.length === 0 ? (
        <div className="mt-6 rounded-2xl bg-slate-50 p-6 text-center">
          <Icon name="chat" className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-semibold text-slate-600">No conversations yet</p>
          <p className="mt-1 text-[13px] text-slate-500">Message a connection from their profile to start one.</p>
          <Link to="/connections" className="mt-3 inline-block text-[13px] font-bold text-[#14171C] underline underline-offset-2">
            Find people to connect with
          </Link>
        </div>
      ) : (
        <div className="mt-4 space-y-1">
          {conversations.map((c) => <ConversationRow key={c.id} convo={c} active={false} />)}
        </div>
      )}
      {groupSheetOpen ? (
        <NewGroupSheet
          onClose={() => setGroupSheetOpen(false)}
          onCreated={(id) => { setGroupSheetOpen(false); navigate(`/messages/${id}`); }}
        />
      ) : null}
    </div>
  );
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function MessageBubble({
  msg,
  mine,
  onReact,
}: {
  msg: api.MessageView;
  mine: boolean;
  onReact: (emoji: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const reactionEntries = Object.entries(msg.reactions);
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div className={`flex items-end gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
        <div
          className={`max-w-[78%] rounded-3xl px-4 py-2.5 text-[14px] leading-relaxed shadow-sm ${
            mine ? "bg-[#FF5741] text-white" : "bg-slate-100 text-slate-900"
          } ${msg.deletedAt ? "italic opacity-60" : ""}`}
        >
          {msg.deletedAt ? "Message removed" : msg.body}
        </div>
        {!msg.deletedAt ? (
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-label="React to this message"
            className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <Icon name="spark" className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <span className="mt-0.5 px-1 text-[11px] text-slate-400">{formatMessageTime(msg.createdAt)}</span>
      {reactionEntries.length > 0 ? (
        <div className="mt-1 flex gap-0.5 rounded-full bg-white px-1.5 py-0.5 text-[12px] shadow-sm ring-1 ring-slate-200">
          {reactionEntries.map(([accountId, emoji]) => <span key={accountId}>{emoji}</span>)}
        </div>
      ) : null}
      {pickerOpen ? (
        <div className="mt-1 flex gap-1 rounded-full bg-white px-2 py-1 shadow-sm ring-1 ring-slate-200">
          {QUICK_REACTIONS.map((e) => (
            <button key={e} type="button" onClick={() => { onReact(e); setPickerOpen(false); }} className="text-[16px]">
              {e}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Thread({ conversationId }: { conversationId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useAccount();
  const myId = me?.status === "signed_in" ? me.account.id : null;
  const [convo, setConvo] = useState<api.ConversationSummary | null>(null);
  const [messages, setMessages] = useState<api.MessageView[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = () => {
    void api.getMessages(conversationId).then((r) => {
      if (r.ok) { setConvo(r.data.conversation); setMessages(r.data.messages); }
      else toast(r.error.message ?? "Couldn't load that conversation.", "info");
    });
  };
  useEffect(() => { load(); }, [conversationId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const send = () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    void api.sendMessage(conversationId, body).then((r) => {
      setSending(false);
      if (r.ok) { setDraft(""); setMessages((prev) => [...prev, r.data.message]); }
      else toast(r.error.message ?? "Couldn't send. Try again.", "info");
    });
  };

  const react = (messageId: string, emoji: string) => {
    void api.setMessageReaction(messageId, emoji).then((r) => {
      if (r.ok) setMessages((prev) => prev.map((m) => (m.id === messageId ? r.data.message : m)));
    });
  };

  const createRun = () => {
    setCreatingRun(true);
    void api.createRunFromConversation(conversationId).then((r) => {
      setCreatingRun(false);
      if (r.ok) navigate(`/?prefillRun=${conversationId}`);
      else toast(r.error.message ?? "Couldn't start a run from this chat.", "info");
    });
  };

  if (!convo) return <div className="mx-auto max-w-lg px-4 py-6 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-lg flex-col px-4 py-4">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <button type="button" onClick={() => navigate("/messages")} className="rounded-full p-1.5 hover:bg-slate-100">
          <Icon name="chevronRight" className="h-5 w-5 rotate-180" />
        </button>
        {!convo.isGroup && convo.otherProfile ? (
          <Link to={`/runners/${convo.otherProfile.id}`} className="flex min-w-0 flex-1 items-center gap-2">
            {convo.otherProfile.profilePhotoUrl ? (
              <img src={convo.otherProfile.profilePhotoUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#14171C] text-[11px] font-bold text-white">{initials(convo.name)}</span>
            )}
            <p className="truncate text-[15px] font-bold text-slate-900">{convo.name}</p>
          </Link>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#14171C] text-white"><Icon name="users" className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold text-slate-900">{convo.name}</p>
              <p className="text-[11px] text-slate-400">{convo.participantIds.length} members</p>
            </div>
          </div>
        )}
        {convo.isGroup && !convo.runCreatedId ? (
          <PillButton variant="secondary" disabled={creatingRun} onClick={createRun}>
            <Icon name="calendar" className="h-4 w-4" /> {creatingRun ? "Starting…" : "Create run"}
          </PillButton>
        ) : null}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} mine={m.senderId === myId} onReact={(emoji) => react(m.id, emoji)} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="Message…"
          maxLength={2000}
          className="h-11 flex-1 rounded-full border border-slate-200 bg-white px-4 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
        />
        <button
          type="button"
          disabled={!draft.trim() || sending}
          onClick={send}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#14171C] text-white disabled:opacity-40"
        >
          <Icon name="chevronRight" className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function MessagesPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  return conversationId ? <Thread conversationId={conversationId} /> : <Inbox />;
}
