/**
 * Validates the Riegel formula implementation against real, published
 * reference predictions - not just checking the math runs, but checking it
 * matches known-correct outputs from independent sources.
 */
import { describe, expect, it } from "vitest";
import { riegelPredictSeconds, predictAllDistances, computeTrainingZones, STANDARD_DISTANCES_MILES, formatPace, formatDuration } from "../src/lib/paceCalculator";

describe("Riegel formula - validated against published reference predictions", () => {
  it("a 22:00 5K predicts approximately a 3:31 marathon (published reference)", () => {
    const knownSeconds = 22 * 60;
    const marathonSeconds = riegelPredictSeconds(knownSeconds, STANDARD_DISTANCES_MILES["5k"], STANDARD_DISTANCES_MILES.marathon);
    const published = 3 * 3600 + 31 * 60;
    expect(marathonSeconds).toBeGreaterThan(published - 90);
    expect(marathonSeconds).toBeLessThan(published + 90);
  });

  it("a 45:00 10K predicts approximately a 1:40:10 half marathon (published reference)", () => {
    const knownSeconds = 45 * 60;
    const halfSeconds = riegelPredictSeconds(knownSeconds, STANDARD_DISTANCES_MILES["10k"], STANDARD_DISTANCES_MILES.half_marathon);
    const published = 1 * 3600 + 40 * 60 + 10;
    expect(halfSeconds).toBeGreaterThan(published - 60);
    expect(halfSeconds).toBeLessThan(published + 60);
  });

  it("predicting the SAME distance as the input returns the exact same time - the formula shouldn't distort a non-extrapolation", () => {
    const seconds = riegelPredictSeconds(1500, STANDARD_DISTANCES_MILES["5k"], STANDARD_DISTANCES_MILES["5k"]);
    expect(seconds).toBeCloseTo(1500, 5);
  });

  it("predictAllDistances returns all four standard distances with internally consistent pace math", () => {
    const predictions = predictAllDistances(20 * 60, STANDARD_DISTANCES_MILES["5k"]);
    expect(predictions).toHaveLength(4);
    for (const p of predictions) {
      expect(p.seconds / p.miles).toBeCloseTo(p.paceSecPerMile, 5);
    }
    const fiveK = predictions.find((p) => p.distance === "5k")!;
    const marathon = predictions.find((p) => p.distance === "marathon")!;
    expect(marathon.paceSecPerMile).toBeGreaterThan(fiveK.paceSecPerMile);
  });
});

describe("Training zone paces", () => {
  it("zones are correctly ordered from fastest (interval) to slowest (easy)", () => {
    const zones = computeTrainingZones(20 * 60, STANDARD_DISTANCES_MILES["5k"]);
    expect(zones.interval).toBeLessThan(zones.threshold);
    expect(zones.threshold).toBeLessThan(zones.marathon);
    expect(zones.marathon).toBeLessThan(zones.easy);
  });

  it("interval pace matches the predicted 5K pace directly, per the sourced 'interval ≈ current 5K pace' guidance", () => {
    const knownSeconds = 22 * 60;
    const zones = computeTrainingZones(knownSeconds, STANDARD_DISTANCES_MILES["5k"]);
    const fiveK = predictAllDistances(knownSeconds, STANDARD_DISTANCES_MILES["5k"]).find((p) => p.distance === "5k")!;
    expect(zones.interval).toBeCloseTo(fiveK.paceSecPerMile, 5);
  });
});

describe("Formatting", () => {
  it("formats pace as M:SS/mi", () => {
    expect(formatPace(390)).toBe("6:30/mi");
    expect(formatPace(365)).toBe("6:05/mi");
  });

  it("formats duration under an hour as MM:SS, over an hour as H:MM:SS", () => {
    expect(formatDuration(1290)).toBe("21:30");
    expect(formatDuration(12660)).toBe("3:31:00");
  });
});
