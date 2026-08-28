import { createMemoryStore } from "./src/server/store";

async function main() {
  const db = createMemoryStore();
  const a = db.createAccount({ name: "Debug Runner", email: "debugrunner@example.com", cityId: "columbia-mo" });
  db.updateAccount(a.id, { status: "verified" });
  const s = db.createSession(a.id, "127.0.0.1");
  console.log("SESSION_COOKIE=" + s.id);
  console.log("ACCOUNT_ID=" + a.id);
}
main();
