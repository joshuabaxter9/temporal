const form = document.querySelector("#opening-form");
const formError = document.querySelector("#form-error");
const submitButton = document.querySelector("#submit");
const stylistSelect = document.querySelector("#stylist");
const serviceSelect = document.querySelector("#service");
const startAtInput = document.querySelector("#startAt");
const durationInput = document.querySelector("#durationMinutes");
const openingsRoot = document.querySelector("#openings");
const messagesRoot = document.querySelector("#messages");
const waitlistRoot = document.querySelector("#waitlist");
const resetButton = document.querySelector("#reset");

let services = [];
const expanded = new Set();

const PHASE_LABEL = {
  searching: "Searching waitlist",
  offering: "Offers out",
  filled: "Filled",
  unfilled: "Not filled",
  cancelled: "Cancelled",
};

const OUTCOME_LABEL = {
  pending: "waiting",
  accepted: "accepted",
  declined: "declined",
  removed: "declined & left the waitlist",
  timed_out: "no answer",
  lost: "someone else accepted first",
  withdrawn: "withdrawn by staff",
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function formatWhen(iso) {
  return new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function countdown(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "expiring…";
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s left` : `${seconds}s left`;
}

async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

// ---- Form ----------------------------------------------------------------

async function loadReference() {
  const reference = await api("/api/reference");
  stylistSelect.innerHTML = reference.stylists.map((s) => `<option>${escapeHtml(s)}</option>`).join("");
  services = reference.services;
  serviceSelect.innerHTML = services.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)} · ${s.durationMinutes} min</option>`).join("");
  durationInput.value = services[0]?.durationMinutes ?? 45;

  // Default to a same-day slot a couple of hours out.
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  startAtInput.value = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}`;
}

serviceSelect.addEventListener("change", () => {
  const service = services.find((s) => s.name === serviceSelect.value);
  if (service) durationInput.value = service.durationMinutes;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.hidden = true;
  submitButton.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    const body = {
      stylist: data.stylist,
      service: data.service,
      startAt: new Date(data.startAt).toISOString(),
      durationMinutes: Number(data.durationMinutes),
      enteredBy: data.enteredBy,
      offersPerRound: Number(data.offersPerRound) || undefined,
      responseWindowSeconds: Number(data.responseWindowSeconds) || undefined,
    };
    const { openingId } = await api("/api/openings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expanded.add(openingId);
    await refresh();
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});

resetButton.addEventListener("click", async () => {
  if (!confirm("Restore the demo waitlist, clear sent texts, and cancel any openings still in progress?")) return;
  resetButton.disabled = true;
  try {
    await api("/api/reset", { method: "POST" });
    await refresh();
  } finally {
    resetButton.disabled = false;
  }
});

// ---- Openings ------------------------------------------------------------

function renderOffer(offer, { live } = {}) {
  const label = live ? countdown(offer.deadline) : OUTCOME_LABEL[offer.outcome] ?? offer.outcome;
  const when = offer.respondedAt ? ` · ${formatTime(offer.respondedAt)}` : "";
  return `<li class="offer offer-${offer.outcome}">
    <span class="name">${escapeHtml(offer.name)}</span>
    <span class="muted">${escapeHtml(offer.service)} · round ${offer.round}</span>
    <span class="pill">${escapeHtml(label)}${when}</span>
  </li>`;
}

function renderResult(status) {
  const { result } = status;
  if (!result) return "";
  if (result.outcome === "filled") {
    return `<p class="result result-filled"><strong>Filled.</strong> ${escapeHtml(result.name)} (${escapeHtml(result.service)}) accepted at ${formatTime(result.confirmedAt)} and has been taken off the waitlist.</p>`;
  }
  if (result.outcome === "cancelled") {
    return `<p class="result result-cancelled"><strong>Cancelled.</strong> ${escapeHtml(result.reason)}</p>`;
  }
  return `<p class="result result-unfilled"><strong>Not filled.</strong> ${escapeHtml(result.reason)}</p>`;
}

function renderOpening(status) {
  const { opening, policy } = status;
  const active = !status.result;
  const isOpen = expanded.has(opening.id);
  const declined = status.history.filter((o) => o.outcome !== "accepted");

  return `<article class="card opening phase-${status.phase}" data-id="${opening.id}">
    <header class="opening-header">
      <div>
        <h3>${escapeHtml(opening.service)} with ${escapeHtml(opening.stylist)}</h3>
        <p class="muted">${formatWhen(opening.startAt)} · ${opening.durationMinutes} min · entered by ${escapeHtml(opening.enteredBy)}</p>
      </div>
      <div class="opening-actions">
        <span class="badge badge-${status.phase}">${PHASE_LABEL[status.phase]}</span>
        ${active ? `<button class="danger cancel" data-id="${opening.id}">Cancel offers</button>` : ""}
      </div>
    </header>

    ${renderResult(status)}

    <div class="columns">
      <div>
        <h4>Current offer${status.currentOffers.length === 1 ? "" : "s"} ${status.currentOffers.length ? `<span class="muted">round ${status.round}</span>` : ""}</h4>
        ${status.currentOffers.length
          ? `<ul class="offers">${status.currentOffers.map((o) => renderOffer(o, { live: true })).join("")}</ul>`
          : `<p class="muted">${active ? "—" : "None"}</p>`}
        <h4>Remaining candidates <span class="muted">${status.remaining.length}</span></h4>
        ${status.remaining.length
          ? `<ol class="plain">${status.remaining.map((c) => `<li>${escapeHtml(c.name)} <span class="muted">· ${escapeHtml(c.service)}</span></li>`).join("")}</ol>`
          : `<p class="muted">Nobody else is eligible.</p>`}
      </div>
      <div>
        <h4>Declined or timed out <span class="muted">${declined.length}</span></h4>
        ${declined.length
          ? `<ul class="offers">${declined.map((o) => renderOffer(o)).join("")}</ul>`
          : `<p class="muted">—</p>`}
      </div>
    </div>

    <details class="details" ${isOpen ? "open" : ""} data-id="${opening.id}">
      <summary>Rules and search · ${status.searched} on waitlist, ${status.excluded.length} skipped</summary>
      <p class="muted">${policy.offersPerRound} offer${policy.offersPerRound === 1 ? "" : "s"} per round · ${escapeHtml(policy.responseWindowLabel)} · stops ${policy.cutoffBufferMs / 60000} min before the appointment.</p>
      ${status.excluded.length
        ? `<ul class="plain">${status.excluded.map((c) => `<li>${escapeHtml(c.name)} <span class="muted">— ${escapeHtml(c.reason)}</span></li>`).join("")}</ul>`
        : ""}
      <p class="muted mono">Workflow ID: opening-${opening.id}</p>
    </details>
  </article>`;
}

openingsRoot.addEventListener("click", async (event) => {
  const button = event.target.closest("button.cancel");
  if (!button) return;
  const reason = prompt("Why is this opening being cancelled?", "Original client is keeping the appointment");
  if (reason === null) return;
  button.disabled = true;
  try {
    await api(`/api/openings/${button.dataset.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    await refresh();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
});

