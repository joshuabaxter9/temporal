import { randomUUID } from "node:crypto";
import path from "node:path";
import { Client, Connection, WorkflowNotFoundError } from "@temporalio/client";
import express, { type NextFunction, type Request, type Response } from "express";
import { NAMESPACE, TASK_QUEUE, TEMPORAL_ADDRESS, WORKFLOW_TYPE } from "./config";
import { composeTextMessage } from "./messages";
import { CUTOFF_BUFFER_MS, MINUTE, resolvePolicy } from "./policy";
import { SERVICES, STYLISTS } from "./seed";
import { store } from "./store";
import type { ClientResponse, ClientResponseResult, Opening, OpeningStatus } from "./types";
import { cancelOpening, fillOpeningWorkflow, getStatus, respondToOffer } from "./workflows";

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

let clientPromise: Promise<Client> | undefined;
function getClient(): Promise<Client> {
  clientPromise ??= Connection.connect({ address: TEMPORAL_ADDRESS }).then(
    (connection) => new Client({ connection, namespace: NAMESPACE }),
  );
  return clientPromise;
}

const workflowIdFor = (openingId: string) => `opening-${openingId}`;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function queryStatus(client: Client, openingId: string): Promise<OpeningStatus> {
  return client.workflow.getHandle(workflowIdFor(openingId)).query(getStatus);
}

// ---- Reference data for the staff form ----------------------------------

app.get("/api/reference", (_request, response) => {
  response.json({
    stylists: STYLISTS,
    services: SERVICES,
    cutoffMinutes: CUTOFF_BUFFER_MS / MINUTE,
  });
});

app.get("/api/waitlist", (_request, response) => {
  response.json(store.getWaitlist());
});

app.get("/api/messages", (_request, response) => {
  response.json(store.getMessages());
});

app.get("/api/bookings", (_request, response) => {
  response.json(store.getBookings());
});

// ---- Openings (one Workflow each) ---------------------------------------

type NewOpeningBody = {
  stylist?: string;
  service?: string;
  startAt?: string;
  durationMinutes?: number;
  enteredBy?: string;
  offersPerRound?: number;
  responseWindowSeconds?: number;
};

