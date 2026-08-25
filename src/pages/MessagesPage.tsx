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
import { CameraCapture } from "../components/CameraCapture";

const QUICK_REACTIONS = ["❤️", "😂", "👍", "😮", "😢", "🔥", "🙏", "🎉"];
const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
      {convo.isGroup && convo.photoUrl ? (
        <img src={convo.photoUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#14171C] text-sm font-bold text-white">
          {convo.isGroup ? <Icon name="users" className="h-5 w-5" /> : initials(convo.name)}
        </div>
      )}
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

function NewMessageSheet({ onClose, onStarted }: { onClose: () => void; onStarted: (conversationId: string) => void }) {
  const [connections, setConnections] = useState<api.ConnectionView[] | null>(null);
  const [query, setQuery] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);

  useEffect(() => {
    void api.getConnections().then((r) => { if (r.ok) setConnections(r.data.connections); });
  }, []);

  const filtered = connections?.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())) ?? null;

  const start = (accountId: string) => {
    setStartingId(accountId);
    void api.createDirectConversation(accountId).then((r) => {
      setStartingId(null);
      if (r.ok) onStarted(r.data.conversation.id);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 pb-3">
          <h2 className="text-lg font-extrabold text-slate-900">New message</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100"><Icon name="close" className="h-5 w-5" /></button>
        </div>
        <div className="px-5 pb-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your connections…"
            className="h-11 w-full rounded-xl border border-slate-200 px-3.5 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-5">
          {connections === null ? (
            <p className="px-3 text-sm text-slate-500">Loading…</p>
          ) : filtered && filtered.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm font-semibold text-slate-600">{connections.length === 0 ? "No connections yet" : "No matches"}</p>
              {connections.length === 0 ? (
                <Link to="/connections" onClick={onClose} className="mt-2 inline-block text-[13px] font-bold text-[#14171C] underline underline-offset-2">
                  Find people to connect with
                </Link>
              ) : null}
            </div>
          ) : (
            filtered!.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={startingId !== null}
                onClick={() => start(c.id)}
                className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left active:bg-slate-50 disabled:opacity-50"
              >
                {c.profilePhotoUrl ? (
                  <img src={c.profilePhotoUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
                ) : (
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-[#14171C] text-sm font-bold text-white">{initials(c.name)}</span>
                )}
                <span className="text-[15px] font-bold text-slate-900">{c.name}</span>
                {startingId === c.id ? <span className="ml-auto text-[12px] text-slate-400">Starting…</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Inbox({ activeConversationId }: { activeConversationId?: string }) {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<api.ConversationSummary[] | null>(null);
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void api.getConversations().then((r) => { if (live && r.ok) setConversations(r.data.conversations); });
    return () => { live = false; };
  }, []);
  return (
    <div className="h-full overflow-y-auto px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Messages</h1>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setGroupSheetOpen(true)} className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-2 text-[13px] font-bold text-slate-700 active:bg-slate-200">
            <Icon name="users" className="h-4 w-4" /> New group
          </button>
          <button type="button" onClick={() => setNewMessageOpen(true)} className="flex items-center gap-1.5 rounded-full bg-[#14171C] px-3.5 py-2 text-[13px] font-bold text-white active:opacity-90">
            <Icon name="plus" className="h-4 w-4" /> New message
          </button>
        </div>
      </div>
      {conversations === null ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : conversations.length === 0 ? (
        <div className="mt-6 rounded-2xl bg-slate-50 p-6 text-center">
          <Icon name="chat" className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-semibold text-slate-600">No conversations yet</p>
          <p className="mt-1 text-[13px] text-slate-500">Tap "New message" to start one with a connection.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-1">
          {conversations.map((c) => <ConversationRow key={c.id} convo={c} active={c.id === activeConversationId} />)}
        </div>
      )}
      {groupSheetOpen ? (
        <NewGroupSheet
          onClose={() => setGroupSheetOpen(false)}
          onCreated={(id) => { setGroupSheetOpen(false); navigate(`/messages/${id}`); }}
        />
      ) : null}
      {newMessageOpen ? (
        <NewMessageSheet
          onClose={() => setNewMessageOpen(false)}
          onStarted={(id) => { setNewMessageOpen(false); navigate(`/messages/${id}`); }}
        />
      ) : null}
    </div>
  );
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Groups raw {accountId: emoji} reactions into {emoji: count}, since a group chat can have several people react with the same emoji. */
function tallyReactions(reactions: Record<string, string>): { emoji: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const emoji of Object.values(reactions)) counts[emoji] = (counts[emoji] ?? 0) + 1;
  return Object.entries(counts).map(([emoji, count]) => ({ emoji, count }));
}

const EDIT_WINDOW_MS = 10 * 60 * 1000;

function MessageBubble({
  msg,
  mine,
  myId,
  onReact,
  onEdit,
  onDelete,
}: {
  msg: api.MessageView;
  mine: boolean;
  myId: string | null;
  /** null removes the caller's reaction — same emoji tapped twice toggles off. */
  onReact: (emoji: string | null) => void;
  onEdit: (body: string) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(msg.body ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const myReaction = myId ? msg.reactions[myId] ?? null : null;
  const tally = tallyReactions(msg.reactions);
  const canEdit = mine && !msg.mediaUrl && Date.now() - new Date(msg.createdAt).getTime() < EDIT_WINDOW_MS;
  const pick = (emoji: string) => {
    onReact(myReaction === emoji ? null : emoji);
    setMenuOpen(false);
  };
  const saveEdit = () => {
    const trimmed = editDraft.trim();
    if (!trimmed) return;
    onEdit(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
        <div className="w-full max-w-[78%]">
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            maxLength={2000}
            autoFocus
            className="w-full rounded-2xl border border-slate-200 p-3 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <button type="button" onClick={() => { setEditing(false); setEditDraft(msg.body ?? ""); }} className="h-8 rounded-full bg-slate-100 px-3 text-[12px] font-bold text-slate-700">Cancel</button>
            <button type="button" onClick={saveEdit} disabled={!editDraft.trim()} className="h-8 rounded-full bg-[#14171C] px-3 text-[12px] font-bold text-white disabled:opacity-50">Save</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <button
        type="button"
        onClick={() => !msg.deletedAt && setMenuOpen((v) => !v)}
        className={`max-w-[78%] overflow-hidden rounded-3xl text-left shadow-sm ${
          msg.mediaUrl && !msg.body ? "" : mine ? "bg-[#FF5741] text-white" : "bg-slate-100 text-slate-900"
        } ${msg.deletedAt ? "italic opacity-60" : ""}`}
      >
        {msg.deletedAt ? (
          <span className="block px-4 py-2.5 text-[14px] leading-relaxed">Message removed</span>
        ) : (
          <>
            {msg.mediaUrl ? <img src={msg.mediaUrl} alt="" className="block max-h-72 w-full object-cover" /> : null}
            {msg.body ? (
              <span className={`block px-4 py-2.5 text-[14px] leading-relaxed ${msg.mediaUrl ? (mine ? "bg-[#FF5741] text-white" : "bg-slate-100 text-slate-900") : ""}`}>
                {msg.body}
              </span>
            ) : null}
          </>
        )}
      </button>
      {/* One tap on the bubble opens everything at once — reactions plus
          edit/delete for your own messages — instead of permanent icon
          buttons flanking every row, which reads as cluttered rather than
          the clean, minimal-until-touched feel of a native chat app. Inline,
          not an absolute overlay: a popover here would get silently clipped
          by the message list's overflow-y-auto and never be seen. */}
      {menuOpen && !msg.deletedAt ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 rounded-full bg-white px-2 py-1.5 shadow-md ring-1 ring-slate-200">
          {QUICK_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => pick(e)}
              aria-pressed={myReaction === e}
              className={`grid h-8 w-8 place-items-center rounded-full text-[18px] ${myReaction === e ? "bg-[#FF5741]/15 ring-2 ring-[#FF5741]" : "hover:bg-slate-100"}`}
            >
              {e}
            </button>
          ))}
          {mine ? (
            <>
              <span className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden="true" />
              {canEdit ? (
                <button type="button" onClick={() => { setEditing(true); setMenuOpen(false); }} className="rounded-full px-2.5 py-1 text-[13px] font-bold text-slate-700 hover:bg-slate-100">Edit</button>
              ) : null}
              {confirmDelete ? (
                <button type="button" onClick={() => { onDelete(); setMenuOpen(false); }} className="rounded-full px-2.5 py-1 text-[13px] font-bold text-red-600 hover:bg-red-50">Confirm</button>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="rounded-full px-2.5 py-1 text-[13px] font-bold text-red-600 hover:bg-red-50">Delete</button>
              )}
            </>
          ) : null}
        </div>
      ) : null}
      <span className="mt-0.5 px-1 text-[11px] text-slate-400">
        {formatMessageTime(msg.createdAt)}{msg.editedAt ? " · Edited" : ""}
      </span>
      {tally.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {tally.map(({ emoji, count }) => (
            <button
              key={emoji}
              type="button"
              onClick={() => pick(emoji)}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] shadow-sm ring-1 ${
                myReaction === emoji ? "bg-[#FF5741]/10 ring-[#FF5741]" : "bg-white ring-slate-200"
              }`}
            >
              <span>{emoji}</span>
              {count > 1 ? <span className="font-semibold text-slate-500">{count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GroupSettingsSheet({
  conversationId,
  convo,
  onClose,
  onRenamed,
  onPhotoChanged,
  onLeft,
}: {
  conversationId: string;
  convo: api.ConversationSummary;
  onClose: () => void;
  onRenamed: (name: string) => void;
  onPhotoChanged: (photoUrl: string) => void;
  onLeft: () => void;
}) {
  const toast = useToast();
  const { me } = useAccount();
  const myId = me?.status === "signed_in" ? me.account.id : null;
  const [members, setMembers] = useState<api.ConversationMember[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(convo.name);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const isCreator = members?.find((m) => m.id === myId)?.isCreator ?? false;

  useEffect(() => {
    void api.getConversationMembers(conversationId).then((r) => { if (r.ok) setMembers(r.data.members); });
  }, [conversationId]);

  const pickGroupPhoto = (file: File | undefined) => {
    if (!file) return;
    if (!PHOTO_TYPES.has(file.type)) { toast("Choose a JPG, PNG, or WebP image.", "info"); return; }
    if (file.size > PHOTO_MAX_BYTES) { toast("That image is too large — under 4 MB please.", "info"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setUploadingPhoto(true);
      void api.uploadGroupChatPhoto(conversationId, reader.result).then((r) => {
        setUploadingPhoto(false);
        if (r.ok) { onPhotoChanged(r.data.photoUrl); toast("Group photo updated.", "success"); }
        else toast(r.error.message ?? "Couldn't update the group photo.", "info");
      });
    };
    reader.readAsDataURL(file);
  };

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    void api.renameConversation(conversationId, trimmed).then((r) => {
      setSaving(false);
      if (r.ok) { onRenamed(r.data.conversation.name); setRenaming(false); toast("Group renamed.", "success"); }
      else toast(r.error.message ?? "Couldn't rename the group.", "info");
    });
  };

  const leave = () => {
    setLeaving(true);
    void api.leaveConversation(conversationId).then((r) => {
      setLeaving(false);
      if (r.ok) { toast("You left the group.", "neutral"); onLeft(); }
      else toast(r.error.message ?? "Couldn't leave the group.", "info");
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-slate-900">Group settings</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100"><Icon name="close" className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 flex justify-center">
          <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { pickGroupPhoto(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto} className="relative">
            {convo.photoUrl ? (
              <img src={convo.photoUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <span className="grid h-20 w-20 place-items-center rounded-full bg-[#14171C] text-white"><Icon name="users" className="h-8 w-8" /></span>
            )}
            <span className="absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-full bg-[#FF5741] text-white ring-2 ring-white">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2.5"><path d="M4 8h3l2-2h6l2 2h3v11H4z" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="13.5" r="3"/></svg>
            </span>
          </button>
        </div>

        <div className="mt-5">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Group name</span>
          {renaming ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                className="h-11 flex-1 rounded-xl border border-slate-200 px-3.5 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
              />
              <button type="button" disabled={saving} onClick={saveName} className="h-11 rounded-full bg-[#14171C] px-4 text-sm font-bold text-white disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-bold text-slate-900">{convo.name}</p>
              {isCreator ? <button type="button" onClick={() => setRenaming(true)} className="text-[13px] font-bold text-[#14171C] underline underline-offset-2">Rename</button> : null}
            </div>
          )}
        </div>

        <div className="mt-5">
          <span className="mb-2 block text-sm font-semibold text-slate-700">{convo.participantIds.length} members</span>
          {members === null ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-xl p-2">
                  <span className="relative shrink-0">
                    {m.profilePhotoUrl ? (
                      <img src={m.profilePhotoUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-[#14171C] text-[12px] font-bold text-white">{initials(m.name)}</span>
                    )}
                    {m.isOnline ? <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" aria-hidden="true" /> : null}
                  </span>
                  <p className="text-[14px] font-semibold text-slate-800">
                    {m.name}
                    {m.isCreator ? <span className="ml-1.5 text-[11px] font-bold text-slate-400">Creator</span> : null}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 border-t border-slate-100 pt-4">
          {confirmLeave ? (
            <div className="flex gap-2">
              <button type="button" disabled={leaving} onClick={leave} className="h-11 flex-1 rounded-full bg-red-600 text-sm font-bold text-white disabled:opacity-50">
                {leaving ? "Leaving…" : "Confirm — leave group"}
              </button>
              <button type="button" onClick={() => setConfirmLeave(false)} className="h-11 rounded-full bg-slate-100 px-4 text-sm font-bold text-slate-700">Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmLeave(true)} className="h-11 w-full rounded-full border border-red-200 text-sm font-bold text-red-600">
              Leave group
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportSheet({
  accountId,
  accountName,
  conversationId,
  onClose,
}: {
  accountId: string;
  accountName: string;
  conversationId: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = () => {
    if (reason.trim().length < 5) { setError("Give a bit more detail (at least 5 characters)."); return; }
    setSubmitting(true);
    setError(null);
    void api.reportRunner(accountId, reason.trim(), conversationId).then((r) => {
      setSubmitting(false);
      if (r.ok) setDone(true);
      else setError(r.error.message ?? "Couldn't submit that report.");
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="py-4 text-center">
            <p className="text-lg font-extrabold text-slate-900">Report submitted</p>
            <p className="mt-2 text-[13px] text-slate-500">Thanks for looking out for the community. An admin will review this — {accountName} won't be notified.</p>
            <button type="button" onClick={onClose} className="mt-5 h-11 w-full rounded-full bg-[#14171C] text-sm font-bold text-white">Done</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-slate-900">Report {accountName}</h2>
              <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100"><Icon name="close" className="h-5 w-5" /></button>
            </div>
            <p className="mt-1 text-[13px] text-slate-500">This goes to an admin for review, privately — {accountName} is never told you reported them.</p>
            {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-medium text-red-800">{error}</p> : null}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="What happened? Be specific — this helps admins act on it."
              className="mt-4 h-28 w-full rounded-xl border border-slate-200 p-3 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
            />
            <button type="button" disabled={submitting} onClick={submit} className="mt-4 h-11 w-full rounded-full bg-red-600 text-sm font-bold text-white disabled:opacity-50">
              {submitting ? "Submitting…" : "Submit report"}
            </button>
          </>
        )}
      </div>
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [safetyDismissed, setSafetyDismissed] = useState(false);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastTypingSentRef = useRef(0);

  const load = () => {
    void api.getMessages(conversationId).then((r) => {
      if (r.ok) { setConvo(r.data.conversation); setMessages(r.data.messages); setTypingNames(r.data.typingNames ?? []); }
      else toast(r.error.message ?? "Couldn't load that conversation.", "info");
    });
  };
  useEffect(() => { load(); }, [conversationId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  // Typing indicator: polling-based (no push layer here), so "live" means a
  // few seconds of latency, not instant keystroke-by-keystroke. Poll while
  // the thread is open; stop the moment it closes.
  useEffect(() => {
    const interval = setInterval(() => {
      void api.getTyping(conversationId).then((r) => { if (r.ok) setTypingNames(r.data.typingNames); });
    }, 2500);
    return () => clearInterval(interval);
  }, [conversationId]);

  const onDraftChange = (value: string) => {
    setDraft(value);
    // Throttled, not per-keystroke — the server signal already has its own
    // few-second expiry, so re-sending every ~2s is enough to keep it alive.
    const nowMs = Date.now();
    if (value.trim() && nowMs - lastTypingSentRef.current > 2000) {
      lastTypingSentRef.current = nowMs;
      void api.sendTyping(conversationId);
    }
  };

  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  const onPickPhoto = (file: File | undefined) => {
    if (!file) return;
    if (!PHOTO_TYPES.has(file.type)) { setPhotoError("Choose a JPG, PNG, or WebP image."); return; }
    if (file.size > PHOTO_MAX_BYTES) { setPhotoError("That image is too large — under 4 MB please."); return; }
    setPhotoError(null);
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") setPhotoDataUrl(reader.result); };
    reader.onerror = () => setPhotoError("Couldn't read that image. Try another.");
    reader.readAsDataURL(file);
  };

  const send = () => {
    const body = draft.trim();
    if ((!body && !photoDataUrl) || sending) return;
    setSending(true);
    void api.sendMessage(conversationId, body, photoDataUrl).then((r) => {
      setSending(false);
      if (r.ok) { setDraft(""); setPhotoDataUrl(null); setMessages((prev) => [...prev, r.data.message]); }
      else toast(r.error.message ?? "Couldn't send. Try again.", "info");
    });
  };

  const react = (messageId: string, emoji: string | null) => {
    void api.setMessageReaction(messageId, emoji).then((r) => {
      if (r.ok) setMessages((prev) => prev.map((m) => (m.id === messageId ? r.data.message : m)));
    });
  };

  const editMsg = (messageId: string, body: string) => {
    void api.editMessage(messageId, body).then((r) => {
      if (r.ok) setMessages((prev) => prev.map((m) => (m.id === messageId ? r.data.message : m)));
      else toast(r.error.message ?? "Couldn't edit that message.", "info");
    });
  };

  const deleteMsg = (messageId: string) => {
    void api.deleteMessage(messageId).then((r) => {
      if (r.ok) setMessages((prev) => prev.map((m) => (m.id === messageId ? r.data.message : m)));
      else toast(r.error.message ?? "Couldn't delete that message.", "info");
    });
  };

  const [runFormOpen, setRunFormOpen] = useState(false);
  const [runDate, setRunDate] = useState("");
  const [runTime, setRunTime] = useState("");
  const [runLocation, setRunLocation] = useState("");
  const [runDistance, setRunDistance] = useState("");
  const [runError, setRunError] = useState<string | null>(null);

  const submitRun = () => {
    if (!runDate || !runTime.trim() || !runLocation.trim()) {
      setRunError("Fill in a date, time, and location before creating the run.");
      return;
    }
    setCreatingRun(true);
    setRunError(null);
    void api.createRunFromConversation(conversationId, { scheduleDate: runDate, time: runTime.trim(), location: runLocation.trim(), distanceLabel: runDistance.trim() || undefined }).then((r) => {
      setCreatingRun(false);
      if (r.ok) { setRunFormOpen(false); toast("Run created — needs 3 runners to confirm.", "success"); navigate("/"); }
      else setRunError(r.error.message ?? "Couldn't create that run.");
    });
  };

  if (!convo) return <div className="mx-auto max-w-lg px-4 py-6 text-sm text-slate-500">Loading…</div>;

  if (cameraOpen) {
    return (
      <div className="fixed inset-0 z-50 bg-black">
        <CameraCapture
          confirmLabel="Use photo"
          facingMode="environment"
          mirror={false}
          onCapture={(dataUrl) => { setPhotoDataUrl(dataUrl); setCameraOpen(false); }}
          onCancel={() => setCameraOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col px-4 py-4">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <button type="button" onClick={() => navigate("/messages")} className="rounded-full p-1.5 hover:bg-slate-100">
          <Icon name="chevronRight" className="h-5 w-5 rotate-180" />
        </button>
        {!convo.isGroup && convo.otherProfile ? (
          <Link to={`/runners/${convo.otherProfile.id}`} className="flex min-w-0 flex-1 items-center gap-2">
            <span className="relative shrink-0">
              {convo.otherProfile.profilePhotoUrl ? (
                <img src={convo.otherProfile.profilePhotoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[#14171C] text-[11px] font-bold text-white">{initials(convo.name)}</span>
              )}
              {convo.otherOnline ? <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" aria-hidden="true" /> : null}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold text-slate-900">{convo.name}</p>
              <p className="text-[11px] text-slate-400">{convo.otherOnline ? "Active now" : "Offline"}</p>
            </div>
          </Link>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {convo.photoUrl ? (
              <img src={convo.photoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#14171C] text-white"><Icon name="users" className="h-4 w-4" /></span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold text-slate-900">{convo.name}</p>
              <p className="text-[11px] text-slate-400">{convo.participantIds.length} members</p>
            </div>
          </div>
        )}
        {!convo.isGroup && convo.otherProfile ? (
          <button type="button" onClick={() => setReportOpen(true)} aria-label="Report this person" className="shrink-0 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2"><path d="M12 9v4M12 17h.01" strokeLinecap="round"/><path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78a1.5 1.5 0 0 0 1.29-2.25L13.71 3.86a1.5 1.5 0 0 0-2.58 0z" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        ) : null}
        {convo.isGroup ? (
          <span className="flex shrink-0 items-center gap-2">
            {!convo.runCreatedId ? (
              <PillButton variant="secondary" disabled={creatingRun} onClick={() => setRunFormOpen(true)}>
                <Icon name="calendar" className="h-4 w-4" /> {creatingRun ? "Starting…" : "Create run"}
              </PillButton>
            ) : null}
            <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Group chat settings" className="rounded-full p-2 hover:bg-slate-100">
              <Icon name="settings" className="h-5 w-5 text-slate-500" />
            </button>
          </span>
        ) : null}
      </div>
      {settingsOpen ? (
        <GroupSettingsSheet
          conversationId={conversationId}
          convo={convo}
          onClose={() => setSettingsOpen(false)}
          onRenamed={(name) => setConvo((c) => (c ? { ...c, name } : c))}
          onPhotoChanged={(photoUrl) => setConvo((c) => (c ? { ...c, photoUrl } : c))}
          onLeft={() => navigate("/messages")}
        />
      ) : null}

      {runFormOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setRunFormOpen(false)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-slate-900">Create a run</h2>
              <button type="button" onClick={() => setRunFormOpen(false)} className="rounded-full p-1.5 hover:bg-slate-100"><Icon name="close" className="h-5 w-5" /></button>
            </div>
            <p className="mt-1 text-[13px] text-slate-500">Everyone in this chat will be invited. Needs 3 confirmed runners before it's official.</p>
            {runError ? <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-medium text-red-800">{runError}</p> : null}
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Date</span>
                <input type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3.5 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Time</span>
                <input type="text" value={runTime} onChange={(e) => setRunTime(e.target.value)} placeholder="e.g. 6:30 AM" className="h-11 w-full rounded-xl border border-slate-200 px-3.5 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Meeting location</span>
                <input type="text" value={runLocation} onChange={(e) => setRunLocation(e.target.value)} placeholder="e.g. MKT Trailhead, Flat Branch Park" className="h-11 w-full rounded-xl border border-slate-200 px-3.5 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Distance (optional)</span>
                <input type="text" value={runDistance} onChange={(e) => setRunDistance(e.target.value)} placeholder="e.g. 3-5 miles" className="h-11 w-full rounded-xl border border-slate-200 px-3.5 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
              </label>
            </div>
            <button type="button" disabled={creatingRun} onClick={submitRun} className="mt-5 h-11 w-full rounded-full bg-[#14171C] text-sm font-bold text-white disabled:opacity-50">
              {creatingRun ? "Creating…" : "Create run"}
            </button>
          </div>
        </div>
      ) : null}

      {reportOpen && convo.otherProfile ? (
        <ReportSheet
          accountId={convo.otherProfile.id}
          accountName={convo.otherProfile.name}
          conversationId={conversationId}
          onClose={() => setReportOpen(false)}
        />
      ) : null}

      {!convo.isGroup && !safetyDismissed ? (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-50 p-3">
          <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 fill-none stroke-amber-700" strokeWidth="2"><path d="M12 9v4M12 17h.01" strokeLinecap="round"/><path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.29 2.25h17.78a1.5 1.5 0 0 0 1.29-2.25L13.71 3.86a1.5 1.5 0 0 0-2.58 0z" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <p className="flex-1 text-[12px] leading-relaxed text-amber-900">
            Being verified means someone's identity was confirmed — it doesn't guarantee they're safe to run with. For a 1:1 meetup, especially with someone you don't know, prefer a group of 3+ instead. Meet in a public place, tell someone your plan, and trust your gut.
          </p>
          <button type="button" onClick={() => setSafetyDismissed(true)} aria-label="Dismiss" className="shrink-0 rounded-full p-1 text-amber-700 hover:bg-amber-100">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} mine={m.senderId === myId} myId={myId} onReact={(emoji) => react(m.id, emoji)} onEdit={(body) => editMsg(m.id, body)} onDelete={() => deleteMsg(m.id)} />
        ))}
        {(() => {
          const last = messages[messages.length - 1];
          if (!last || last.senderId !== myId) return null;
          const others = convo.participantIds.filter((id) => id !== myId);
          const seenByAll = others.length > 0 && others.every((id) => convo.readBy[id] && convo.readBy[id] >= last.createdAt);
          if (!seenByAll) return null;
          if (!convo.isGroup && convo.otherProfile) {
            return (
              <div className="flex items-center justify-end gap-1">
                {convo.otherProfile.profilePhotoUrl ? (
                  <img src={convo.otherProfile.profilePhotoUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
                ) : (
                  <span className="grid h-4 w-4 place-items-center rounded-full bg-slate-300 text-[8px] font-bold text-white">{initials(convo.name)}</span>
                )}
              </div>
            );
          }
          return <p className="text-right text-[11px] text-slate-400">Seen by everyone</p>;
        })()}
        {typingNames.length > 0 ? (
          <div className="flex items-center gap-2 text-[13px] text-slate-400">
            <span className="flex gap-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" />
            </span>
            {typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.join(", ")} are typing…`}
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-100 pt-3">
        {photoError ? <p role="alert" className="mb-2 text-[12px] font-semibold text-red-700">{photoError}</p> : null}
        {photoDataUrl ? (
          <div className="mb-2 flex items-center gap-2">
            <img src={photoDataUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
            <button type="button" onClick={() => setPhotoDataUrl(null)} className="text-[13px] font-bold text-slate-500 underline underline-offset-2">Remove</button>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            ref={libraryInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => { onPickPhoto(e.target.files?.[0]); e.target.value = ""; }}
          />
          <button
            type="button"
            onClick={() => libraryInputRef.current?.click()}
            aria-label="Choose a photo from your library"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-4 4-2-2-5 5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            aria-label="Take a photo"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2"><path d="M4 8h3l2-2h6l2 2h3v11H4z" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="13.5" r="3.5"/></svg>
          </button>
          <input
            type="text"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder="Message…"
            maxLength={2000}
            className="h-11 flex-1 rounded-full border border-slate-200 bg-white px-4 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
          />
          <button
            type="button"
            disabled={(!draft.trim() && !photoDataUrl) || sending}
            onClick={send}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#14171C] text-white disabled:opacity-40"
          >
            <Icon name="chevronRight" className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function MessagesPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  return (
    <div className="messages-page-root messages-split" data-has-conversation={conversationId ? "true" : "false"}>
      <div className="messages-split-inbox">
        <Inbox activeConversationId={conversationId} />
      </div>
      <div className="messages-split-thread">
        {conversationId ? <Thread key={conversationId} conversationId={conversationId} /> : <EmptyThreadState />}
      </div>
    </div>
  );
}

/** Desktop-only placeholder shown in the right pane when no thread is selected — mobile never sees this, since the two panes are never both visible there. */
function EmptyThreadState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-300"><Icon name="messages" className="h-7 w-7" /></span>
      <p className="text-[15px] font-bold text-slate-700">Select a conversation</p>
      <p className="max-w-[220px] text-[13px] text-slate-400">Or start something new from the panel on the left.</p>
    </div>
  );
}
