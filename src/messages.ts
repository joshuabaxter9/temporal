import { randomUUID } from "node:crypto";
import { SALON_TIME_ZONE } from "./policy";
import type { Opening, TextMessage, TextMessageKind } from "./types";

// The wording of every text the salon sends, in one place. Used by the
// sendTextMessage Activity and, for one edge case, directly by the API.

const publicUrl = process.env.PUBLIC_URL ?? "http://localhost:3000";

export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SALON_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatLong(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SALON_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export type TextMessageInput = {
  kind: TextMessageKind;
  opening: Opening;
  candidateId: string;
  name: string;
  phone: string;
  /** Offer messages only: used to build the accept/decline link. */
  token?: string;
  deadline?: string;
  /** Confirmation messages only: what the client is actually booked for. */
  service?: string;
  durationMinutes?: number;
  /** Confirmation messages only: the appointment the new one replaces. */
  previousAppointmentAt?: string;
};

export function composeTextMessage(input: TextMessageInput): TextMessage {
  const { opening, kind } = input;
  const slot = `${opening.service} with ${opening.stylist} on ${formatWhen(opening.startAt)}`;
  let body: string;
  let link: string | undefined;

  switch (kind) {
    case "offer": {
      const params = new URLSearchParams({
        opening: opening.id,
        candidate: input.candidateId,
        token: input.token ?? "",
      });
      link = `${publicUrl}/offer.html?${params.toString()}`;
      const until = input.deadline ? ` Reply by ${formatWhen(input.deadline)}.` : "";
      body = `Hi ${input.name}, Juniper Salon has an earlier opening: ${slot}. It's first come, first served.${until} Accept or decline here: ${link}`;
      break;
    }
    case "confirmation": {
      const service = input.service ?? opening.service;
      const minutes = input.durationMinutes ?? opening.durationMinutes;
      const replaces = input.previousAppointmentAt
        ? ` This replaces your previous appointment on ${formatLong(input.previousAppointmentAt)}, so there's nothing else to do.`
        : "";
      body = `Hi ${input.name}, you're all set! Your new appointment at Juniper Salon is confirmed: ${service} with ${opening.stylist} on ${formatLong(opening.startAt)} (${minutes} min).${replaces} See you then!`;
      break;
    }
    case "unavailable":
      body = `Hi ${input.name}, that opening (${slot}) is no longer available. You're still on our waitlist and we'll text you about the next one. — Juniper Salon`;
      break;
    case "removed":
      body = `Hi ${input.name}, you've been taken off the Juniper Salon waitlist and won't get any more texts about earlier openings. Your existing appointment is unchanged. Just let us know if you'd like back on.`;
      break;
  }

  return {
    id: randomUUID(),
    kind,
    openingId: opening.id,
    candidateId: input.candidateId,
    to: input.phone,
    name: input.name,
    body,
    link,
    sentAt: new Date().toISOString(),
  };
}