openingsRoot.addEventListener("toggle", (event) => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement) || !details.dataset.id) return;
  if (details.open) expanded.add(details.dataset.id);
  else expanded.delete(details.dataset.id);
}, true);

// ---- Side panels ---------------------------------------------------------

function renderMessage(message) {
  const link = message.link
    ? `<a class="button small" href="${escapeHtml(message.link)}" target="_blank" rel="noreferrer">Open link as ${escapeHtml(message.name.split(" ")[0])}</a>`
    : "";
  return `<div class="message message-${message.kind}">
    <div class="message-meta"><span class="name">${escapeHtml(message.name)}</span> <span class="muted">${escapeHtml(message.to)} · ${formatTime(message.sentAt)}</span></div>
    <p>${escapeHtml(message.body.replace(/https?:\/\/\S+/g, "").trim())}</p>
    ${link}
  </div>`;
}

function renderWaitlist(entries) {
  if (!entries.length) return `<p class="muted">The waitlist is empty.</p>`;
  return `<ul class="plain waitlist">${entries
    .map((e) => `<li><span class="name">${escapeHtml(e.name)}</span> <span class="muted">· ${escapeHtml(e.service)} (${e.durationMinutes} min) · ${e.preferredStylist ? `wants ${escapeHtml(e.preferredStylist)}` : "any stylist"} · booked ${formatWhen(e.currentAppointmentAt)}</span></li>`)
    .join("")}</ul>`;
}

// ---- Polling -------------------------------------------------------------

async function refresh() {
  const [openings, messages, waitlist] = await Promise.all([
    api("/api/openings"),
    api("/api/messages"),
    api("/api/waitlist"),
  ]);
  openingsRoot.innerHTML = openings.length
    ? openings.map(renderOpening).join("")
    : `<p class="empty">No openings yet. Enter one above to start working the waitlist.</p>`;
  messagesRoot.innerHTML = messages.length
    ? messages.slice().reverse().map(renderMessage).join("")
    : `<p class="muted">No texts sent yet.</p>`;
  waitlistRoot.innerHTML = renderWaitlist(waitlist);
}

loadReference()
  .then(refresh)
  .catch((error) => {
    formError.textContent = `Could not reach the app: ${error.message}`;
    formError.hidden = false;
  });
setInterval(() => refresh().catch(console.error), 1000);
