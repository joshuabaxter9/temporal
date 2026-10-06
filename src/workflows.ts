import {
  allHandlersFinished,
  condition,
  defineQuery,
  defineSignal,
  defineUpdate,
  proxyActivities,
  setHandler,
  uuid4,
} from "@temporalio/workflow";
import type * as activities from "./activities";
import type {
  ClientResponse,
  ClientResponseResult,
  FillOpeningInput,
  Offer,
  OpeningResult,
  OpeningStatus,
} from "./types";

const { findCandidates, sendTextMessage, recordOutcome, removeFromWaitlist } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "10 seconds",
    maximumAttempts: 10,
  },
});

/** Staff dashboard reads the whole picture through this Query. */
export const getStatus = defineQuery<OpeningStatus>("getStatus");

/** Staff cancel: the original client came back, or the stylist is unavailable. */
export const cancelOpening = defineSignal<[{ reason?: string }]>("cancelOpening");

/**
 * A client tapping Accept or Decline in their text. This is an Update rather
 * than a Signal so the client gets a definitive answer back: Updates are
 * handled one at a time inside the Workflow, so the first "accept" claims the
 * chair and every later one is told the opening is no longer available.
 */
export const respondToOffer = defineUpdate<ClientResponseResult, [ClientResponse]>("respondToOffer");

const UNAVAILABLE: ClientResponseResult = {
  outcome: "unavailable",
  message: "Sorry, this opening is no longer available. You're still on our waitlist.",
};

/**
 * Fills one open chair. Offers go out in rounds of `policy.offersPerRound`;
 * each round waits up to the response window, then unanswered offers expire
 * and the next round starts automatically. Ends when someone accepts, the
 * list is exhausted, it's too close to the appointment, or staff cancel.
 */
