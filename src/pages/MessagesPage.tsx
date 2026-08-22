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

function Inbox() {
  const [conversations, setConversations] = useState<api.ConversationSummary[] | null>(null);
  useEffect(() => {
    let live = true;
    void api.getConversations().then((r) => { if (live && r.ok) setConversations(r.data.conversations); });
    return () => { live = false; };
  }, []);
  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Messages</h1>
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
    </div>
  );
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
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed ${
          mine ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-900"
        } ${msg.deletedAt ? "italic opacity-60" : ""}`}
        onDoubleClick={() => setPickerOpen((v) => !v)}
      >
        {msg.deletedAt ? "Message removed" : msg.body}
      </div>
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
        <p className="flex-1 truncate text-[15px] font-bold text-slate-900">{convo.name}</p>
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
