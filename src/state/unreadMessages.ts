/**
 * Unread-messages count for the bottom-nav badge — a lighter-weight sibling
 * to useNotifications. Deliberately separate: "unread messages" is defined
 * by conversation-level readBy state (the same thing the inbox itself uses),
 * not the notification system, so the two can never silently drift apart or
 * double-count the same thing differently.
 *
 * Polls every 20s while signed in — same honest tradeoff as presence and
 * typing indicators: this app has no push layer, so "live" here means a
 * short, real delay, not instant.
 */
import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { useAccount } from "./account";

export function useUnreadMessagesCount(): number {
  const { me } = useAccount();
  const signedIn = me?.status === "signed_in";
  const myId = signedIn ? me.account.id : null;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!signedIn || !myId) { setCount(0); return; }
    let live = true;
    const check = () => {
      void api.getConversations().then((r) => {
        if (!live || !r.ok) return;
        const unread = r.data.conversations.filter((c) => {
          if (!c.lastMessage || c.lastMessage.senderId === myId) return false;
          const readAt = c.readBy[myId];
          return !readAt || readAt < c.lastMessageAt;
        }).length;
        setCount(unread);
      });
    };
    check();
    const interval = setInterval(check, 20000);
    return () => { live = false; clearInterval(interval); };
  }, [signedIn, myId]);

  return count;
}
