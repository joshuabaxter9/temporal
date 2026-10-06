import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type * as activities from "../src/activities";
import { MINUTE } from "../src/policy";
import type { Candidate, FillOpeningInput, Opening, OpeningStatus } from "../src/types";
import { cancelOpening, fillOpeningWorkflow, getStatus, respondToOffer } from "../src/workflows";

const TASK_QUEUE = "juniper-salon-test";

const LATER_APPOINTMENT = "2026-10-20T17:00:00.000Z";
const candidates: Candidate[] = ["Ava", "Ben", "Chloe", "Dev"].map((name, index) => ({
  candidateId: `c-${name.toLowerCase()}`,
  name,
  phone: `+1 555 010${index}`,
  service: index === 1 ? "Trim" : "Haircut",
  durationMinutes: index === 1 ? 20 : 45,
  currentAppointmentAt: LATER_APPOINTMENT,
  requestedAt: new Date(index * MINUTE).toISOString(),
}));

type Sent = Parameters<typeof activities.sendTextMessage>[0];
type Recorded = Parameters<typeof activities.recordOutcome>;

let environment: TestWorkflowEnvironment;
let worker: Worker;
let workerRun: Promise<void>;
const sent: Sent[] = [];
const recorded: Recorded[] = [];
const removed: string[] = [];
let eligible: Candidate[] = candidates;

const mockActivities: typeof activities = {
  async findCandidates() {
    return { searched: eligible.length, eligible: [...eligible], excluded: [] };
  },
  async sendTextMessage(input) {
    sent.push(input);
  },
  async recordOutcome(opening, result) {
    recorded.push([opening, result]);
  },
  async removeFromWaitlist(candidateId) {
    removed.push(candidateId);
  },
};

before(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
  worker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve("../src/workflows"),
    activities: mockActivities,
  });
  workerRun = worker.run();
});

after(async () => {
  worker.shutdown();
  await workerRun;
  await environment.teardown();
});

let counter = 0;
async function startOpening(overrides: { offersPerRound?: number; windowMs?: number; startsInMs?: number } = {}) {
  sent.length = 0;
  recorded.length = 0;
  removed.length = 0;
  eligible = candidates;
  const now = await currentTime();
  const opening: Opening = {
    id: `test-${++counter}`,
    stylist: "Lena",
    service: "Haircut",
    startAt: new Date(now + (overrides.startsInMs ?? 6 * 60 * MINUTE)).toISOString(),
    durationMinutes: 45,
    enteredBy: "test",
    createdAt: new Date(now).toISOString(),
  };
  const input: FillOpeningInput = {
    opening,
    policy: {
      offersPerRound: overrides.offersPerRound ?? 1,
      responseWindowMs: overrides.windowMs ?? 15 * MINUTE,
      responseWindowLabel: "test",
      cutoffBufferMs: 30 * MINUTE,
    },
  };
  const handle = await environment.client.workflow.start(fillOpeningWorkflow, {
    workflowId: `opening-${opening.id}`,
    taskQueue: TASK_QUEUE,
    args: [input],
  });
  return handle;
}

/** The time-skipping server's clock runs ahead of real time after each sleep. */
function currentTime(): Promise<number> {
  return environment.currentTimeMs();
}

