import { useNavigate } from "react-router-dom";
import { Icon } from "./ui";

/**
 * The unified "+" create entry point. Rather than rebuilding the three
 * existing creation flows (forum post, solo-run scheduling, route upload)
 * into one new shared modal - each already works, is tested, and has its
 * own real form - this menu navigates to each destination with a query
 * param that tells the page to auto-open its own existing sheet (or scroll
 * to its inline form, for routes). One entry point, same trusted flows
 * underneath.
 */
export function CreateMenuSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const options = [
    { icon: "chat", label: "Post to Forum", blurb: "Ask a question or start a conversation", to: "/forum?compose=1" },
    { icon: "calendar", label: "Propose a run", blurb: "Schedule your own run, solo or open to others", to: "/?soloRun=1" },
    { icon: "mapPin", label: "Upload a route", blurb: "Share a GPX route with real distance and elevation", to: "/routes?upload=1" },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-8 sm:rounded-2xl sm:pb-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-slate-900">Create</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100" aria-label="Close">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-3 space-y-1.5">
          {options.map((o) => (
            <button
              key={o.to}
              type="button"
              onClick={() => go(o.to)}
              className="flex w-full items-center gap-3.5 rounded-xl p-3 text-left active:bg-slate-50"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#14171C] text-white">
                <Icon name={o.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-bold text-slate-900">{o.label}</span>
                <span className="block text-[13px] text-slate-500">{o.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
