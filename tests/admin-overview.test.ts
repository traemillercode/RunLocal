import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createMemoryStore } from "../src/server/store";
import { adminLogin, type AdminCtx } from "../src/server/admin";
import { adminOverview } from "../src/server/adminOverview";
import { ADMIN_KEY_VAR, ADMIN_EMAIL_VAR } from "../src/server/admin";
const T0 = new Date("2026-08-03T00:00:00.000Z"); const KEY="overview-test-key";
const ctx=(adminSessionId:string|null,userSessionId:string|null=null,reason="overview review"):AdminCtx=>({adminSessionId,userSessionId,reason,ip:"198.51.100.7"});
describe("admin overview",()=>{ beforeEach(()=>{process.env[ADMIN_KEY_VAR]=KEY;process.env[ADMIN_EMAIL_VAR]="admin@test"}); afterEach(()=>{delete process.env[ADMIN_KEY_VAR];delete process.env[ADMIN_EMAIL_VAR]});
 it("requires authorization but not a user-entered reason",()=>{const db=createMemoryStore(); expect(adminOverview(db,ctx(null,null,""),T0).ok).toBe(false); const login=adminLogin(db,KEY,"198.51.100.7",T0); if(!login.ok)throw Error("login"); expect(adminOverview(db,ctx(login.data.sessionId,null,""),T0).ok).toBe(true)});
 it("returns aggregate global counts without sensitive fields",()=>{const db=createMemoryStore(); const login=adminLogin(db,KEY,"198.51.100.7",T0); if(!login.ok)throw Error("login"); db.createAccount({name:"Pending",email:"p@test",cityId:"columbia-mo"}); const r=adminOverview(db,ctx(login.data.sessionId),T0); expect(r.ok).toBe(true); if(r.ok){expect(r.data.scope.kind).toBe("global"); expect(r.data.queues.pendingVerification).toBe(1); expect(JSON.stringify(r.data)).not.toMatch(/email|phone|selfie|ip|reason/i)}});
});

  // UI placement contract is covered by the page source: overview refresh owns its distinct reason field.