async function waitFor(
  handle: Awaited<ReturnType<typeof startOpening>>,
  predicate: (status: OpeningStatus) => boolean,
): Promise<OpeningStatus> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const status = await handle.query(getStatus);
    if (predicate(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for Workflow state");
}

function pendingOffer(status: OpeningStatus, name: string) {
  const offer = status.currentOffers.find((o) => o.name === name);
  assert.ok(offer, `${name} should have a pending offer; have ${status.currentOffers.map((o) => o.name)}`);
  return offer;
}

test("a decline moves to the next person immediately, and an accept fills the chair", async () => {
  const handle = await startOpening({ offersPerRound: 1 });
  let status = await waitFor(handle, (s) => s.currentOffers.length === 1);
  const ava = pendingOffer(status, "Ava");

  const declined = await handle.executeUpdate(respondToOffer, {
    args: [{ candidateId: ava.candidateId, token: ava.token, response: "decline" }],
  });
  assert.equal(declined.outcome, "declined");

  status = await waitFor(handle, (s) => s.round === 2);
  const ben = pendingOffer(status, "Ben");
  assert.deepEqual(
    status.history.map((o) => [o.name, o.outcome]),
    [["Ava", "declined"]],
  );
  assert.deepEqual(status.remaining.map((c) => c.name), ["Chloe", "Dev"]);

  const accepted = await handle.executeUpdate(respondToOffer, {
    args: [{ candidateId: ben.candidateId, token: ben.token, response: "accept" }],
  });
  assert.equal(accepted.outcome, "confirmed");

  const result = await handle.result();
  assert.equal(result.outcome, "filled");
  assert.equal(result.outcome === "filled" && result.name, "Ben");
  assert.equal(recorded.length, 1);
  assert.deepEqual(
    sent.map((m) => [m.kind, m.name]),
    [["offer", "Ava"], ["offer", "Ben"], ["confirmation", "Ben"]],
  );
  // The confirmation carries everything needed to spell out the new appointment
  // and the one it replaces.
  const confirmation = sent.find((m) => m.kind === "confirmation");
  assert.equal(confirmation?.previousAppointmentAt, LATER_APPOINTMENT);
  assert.equal(confirmation?.opening.stylist, "Lena");
  // Ben is waitlisted for a Trim, even though the opening was a Haircut slot.
  assert.equal(confirmation?.service, "Trim");
  assert.equal(confirmation?.durationMinutes, 20);
  assert.equal(removed.length, 0, "a plain decline keeps the client on the waitlist");
});

test("'remove me' declines the offer, takes the client off the waitlist, and moves on", async () => {
  const handle = await startOpening({ offersPerRound: 1 });
  let status = await waitFor(handle, (s) => s.currentOffers.length === 1);
  const ava = pendingOffer(status, "Ava");

  const result = await handle.executeUpdate(respondToOffer, {
    args: [{ candidateId: ava.candidateId, token: ava.token, response: "remove" }],
  });
  assert.equal(result.outcome, "removed");
  assert.deepEqual(removed, ["c-ava"]);
  assert.deepEqual(
    sent.filter((m) => m.kind === "removed").map((m) => m.name),
    ["Ava"],
  );

  status = await waitFor(handle, (s) => s.round === 2);
  pendingOffer(status, "Ben");
  assert.deepEqual(status.history.map((o) => [o.name, o.outcome]), [["Ava", "removed"]]);

  await handle.signal(cancelOpening, { reason: "test cleanup" });
  await handle.result();
});

test("unanswered offers expire and the next round starts automatically", async () => {
  const handle = await startOpening({ offersPerRound: 2 });
  let status = await waitFor(handle, (s) => s.currentOffers.length === 2);
  assert.deepEqual(status.currentOffers.map((o) => o.name), ["Ava", "Ben"]);

  await environment.sleep(16 * MINUTE);

  status = await waitFor(handle, (s) => s.round === 2);
  assert.deepEqual(status.currentOffers.map((o) => o.name), ["Chloe", "Dev"]);
  assert.deepEqual(
    status.history.map((o) => [o.name, o.outcome]),
    [["Ava", "timed_out"], ["Ben", "timed_out"]],
  );

  // Nobody else answers either: the list is exhausted and staff are told.
  const result = await handle.result();
  assert.equal(result.outcome, "unfilled");
  assert.match(result.outcome === "unfilled" ? result.reason : "", /nobody took/i);
});

test("only the first acceptance wins; everyone else is told the opening is gone", async () => {
  const handle = await startOpening({ offersPerRound: 3 });
  const status = await waitFor(handle, (s) => s.currentOffers.length === 3);
  const [ava, ben, chloe] = status.currentOffers;

  const first = await handle.executeUpdate(respondToOffer, {
    args: [{ candidateId: ben.candidateId, token: ben.token, response: "accept" }],
  });
  assert.equal(first.outcome, "confirmed");

  const second = await handle.executeUpdate(respondToOffer, {
    args: [{ candidateId: ava.candidateId, token: ava.token, response: "accept" }],
  });
  assert.equal(second.outcome, "unavailable");

  const result = await handle.result();
  assert.equal(result.outcome === "filled" && result.name, "Ben");
  const final = await handle.query(getStatus);
  assert.deepEqual(
    final.history.map((o) => [o.name, o.outcome]),
    [["Ava", "lost"], ["Ben", "accepted"], ["Chloe", "lost"]],
  );
  assert.equal(chloe.name, "Chloe");
  assert.deepEqual(
    sent.filter((m) => m.kind !== "offer").map((m) => [m.kind, m.name]).sort(),
    [["confirmation", "Ben"], ["unavailable", "Ava"], ["unavailable", "Chloe"]],
  );
});

test("a reply after the window has passed is told the opening is no longer available", async () => {
  const handle = await startOpening({ offersPerRound: 1 });
  const status = await waitFor(handle, (s) => s.currentOffers.length === 1);
  const ava = pendingOffer(status, "Ava");

  await environment.sleep(16 * MINUTE);
  await waitFor(handle, (s) => s.round === 2);

  const late = await handle.executeUpdate(respondToOffer, {
    args: [{ candidateId: ava.candidateId, token: ava.token, response: "accept" }],
  });
  assert.equal(late.outcome, "unavailable");

  const wrongToken = await handle.executeUpdate(respondToOffer, {
    args: [{ candidateId: "c-ben", token: "not-the-token", response: "accept" }],
  });
  assert.equal(wrongToken.outcome, "unknown");

  await handle.signal(cancelOpening, { reason: "test cleanup" });
  await handle.result();
});

test("staff can cancel; pending offers are withdrawn and clients are told", async () => {
  const handle = await startOpening({ offersPerRound: 2 });
  await waitFor(handle, (s) => s.currentOffers.length === 2);

  await handle.signal(cancelOpening, { reason: "Original client is keeping the appointment" });

  const result = await handle.result();
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.outcome === "cancelled" && result.reason, "Original client is keeping the appointment");

  const final = await handle.query(getStatus);
  assert.equal(final.phase, "cancelled");
  assert.deepEqual(
    final.history.map((o) => [o.name, o.outcome]),
    [["Ava", "withdrawn"], ["Ben", "withdrawn"]],
  );
  assert.deepEqual(
    sent.filter((m) => m.kind === "unavailable").map((m) => m.name),
    ["Ava", "Ben"],
  );

  // After the Workflow closes, a late tap can't reach it at all.
  await assert.rejects(
    handle.executeUpdate(respondToOffer, {
      args: [{ candidateId: "c-ava", token: "x", response: "accept" }],
    }),
  );
});

