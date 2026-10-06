const params = new URLSearchParams(location.search);
const openingId = params.get("opening");
const candidateId = params.get("candidate");
const token = params.get("token");

const headline = document.querySelector("#headline");
const detail = document.querySelector("#detail");
const deadline = document.querySelector("#deadline");
const actions = document.querySelector("#actions");
const outcome = document.querySelector("#outcome");
const acceptButton = document.querySelector("#accept");
const declineButton = document.querySelector("#decline");
const removeButton = document.querySelector("#remove");

const UNAVAILABLE = "Sorry, this opening is no longer available. You're still on our waitlist.";
const offerUrl = `/api/openings/${openingId}/offers/${candidateId}?token=${encodeURIComponent(token ?? "")}`;
let watcher;

function formatWhen(iso) {
  return new Date(iso).toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function showOutcome(kind, message) {
  clearInterval(watcher);
  actions.hidden = true;
  deadline.textContent = "";
  outcome.className = `result result-${kind}`;
  outcome.textContent = message;
  outcome.hidden = false;
}

function showResolved(offer) {
  if (offer.outcome === "accepted") showOutcome("filled", "You're booked! See you then.");
  else if (offer.outcome === "declined") showOutcome("cancelled", "You declined this one — you're still on our waitlist.");
  else if (offer.outcome === "removed") showOutcome("cancelled", "You've been taken off the waitlist.");
  else showOutcome("unfilled", UNAVAILABLE);
}

async function load() {
  const response = await fetch(offerUrl);
  if (!response.ok) {
    headline.textContent = "Hmm.";
    detail.textContent = "";
    showOutcome("unfilled", response.status === 404 ? "We couldn't find that offer. Please call the salon." : UNAVAILABLE);
    return;
  }
  const offer = await response.json();
  const { opening } = offer;
  headline.textContent = `Hi ${offer.name.split(" ")[0]}, an earlier spot opened up`;
  detail.textContent = `${opening.service} with ${opening.stylist} on ${formatWhen(opening.startAt)} (${opening.durationMinutes} min).`;

  if (!offer.available) {
    showResolved(offer);
    return;
  }
  deadline.textContent = `First come, first served. Please answer by ${new Date(offer.deadline).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  actions.hidden = false;
  // If someone else takes it (or it expires) while this page is open, say so
  // right away instead of waiting for a tap.
  watcher = setInterval(async () => {
    try {
      const latest = await fetch(offerUrl);
      if (!latest.ok) return showOutcome("unfilled", UNAVAILABLE);
      const current = await latest.json();
      if (!current.available) showResolved(current);
    } catch {
      /* transient; try again next tick */
    }
  }, 2000);
}

async function respond(response) {
  acceptButton.disabled = declineButton.disabled = removeButton.disabled = true;
  const result = await fetch(`/api/openings/${openingId}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateId, token, response }),
  }).then((r) => r.json());
  const kind = { confirmed: "filled", declined: "cancelled", removed: "cancelled", unavailable: "unfilled", unknown: "unfilled" }[result.outcome] ?? "unfilled";
  showOutcome(kind, result.message ?? result.error ?? UNAVAILABLE);
}

acceptButton.addEventListener("click", () => respond("accept"));
declineButton.addEventListener("click", () => respond("decline"));
removeButton.addEventListener("click", () => {
  if (confirm("Take you off the waitlist? You won't be texted about earlier openings any more. Your existing appointment is unchanged.")) {
    respond("remove");
  }
});

if (!openingId || !candidateId) {
  headline.textContent = "Hmm.";
  showOutcome("unfilled", "This link is missing some details. Please call the salon.");
} else {
  load().catch(() => showOutcome("unfilled", UNAVAILABLE));
}
