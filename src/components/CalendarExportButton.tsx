import { useState } from "react";
import { googleCalendarUrl, outlookCalendarUrl, downloadIcs, type CalendarEventInput } from "../lib/calendarExport";
import { Icon } from "./ui";

/** A small "Add to calendar" button that opens a menu of the three real export options. */
export function CalendarExportButton({ event, className = "" }: { event: CalendarEventInput; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-expanded={open}
        aria-label="Add to calendar"
        className="flex h-9 items-center gap-1.5 rounded-full bg-slate-100 px-3 text-[12px] font-bold text-slate-700 active:bg-slate-200"
      >
        <Icon name="calendar" className="h-4 w-4" /> Add to calendar
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute right-0 top-full z-40 mt-1.5 w-52 overflow-hidden rounded-2xl bg-white py-1.5 shadow-lg ring-1 ring-slate-200" onClick={(e) => e.stopPropagation()}>
            <a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
              Google Calendar
            </a>
            <a href={outlookCalendarUrl(event)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
              Outlook
            </a>
            <button type="button" onClick={() => { downloadIcs(event); setOpen(false); }} className="block w-full px-4 py-2.5 text-left text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
              Apple / download .ics
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
