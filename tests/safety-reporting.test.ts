import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Db } from "../src/server/store";
import { createSafetyReport } from "../src/server/safety";
const acct=(db:Db,name:string,cityId:string,status:"verified"|"pending"="verified")=>{const a=db.createAccount({name,email:name+"@x.test",cityId}); a.status=status; a.verifiedAt=status==="verified"?"2026-01-01":null; return a;};
describe("safety reporting",()=>{it("gates context, privacy and duplicate/rate abuse",()=>{const db=new Db();const a=acct(db,"a","c"),b=acct(db,"b","c");db.addAttendance({id:"1",accountId:a.id,eventId:"e",role:"rsvp",createdAt:"x"});db.addAttendance({id:"2",accountId:b.id,eventId:"e",role:"rsvp",createdAt:"x"});const x=createSafetyReport(db,a,{subjectId:b.id,cityId:"c",contextType:"event",contextId:"e",reason:"unsafe"});console.log(x); expect(x.ok).toBe(true);if(x.ok){const stored=db.getSafetyReport(x.data.id)!;expect(stored.reporterId).toBe(a.id);expect("reporterId" in ({id:stored.id,status:stored.status})).toBe(false);}expect(createSafetyReport(db,a,{subjectId:b.id,cityId:"c",contextType:"event",contextId:"e",reason:"unsafe"})).toMatchObject({error:"duplicate_report"});});it("denies pending, deleted and cross-city",()=>{const db=new Db();const a=acct(db,"a","c","pending"),b=acct(db,"b","d");expect(createSafetyReport(db,a,{subjectId:b.id,cityId:"c",contextType:"event",contextId:"e",reason:"unsafe"})).toMatchObject({status:403});});});

describe("the queue is actionable — who, whom, when, the text", () => {
  /*
   * The architecture doc requires all four. The projection shipped two: the
   * admin view carried a reason and a timestamp with NO reporter and NO
   * subject, so a reader could see that something happened and not who it was
   * about.
   *
   * That is not a readable queue. You cannot suspend someone whose name you do
   * not have, and being able to act is the entire reason for making reports
   * readable rather than merely stored.
   */
  it("the admin projection carries reporter and subject", async () => {
    const { adminSafetyReport } = await import("../src/server/safety");
    const rec = {
      id: "r1", reporterId: "acc_a", subjectId: "acc_b", cityId: "columbia-mo",
      contextType: "event" as const, contextId: "e1", reason: "Followed me to my car.",
      status: "open" as const, createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z", resolvedAt: null,
    };
    const view = adminSafetyReport(rec);
    expect(view.reporterId).toBe("acc_a");
    expect(view.subjectId).toBe("acc_b");
    expect(view.reason).toBe("Followed me to my car.");
    expect(view.createdAt).toBe("2026-08-30T00:00:00.000Z");
  });

  it("resolves names, and falls back to the id when an account is gone", async () => {
    /*
     * Names because an admin cross-referencing account ids by hand is the same
     * defect one step removed. Fallback because a report must not become
     * unreadable when someone deletes their account — that is exactly when the
     * history matters.
     */
    const { adminSafetyReport } = await import("../src/server/safety");
    const { createMemoryStore } = await import("../src/server/store");
    const db = createMemoryStore();
    const reporter = db.createAccount({ name: "Casey Reporter", email: "c@x.com", cityId: "columbia-mo" });
    const rec = {
      id: "r2", reporterId: reporter.id, subjectId: "acc_gone", cityId: "columbia-mo",
      contextType: "event" as const, contextId: "e1", reason: "text",
      status: "open" as const, createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z", resolvedAt: null,
    };
    const view = adminSafetyReport(rec, db);
    expect(view.reporterName).toBe("Casey Reporter");
    expect(view.subjectName).toBe("acc_gone"); // gone, but still identifiable
  });

  it("the queue renders the subject prominently", () => {
    // Subject first: that is the name the reader needs to act on.
    const src = readFileSync(new URL("../src/components/SafetyReportsAdminSection.tsx", import.meta.url).pathname, "utf8");
    expect(src).toContain("{r.subjectName}");
    expect(src).toContain("{r.reporterName}");
  });

  it("arrival sends an email, not just a badge", () => {
    /*
     * "A badge is something you see if you are already looking; the person who
     * needs to act is asleep." The email is deliberately content-free — the
     * report text stays in the admin queue rather than travelling to an inbox.
     */
    const api = readFileSync(new URL("../src/server/api.ts", import.meta.url).pathname, "utf8");
    const at = api.indexOf("db.addSafetyReport(report);");
    const block = api.slice(at, at + 1400);
    expect(block).toContain("sendEmail(");
    expect(block).toContain("ownerEmail()");
    expect(block).not.toContain("report.reason");
  });
});
