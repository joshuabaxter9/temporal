import { composeTextMessage, formatWhen, type TextMessageInput } from "./messages";
import { store } from "./store";
import type { BookingRecord, CandidateSearch, Opening, OpeningResult } from "./types";

/**
 * Search the waitlist for clients who could take this opening. Everyone on the
 * list is considered; the ones skipped are returned with a reason so staff can
 * see why a familiar name wasn't contacted.
 */
export async function findCandidates(opening: Opening): Promise<CandidateSearch> {
  const waitlist = store.getWaitlist();
  const result: CandidateSearch = { searched: waitlist.length, eligible: [], excluded: [] };

  for (const entry of waitlist) {
    let reason: string | undefined;
    if (entry.preferredStylist && entry.preferredStylist !== opening.stylist) {
      reason = `Prefers ${entry.preferredStylist}`;
    } else if (entry.durationMinutes > opening.durationMinutes) {
      reason = `${entry.service} needs ${entry.durationMinutes} min; opening is ${opening.durationMinutes} min`;
    } else if (Date.parse(entry.currentAppointmentAt) <= Date.parse(opening.startAt)) {
      reason = `Already booked earlier (${formatWhen(entry.currentAppointmentAt)})`;
    }

    if (reason) {
      result.excluded.push({ candidateId: entry.id, name: entry.name, reason });
    } else {
      result.eligible.push({
        candidateId: entry.id,
        name: entry.name,
        phone: entry.phone,
        service: entry.service,
        durationMinutes: entry.durationMinutes,
        currentAppointmentAt: entry.currentAppointmentAt,
        requestedAt: entry.requestedAt,
      });
    }
  }

  // First to ask is first to be offered.
  result.eligible.sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt));
  return result;
}

/**
 * Stand-in for an SMS provider. Messages land in an outbox the staff UI shows
 * as "client phones", so the demo can follow the client's side too.
 */
export async function sendTextMessage(input: TextMessageInput): Promise<void> {
  const message = composeTextMessage(input);
  store.appendMessage(message);
  console.log(`[sms → ${message.to}] ${message.body}`);
}

/** A client asked, from their text, to stop being contacted about openings. */
export async function removeFromWaitlist(candidateId: string): Promise<void> {
  store.removeFromWaitlist(candidateId);
}

/**
 * Update the booking system with the final result. When the chair is filled
 * the client comes off the waitlist so they aren't offered another slot.
 */
export async function recordOutcome(opening: Opening, result: OpeningResult): Promise<void> {
  const record: BookingRecord = {
    openingId: opening.id,
    stylist: opening.stylist,
    startAt: opening.startAt,
    result,
    recordedAt: new Date().toISOString(),
  };
  store.appendBooking(record);
  if (result.outcome === "filled") {
    store.removeFromWaitlist(result.candidateId);
  }
}
