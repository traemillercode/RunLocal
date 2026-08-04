import { describe, expect, it, afterEach } from "vitest";
import { autoCard, canShare, cardForActivity, configError, configured, oauthState, publicActivityCard, stateValid, type Activity } from "../src/server/activity";

const activity = (shareMode: Activity["shareMode"]): Activity => ({
  id: "a1", accountId: "runner-1", provider: "strava", type: "run", distanceMeters: 5000,
  durationSeconds: 1500, completedAt: "2026-08-03T07:00:00.000Z", shareMode, caption: "private note",
});

afterEach(() => {
  delete process.env.STRAVA_CLIENT_ID;
  delete process.env.STRAVA_CLIENT_SECRET;
  delete process.env.STRAVA_REDIRECT_URI;
});

describe("activity integration safety contracts", () => {
  it("validates OAuth state once and rejects expiry, mismatch, and replay", () => {
    const state = oauthState("runner-1", "strava");
    expect(stateValid(state, "runner-1", "strava")).toBe(true);
    expect(stateValid(state, "runner-1", "strava")).toBe(false);
    const other = oauthState("runner-1", "strava");
    expect(stateValid(other, "runner-2", "strava")).toBe(false);
    expect(stateValid(other, "runner-1", "garmin")).toBe(false);
  });

  it("reports missing Strava configuration without exposing values", () => {
    expect(configured("strava")).toBe(false);
    expect(configError("strava")).toEqual({ error: "provider_not_configured", provider: "strava", missing: ["STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REDIRECT_URI"] });
    process.env.STRAVA_CLIENT_ID = "id"; process.env.STRAVA_CLIENT_SECRET = "secret"; process.env.STRAVA_REDIRECT_URI = "https://runlocal.ctonew.app/callback";
    expect(configured("strava")).toBe(true);
  });

  it("keeps private activities out of auto/public cards and preserves provider attribution", () => {
    expect(canShare({ status: "verified" }, "auto")).toBe(true);
    expect(canShare({ status: "verified" }, "private")).toBe(false);
    expect(autoCard(activity("private"))).toBeNull();
    const card = publicActivityCard(activity("manual"));
    expect(card).toEqual(expect.objectContaining({ provider: "strava", attribution: "Strava", type: "run" }));
    expect(card).not.toHaveProperty("accountId");
    expect(card).not.toHaveProperty("caption");
    expect(cardForActivity(activity("auto"))).not.toHaveProperty("refreshToken");
  });
});
