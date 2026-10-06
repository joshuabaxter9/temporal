import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
import { NAMESPACE, TASK_QUEUE, TEMPORAL_ADDRESS } from "./config";

async function run(): Promise<void> {
  const connection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });
  const worker = await Worker.create({
    connection,
    namespace: NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve("./workflows"),
    activities,
  });
  console.log(`Worker is polling the ${TASK_QUEUE} task queue.`);
  await worker.run();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