app.post("/api/openings", async (request, response, next) => {
  try {
    const body = request.body as NewOpeningBody;
    const stylist = body.stylist?.trim();
    const service = body.service?.trim();
    const startAt = body.startAt ? new Date(body.startAt) : undefined;
    const durationMinutes = Number(body.durationMinutes);

    if (!stylist) throw new HttpError(400, "Choose a stylist.");
    if (!service) throw new HttpError(400, "Choose a service.");
    if (!startAt || Number.isNaN(startAt.getTime())) throw new HttpError(400, "Enter a valid start time.");
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      throw new HttpError(400, "Duration must be a positive number of minutes.");
    }
    if (startAt.getTime() - Date.now() <= CUTOFF_BUFFER_MS) {
      throw new HttpError(
        400,
        `Openings must start more than ${CUTOFF_BUFFER_MS / MINUTE} minutes from now so there is time to make offers.`,
      );
    }

    const opening: Opening = {
      id: randomUUID().slice(0, 8),
      stylist,
      service,
      startAt: startAt.toISOString(),
      durationMinutes,
      enteredBy: body.enteredBy?.trim() || "Front desk",
      createdAt: new Date().toISOString(),
    };
    const policy = resolvePolicy(opening, new Date(), {
      offersPerRound: body.offersPerRound ? Math.max(1, Number(body.offersPerRound)) : undefined,
      responseWindowSeconds: body.responseWindowSeconds
        ? Math.max(5, Number(body.responseWindowSeconds))
        : undefined,
    });

    const client = await getClient();
    await client.workflow.start(fillOpeningWorkflow, {
      workflowId: workflowIdFor(opening.id),
      taskQueue: TASK_QUEUE,
      args: [{ opening, policy }],
    });
    response.status(201).json({ openingId: opening.id, workflowId: workflowIdFor(opening.id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/openings", async (_request, response, next) => {
  try {
    const client = await getClient();
    const statuses: OpeningStatus[] = [];
    for await (const execution of client.workflow.list({
      query: `WorkflowType = '${WORKFLOW_TYPE}'`,
    })) {
      try {
        statuses.push(
          await client.workflow.getHandle(execution.workflowId, execution.runId).query(getStatus),
        );
      } catch (error) {
        console.warn(`Could not read ${execution.workflowId}:`, (error as Error).message);
      }
    }
    statuses.sort((a, b) => Date.parse(b.opening.createdAt) - Date.parse(a.opening.createdAt));
    response.json(statuses);
  } catch (error) {
    next(error);
  }
});

app.get("/api/openings/:openingId", async (request, response, next) => {
  try {
    const client = await getClient();
    response.json(await queryStatus(client, request.params.openingId));
  } catch (error) {
    next(error instanceof WorkflowNotFoundError ? new HttpError(404, "Opening not found.") : error);
  }
});

app.post("/api/openings/:openingId/cancel", async (request, response, next) => {
  try {
    const client = await getClient();
    const reason = (request.body as { reason?: string } | undefined)?.reason;
    await client.workflow.getHandle(workflowIdFor(request.params.openingId)).signal(cancelOpening, { reason });
    response.status(202).json({ accepted: true });
  } catch (error) {
    next(error instanceof WorkflowNotFoundError ? new HttpError(409, "This opening has already finished.") : error);
  }
});

// ---- Client side: what one client sees when they tap their link ----------

app.get("/api/openings/:openingId/offers/:candidateId", async (request, response, next) => {
  try {
    const token = String(request.query.token ?? "");
    const client = await getClient();
    const status = await queryStatus(client, request.params.openingId);
    const offer = [...status.currentOffers, ...status.history].find(
      (candidate) => candidate.candidateId === request.params.candidateId,
    );
    if (!offer || offer.token !== token) throw new HttpError(404, "We couldn't find that offer.");

    const { opening } = status;
    const stillOpen = offer.outcome === "pending" && !status.result && Date.now() < Date.parse(offer.deadline);
    response.json({
      name: offer.name,
      opening: {
        stylist: opening.stylist,
        service: opening.service,
        startAt: opening.startAt,
        durationMinutes: opening.durationMinutes,
      },
      deadline: offer.deadline,
      outcome: offer.outcome,
      available: stillOpen,
    });
  } catch (error) {
    next(error instanceof WorkflowNotFoundError ? new HttpError(404, "We couldn't find that offer.") : error);
  }
});

app.post("/api/openings/:openingId/respond", async (request, response, next) => {
  try {
    const body = request.body as Partial<ClientResponse>;
    if (!body.candidateId || !body.token || !body.response) {
      throw new HttpError(400, "candidateId, token and response are required.");
    }
    const client = await getClient();
    const handle = client.workflow.getHandle(workflowIdFor(request.params.openingId));
    let result: ClientResponseResult;
    try {
      result = await handle.executeUpdate(respondToOffer, {
        args: [{ candidateId: body.candidateId, token: body.token, response: body.response }],
      });
    } catch (error) {
      // The Workflow has already finished (filled, cancelled or given up), so
      // the opening is gone — but "remove me" should still be honoured.
      if (isClosedWorkflowError(error)) {
        if (body.response === "remove") {
          const status = await handle.query(getStatus);
          const offer = [...status.currentOffers, ...status.history].find(
            (candidate) => candidate.candidateId === body.candidateId && candidate.token === body.token,
          );
          if (!offer) throw new HttpError(404, "We couldn't find that offer.");
          store.removeFromWaitlist(offer.candidateId);
          store.appendMessage(
            composeTextMessage({
              kind: "removed",
              opening: status.opening,
              candidateId: offer.candidateId,
              name: offer.name,
              phone: offer.phone,
            }),
          );
          result = {
            outcome: "removed",
            message: "Done — you've been taken off the waitlist and won't get any more texts about openings.",
          };
        } else {
          result = {
            outcome: "unavailable",
            message: "Sorry, this opening is no longer available. You're still on our waitlist.",
          };
        }
      } else {
        throw error;
      }
    }
    response.json(result);
  } catch (error) {
    next(error);
  }
});

function isClosedWorkflowError(error: unknown): boolean {
  if (error instanceof WorkflowNotFoundError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /already completed|not found|closed/i.test(message);
}

// ---- Demo helpers --------------------------------------------------------

app.post("/api/reset", async (_request, response, next) => {
  try {
    const client = await getClient();
    // Cancel anything still in progress and let it finish sending its courtesy
    // texts before the outbox is cleared, so a fresh demo starts empty.
    const finishing: Promise<unknown>[] = [];
    for await (const execution of client.workflow.list({
      query: `WorkflowType = '${WORKFLOW_TYPE}' AND ExecutionStatus = 'Running'`,
    })) {
      const handle = client.workflow.getHandle(execution.workflowId, execution.runId);
      finishing.push(
        handle
          .signal(cancelOpening, { reason: "Demo reset" })
          .then(() => handle.result())
          .catch(() => undefined),
      );
    }
    await Promise.race([Promise.all(finishing), new Promise((resolve) => setTimeout(resolve, 10_000))]);
    store.reset();
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error(error);
  response.status(500).json({ error: error instanceof Error ? error.message : "Unexpected error" });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Juniper Salon staff app: http://localhost:${port}`));