export async function fillOpeningWorkflow(input: FillOpeningInput): Promise<OpeningResult> {
  const { opening, policy } = input;

  const status: OpeningStatus = {
    opening,
    policy,
    phase: "searching",
    round: 0,
    currentOffers: [],
    history: [],
    remaining: [],
    excluded: [],
    searched: 0,
    updatedAt: new Date().toISOString(),
  };
  let claim: Offer | undefined;
  let cancelReason: string | undefined;

  const touch = () => {
    status.updatedAt = new Date().toISOString();
  };
  const isOpen = () => !claim && !cancelReason && !status.result;

  setHandler(getStatus, () => status);

  setHandler(cancelOpening, ({ reason } = {}) => {
    if (!isOpen()) return;
    cancelReason = reason?.trim() || "Cancelled by staff";
    touch();
  });

  setHandler(
    respondToOffer,
    async ({ candidateId, token, response }): Promise<ClientResponseResult> => {
      const offer =
        status.currentOffers.find((o) => o.candidateId === candidateId) ??
        status.history.find((o) => o.candidateId === candidateId);
      if (!offer || offer.token !== token) {
        return { outcome: "unknown", message: "We couldn't find that offer. Please contact the salon." };
      }

      // "Remove me" is honoured even if the offer itself has lapsed.
      if (response === "remove") {
        if (offer.outcome === "pending" && isOpen()) {
          offer.outcome = "removed";
          offer.respondedAt = new Date().toISOString();
          touch();
        }
        await removeFromWaitlist(offer.candidateId);
        await sendTextMessage({ kind: "removed", opening, candidateId: offer.candidateId, name: offer.name, phone: offer.phone });
        return { outcome: "removed", message: "Done — you've been taken off the waitlist and won't get any more texts about openings." };
      }

      const expired = Date.now() > Date.parse(offer.deadline);
      if (!isOpen() || offer.outcome !== "pending" || expired) {
        return UNAVAILABLE;
      }

      offer.respondedAt = new Date().toISOString();
      if (response === "decline") {
        offer.outcome = "declined";
        touch();
        return { outcome: "declined", message: "No problem — you're still on our waitlist for the next opening." };
      }
      offer.outcome = "accepted";
      claim = offer;
      touch();
      return { outcome: "confirmed", message: "You're booked! We'll text you a confirmation." };
    },
    {
      validator: ({ response }) => {
        if (response !== "accept" && response !== "decline" && response !== "remove") {
          throw new Error(`response must be "accept", "decline" or "remove", got "${response}"`);
        }
      },
    },
  );

  const search = await findCandidates(opening);
  status.searched = search.searched;
  status.excluded = search.excluded;
  status.remaining = search.eligible;
  touch();

  while (isOpen() && status.remaining.length > 0) {
    const timeLeft = Date.parse(opening.startAt) - policy.cutoffBufferMs - Date.now();
    const windowMs = Math.min(policy.responseWindowMs, timeLeft);
    if (windowMs <= 0) {
      status.result = {
        outcome: "unfilled",
        reason: "Too close to the appointment time to keep making offers.",
        at: new Date().toISOString(),
      };
      break;
    }

    status.round += 1;
    status.phase = "offering";
    const batch = status.remaining.splice(0, policy.offersPerRound);
    const offeredAt = new Date().toISOString();
    const deadline = new Date(Date.now() + windowMs).toISOString();
    status.currentOffers = batch.map((candidate) => ({
      candidateId: candidate.candidateId,
      name: candidate.name,
      phone: candidate.phone,
      service: candidate.service,
      durationMinutes: candidate.durationMinutes,
      currentAppointmentAt: candidate.currentAppointmentAt,
      token: uuid4(),
      round: status.round,
      offeredAt,
      deadline,
      outcome: "pending",
    }));
    touch();

    await Promise.all(
      status.currentOffers.map((offer) =>
        sendTextMessage({
          kind: "offer",
          opening,
          candidateId: offer.candidateId,
          name: offer.name,
          phone: offer.phone,
          token: offer.token,
          deadline,
        }),
      ),
    );

    // Durable wait: someone accepts, everyone declines, staff cancel, or the window runs out.
    await condition(
      () => !isOpen() || status.currentOffers.every((offer) => offer.outcome !== "pending"),
      Math.max(0, Date.parse(deadline) - Date.now()),
    );

    const unresolved = claim ? "lost" : cancelReason ? "withdrawn" : "timed_out";
    for (const offer of status.currentOffers) {
      if (offer.outcome === "pending") offer.outcome = unresolved;
    }
    status.history.push(...status.currentOffers);
    status.currentOffers = [];
    touch();
  }

  if (claim) {
    status.phase = "filled";
    status.result = {
      outcome: "filled",
      candidateId: claim.candidateId,
      name: claim.name,
      phone: claim.phone,
      service: claim.service,
      confirmedAt: claim.respondedAt ?? new Date().toISOString(),
    };
  } else if (cancelReason) {
    status.phase = "cancelled";
    status.result = { outcome: "cancelled", reason: cancelReason, at: new Date().toISOString() };
  } else {
    status.phase = "unfilled";
    status.result ??= {
      outcome: "unfilled",
      reason:
        status.searched === 0
          ? "The waitlist is empty."
          : status.history.length === 0
            ? "Nobody on the waitlist is eligible for this opening."
            : "Everyone eligible was contacted and nobody took the opening.",
      at: new Date().toISOString(),
    };
  }
  touch();

  await recordOutcome(opening, status.result);

  // Courtesy texts: confirm the winner, and let anyone left hanging know.
  const notices = status.history
    .filter((offer) => offer.outcome === "lost" || offer.outcome === "withdrawn")
    .map((offer) =>
      sendTextMessage({
        kind: "unavailable",
        opening,
        candidateId: offer.candidateId,
        name: offer.name,
        phone: offer.phone,
      }),
    );
  if (claim) {
    notices.push(
      sendTextMessage({
        kind: "confirmation",
        opening,
        candidateId: claim.candidateId,
        name: claim.name,
        phone: claim.phone,
        service: claim.service,
        durationMinutes: claim.durationMinutes,
        previousAppointmentAt: claim.currentAppointmentAt,
      }),
    );
  }
  await Promise.all(notices);

  // A "remove me" tap may still be mid-flight; let it finish before closing.
  await condition(allHandlersFinished);
  return status.result;
}