test("the response window is clamped so offers stop before the appointment", async () => {
  // Opening starts in 40 minutes; with a 30-minute cutoff only ~10 minutes remain.
  const handle = await startOpening({ offersPerRound: 1, startsInMs: 40 * MINUTE });
  const status = await waitFor(handle, (s) => s.currentOffers.length === 1);
  const offer = status.currentOffers[0];
  const window = Date.parse(offer.deadline) - Date.parse(offer.offeredAt);
  assert.ok(window <= 10 * MINUTE + 1000, `window should be about 10 minutes, was ${window / MINUTE} min`);

  await environment.sleep(11 * MINUTE);
  const result = await handle.result();
  assert.equal(result.outcome, "unfilled");
  assert.match(result.outcome === "unfilled" ? result.reason : "", /too close/i);
});

test("an empty or ineligible waitlist ends with a clear reason", async () => {
  sent.length = 0;
  eligible = [];
  const now = await currentTime();
  const opening: Opening = {
    id: "test-empty",
    stylist: "Lena",
    service: "Haircut",
    startAt: new Date(now + 6 * 60 * MINUTE).toISOString(),
    durationMinutes: 45,
    enteredBy: "test",
    createdAt: new Date(now).toISOString(),
  };
  const handle = await environment.client.workflow.start(fillOpeningWorkflow, {
    workflowId: `opening-${opening.id}`,
    taskQueue: TASK_QUEUE,
    args: [{ opening, policy: { offersPerRound: 3, responseWindowMs: MINUTE, responseWindowLabel: "t", cutoffBufferMs: 0 } }],
  });
  const result = await handle.result();
  assert.equal(result.outcome, "unfilled");
  assert.match(result.outcome === "unfilled" ? result.reason : "", /empty/i);
  assert.equal(sent.length, 0);
});
