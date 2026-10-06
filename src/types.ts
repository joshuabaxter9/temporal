// Shared data types for the Juniper Salon open-chair filler.

export type WaitlistEntry = {
  id: string;
  name: string;
  phone: string;
  service: string;
  durationMinutes: number;
  /** null means the client is happy with any stylist. */
  preferredStylist: string | null;
  /** ISO timestamp of the later appointment the client already holds. */
  currentAppointmentAt: string;
  /** ISO timestamp of when the client asked to be contacted about an earlier slot. */
  requestedAt: string;
};

export type Opening = {
  id: string;
  stylist: string;
  service: string;
  /** ISO timestamp of when the open chair starts. */
  startAt: string;
  durationMinutes: number;
  enteredBy: string;
  createdAt: string;
};

export type OfferPolicy = {
  /** How many clients are offered the slot at the same time. */
  offersPerRound: number;
  /** How long each round has before unanswered offers expire. */
  responseWindowMs: number;
  /** Human-readable explanation of the window, shown to staff. */
  responseWindowLabel: string;
  /** Stop offering this close to the appointment start. */
  cutoffBufferMs: number;
};

export type FillOpeningInput = {
  opening: Opening;
  policy: OfferPolicy;
};

export type OfferOutcome =
  | "pending"
  | "accepted"
  | "declined"
  /** Declined and asked to be taken off the waitlist altogether. */
  | "removed"
  | "timed_out"
  /** Someone else accepted first while this offer was still pending. */
  | "lost"
  /** Staff cancelled the opening while this offer was still pending. */
  | "withdrawn";

export type Offer = {
  candidateId: string;
  name: string;
  phone: string;
  service: string;
  durationMinutes: number;
  /** The later appointment this opening would replace. */
  currentAppointmentAt: string;
  /** Secret included in the client's link so only they can answer their offer. */
  token: string;
  round: number;
  offeredAt: string;
  deadline: string;
  outcome: OfferOutcome;
  respondedAt?: string;
};

export type Candidate = {
  candidateId: string;
  name: string;
  phone: string;
  service: string;
  durationMinutes: number;
  currentAppointmentAt: string;
  requestedAt: string;
};

export type ExcludedCandidate = {
  candidateId: string;
  name: string;
  reason: string;
};

export type CandidateSearch = {
  searched: number;
  eligible: Candidate[];
  excluded: ExcludedCandidate[];
};

export type Phase = "searching" | "offering" | "filled" | "unfilled" | "cancelled";

export type OpeningResult =
  | { outcome: "filled"; candidateId: string; name: string; phone: string; service: string; confirmedAt: string }
  | { outcome: "unfilled"; reason: string; at: string }
  | { outcome: "cancelled"; reason: string; at: string };

export type OpeningStatus = {
  opening: Opening;
  policy: OfferPolicy;
  phase: Phase;
  round: number;
  /** Offers that are still waiting on an answer in the current round. */
  currentOffers: Offer[];
  /** Every offer that has been resolved, oldest first. */
  history: Offer[];
  /** Eligible clients who have not been offered the slot yet. */
  remaining: Candidate[];
  /** Waitlist clients who were skipped, and why. */
  excluded: ExcludedCandidate[];
  searched: number;
  result?: OpeningResult;
  updatedAt: string;
};

export type ClientResponse = {
  candidateId: string;
  token: string;
  /** decline = not this time, stay on the waitlist; remove = take me off the waitlist. */
  response: "accept" | "decline" | "remove";
};

export type ClientResponseResult = {
  outcome: "confirmed" | "declined" | "removed" | "unavailable" | "unknown";
  message: string;
};

export type TextMessageKind = "offer" | "confirmation" | "unavailable" | "removed";

export type TextMessage = {
  id: string;
  kind: TextMessageKind;
  openingId: string;
  candidateId: string;
  to: string;
  name: string;
  body: string;
  link?: string;
  sentAt: string;
};

export type BookingRecord = {
  openingId: string;
  stylist: string;
  startAt: string;
  result: OpeningResult;
  recordedAt: string;
};
