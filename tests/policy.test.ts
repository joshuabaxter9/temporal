import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_OFFERS_PER_ROUND, FUTURE_WINDOW_MS, HOUR, SAME_DAY_WINDOW_MS, resolvePolicy } from "../src/policy";

const TZ = "America/Los_Angeles";
const now = new Date("2026-10-06T16:00:00Z"); // 9am Pacific

test("same-day openings get Lena's 15-minute window", () => {
  const policy = resolvePolicy({ startAt: "2026-10-06T22:00:00Z" }, now, {}, TZ); // 3pm same day
  assert.equal(policy.responseWindowMs, SAME_DAY_WINDOW_MS);
  assert.match(policy.responseWindowLabel, /same-day/);
  assert.equal(policy.offersPerRound, DEFAULT_OFFERS_PER_ROUND);
});

test("openings on a later day get the longer window", () => {
  const policy = resolvePolicy({ startAt: "2026-10-08T17:00:00Z" }, now, {}, TZ);
  assert.equal(policy.responseWindowMs, FUTURE_WINDOW_MS);
  assert.match(policy.responseWindowLabel, /later day/);
});

test("same-day is judged in the salon's time zone, not UTC", () => {
  // 11pm Pacific on Oct 6 is already Oct 7 in UTC.
  const policy = resolvePolicy({ startAt: "2026-10-07T06:00:00Z" }, now, {}, TZ);
  assert.equal(policy.responseWindowMs, SAME_DAY_WINDOW_MS);
});

test("demo overrides replace the window and round size", () => {
  const policy = resolvePolicy({ startAt: new Date(now.getTime() + HOUR).toISOString() }, now, {
    offersPerRound: 2,
    responseWindowSeconds: 45,
  }, TZ);
  assert.equal(policy.responseWindowMs, 45_000);
  assert.equal(policy.offersPerRound, 2);
  assert.match(policy.responseWindowLabel, /demo/);
});
