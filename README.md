# Juniper Salon — Open chair filler

A working prototype for Lena's salon: when an appointment is cancelled, staff
enter the opening and the system works the waitlist for them — texting a few
clients at a time, moving on automatically when they decline or don't answer,
and guaranteeing only one client can claim the slot.

Every opening is one **Temporal Workflow**, which is the single record of who
was contacted, who declined, who timed out, who holds the offer right now, and
how it ended. That is the bookkeeping Lena said staff lose track of when it's
busy.

## Run it

Requirements: Node.js 20+ and Docker.

```bash
npm install
npm run dev        # starts Temporal (Docker), the Worker and the staff app
```

- Staff app: <http://localhost:3000>
- Temporal Web UI: <http://localhost:8233>

```bash
npm test           # Workflow tests (time-skipping, no Docker needed) + policy tests
npm run typecheck
npm run stop       # stop the Temporal container
```

## Demo walkthrough (about two minutes)

1. Open the staff app. Under **Demo options** set *Response window* to `45`
   seconds so you can watch an expiry (the real rule is 15 minutes).
2. Enter an opening — e.g. *Haircut with Lena*, the default time (two hours
   from now), 45 minutes. Click **Find someone for this slot**.
3. The opening card shows the search result: who is eligible and in what order,
   and who was skipped and why (prefers another stylist, service doesn't fit,
   already booked earlier). Three offers go out at once; each shows a countdown.
4. In **Client phones**, open one client's link and tap **No thanks** — their
   card entry moves to *Declined or timed out* instantly.
5. Let the countdown run out — the remaining two expire and the next round
   starts on its own.
6. Open two clients' links from the new round. Accept with the first: *You're
   booked!*. Accept with the second: *this opening is no longer available*.
   The card shows **Filled**, the winner is removed from the waitlist, and the
   loser is texted that it's gone.
7. Enter another opening and click **Cancel offers** mid-round to see offers
   withdrawn and clients told.
8. Look at any `opening-…` Workflow in the Temporal UI: timers, Activities,
   Signals and Updates are all in the event history.

**Reset demo** restores the waitlist and clears the texts.

## How Lena's requirements map to the design

| What Lena needs | How it works |
|---|---|
| Staff enter the opening; the system does the matching and offers | `POST /api/openings` starts `fillOpeningWorkflow`. The `findCandidates` Activity checks stylist preference, that the client's service fits the slot, and that the slot is actually earlier than their existing appointment, then orders by who asked first. |
| Offer to several people at once, but **no competing acceptances** | Offers go out in rounds (default 3). A client's Accept/Decline is a **Workflow Update**. Temporal runs Update handlers one at a time inside the Workflow, so the first `accept` claims the chair and every later one returns *no longer available* — there is no window for a double booking. |
| 15 minutes to respond for same-day openings, then move to the next person | Each round sets a durable **Timer**. When it fires, unanswered offers become *timed out* and the next round starts without anyone having to remember. If everyone in a round declines early, it moves on immediately. |
| Openings days away: "keep it moving, your call" | 2 hours per round (one constant in `src/policy.ts`). Any window is clamped so offers stop 30 minutes before the appointment. |
| Staff can cancel if the client changes their mind or the stylist is out | `cancelOpening` **Signal**. Pending offers are *withdrawn* and those clients are texted that it's gone. |
| See the open appointment, the current offer holder, who declined or timed out, remaining candidates, final result | `getStatus` **Query** returns exactly that; the staff page polls it every second. |
| A text with a link; late replies see "no longer available" | `sendTextMessage` Activity (simulated SMS — messages land in an outbox shown as *Client phones*). Each offer carries its own token in the link. Late or duplicate taps get the *no longer available* message, whether the Workflow is still running or already finished. The page also watches the offer and tells the client the moment someone else takes it. |
| Clients can say "not this time" without losing their place | The link offers three choices: **Yes, book me**; **Not this time** (stays on the waitlist); **Take me off the waitlist** (a `removeFromWaitlist` Activity, honoured even on an old link). |
| The booked client knows exactly what they've got | The confirmation text spells out the service, stylist, day, time and length, and names the previous appointment it replaces. |
| Update the system | `recordOutcome` Activity writes the booking log and removes the booked client from the waitlist. Activities retry automatically, so a flaky SMS provider or booking system doesn't lose the result. |

## Repository map

- `src/workflows.ts` — `fillOpeningWorkflow`: rounds, timers, the Update handler that prevents double booking, the cancel Signal, the status Query
- `src/activities.ts` — waitlist search, simulated SMS, waitlist removal, booking-system update
- `src/messages.ts` — the wording of every text the salon sends
- `src/policy.ts` — response-window rules (same-day vs. later, cutoff, round size)
- `src/api.ts` — staff and client HTTP API; Temporal Client
- `src/worker.ts` — Worker on the `juniper-salon` Task Queue
- `src/store.ts`, `src/seed.ts` — JSON-file stand-in for the booking system and SMS outbox; demo waitlist
- `public/` — staff dashboard (`index.html`) and the client's accept/decline page (`offer.html`)
- `tests/` — Workflow tests using Temporal's time-skipping test server; policy unit tests

## Assumptions and what's next

- Eligibility uses stylist preference, service length and "is this actually
  earlier for them". Lena may want more (loyalty, specific stylists only for
  colour).
- The SMS provider and booking system are simulated with JSON files under
  `data/`. Swapping in Twilio or the real booking software means changing two
  Activities; the Workflow doesn't change.
- Quiet hours (no texts late at night) aren't implemented; they'd be a Timer
  before the round starts.
- The response window for later-day openings is a guess (2 hours) for Lena to
  confirm.
