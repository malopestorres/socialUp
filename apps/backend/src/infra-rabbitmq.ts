import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from "amqplib";

export type JobExecutionPlatform = "instagram" | "whatsapp";

export type JobExecutionQueueMessage = {
  jobId: string;
  platform: JobExecutionPlatform;
  enqueuedAtIso: string;
};

export type JobExecutionConsumerResult = "ack" | "requeue";

const RABBITMQ_URL = (process.env.RABBITMQ_URL || "amqp://127.0.0.1:5672").trim();
const RABBITMQ_JOB_QUEUE = (process.env.RABBITMQ_JOB_QUEUE || "socialup.jobs.execute").trim();
const RABBITMQ_PREFETCH = Math.max(1, Number.parseInt(process.env.RABBITMQ_PREFETCH || "3", 10) || 3);
const RABBITMQ_LOCAL_FALLBACK_ENABLED =
  (process.env.RABBITMQ_LOCAL_FALLBACK_ENABLED || "false").trim().toLowerCase() === "true";
const RABBITMQ_LOCAL_REQUEUE_DELAY_MS = Math.max(
  1_000,
  Number.parseInt(process.env.RABBITMQ_LOCAL_REQUEUE_DELAY_MS || "5000", 10) || 5_000,
);
const RABBITMQ_CONSUMER_RECONNECT_DELAY_MS = Math.max(
  1_000,
  Number.parseInt(process.env.RABBITMQ_CONSUMER_RECONNECT_DELAY_MS || "5000", 10) || 5_000,
);

let rabbitConnection: ChannelModel | null = null;
let rabbitChannel: Channel | null = null;
let rabbitConnectingPromise: Promise<Channel> | null = null;
let rabbitConsumerHandler: ((message: JobExecutionQueueMessage) => Promise<JobExecutionConsumerResult>) | null = null;
let rabbitConsumerRegistered = false;
let rabbitConsumerRestartTimer: NodeJS.Timeout | null = null;
let rabbitConsumerRestartInFlight = false;
let localFallbackWarningPrinted = false;
let localQueueDrainRunning = false;
let localQueueHandler: ((message: JobExecutionQueueMessage) => Promise<JobExecutionConsumerResult>) | null = null;
const localQueueMessages: JobExecutionQueueMessage[] = [];

function scheduleRabbitConsumerRestart(): void {
  if (!rabbitConsumerHandler || rabbitConsumerRestartTimer) {
    return;
  }

  rabbitConsumerRestartTimer = setTimeout(() => {
    rabbitConsumerRestartTimer = null;
    if (!rabbitConsumerHandler || rabbitConsumerRestartInFlight || rabbitConsumerRegistered) {
      return;
    }

    rabbitConsumerRestartInFlight = true;
    void startJobExecutionConsumer(rabbitConsumerHandler)
      .catch((error) => {
        if (!RABBITMQ_LOCAL_FALLBACK_ENABLED) {
          console.error("RabbitMQ consumer restart failed", error);
        }
        scheduleRabbitConsumerRestart();
      })
      .finally(() => {
        rabbitConsumerRestartInFlight = false;
      });
  }, RABBITMQ_CONSUMER_RECONNECT_DELAY_MS);
}

function printLocalFallbackWarning(reason: unknown): void {
  if (!RABBITMQ_LOCAL_FALLBACK_ENABLED || localFallbackWarningPrinted) {
    return;
  }
  localFallbackWarningPrinted = true;
  console.warn(
    "RabbitMQ indisponível. Ativando fallback local em memória (apenas desenvolvimento / instância única).",
    reason,
  );
}

function enqueueLocalFallbackMessage(message: JobExecutionQueueMessage): void {
  localQueueMessages.push(message);
  void drainLocalFallbackQueue();
}

async function drainLocalFallbackQueue(): Promise<void> {
  if (localQueueDrainRunning || !localQueueHandler) {
    return;
  }

  const handler = localQueueHandler;
  localQueueDrainRunning = true;
  try {
    while (localQueueMessages.length > 0) {
      const message = localQueueMessages.shift();
      if (!message) {
        continue;
      }

      try {
        const result = await handler(message);
        if (result === "requeue") {
          setTimeout(() => {
            localQueueMessages.push(message);
            void drainLocalFallbackQueue();
          }, RABBITMQ_LOCAL_REQUEUE_DELAY_MS);
        }
      } catch (error) {
        console.error("Local fallback queue handler failed", error);
        setTimeout(() => {
          localQueueMessages.push(message);
          void drainLocalFallbackQueue();
        }, RABBITMQ_LOCAL_REQUEUE_DELAY_MS);
      }
    }
  } finally {
    localQueueDrainRunning = false;
    if (localQueueMessages.length > 0) {
      void drainLocalFallbackQueue();
    }
  }
}

async function ensureRabbitChannel(): Promise<Channel> {
  if (rabbitChannel) {
    return rabbitChannel;
  }

  if (rabbitConnectingPromise) {
    return rabbitConnectingPromise;
  }

  rabbitConnectingPromise = (async () => {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    await channel.assertQueue(RABBITMQ_JOB_QUEUE, {
      durable: true,
    });
    await channel.prefetch(RABBITMQ_PREFETCH);

    connection.on("close", () => {
      rabbitConnection = null;
      rabbitChannel = null;
      rabbitConnectingPromise = null;
      rabbitConsumerRegistered = false;
      scheduleRabbitConsumerRestart();
    });
    connection.on("error", () => {
      rabbitConnection = null;
      rabbitChannel = null;
      rabbitConnectingPromise = null;
      rabbitConsumerRegistered = false;
      scheduleRabbitConsumerRestart();
    });

    rabbitConnection = connection;
    rabbitChannel = channel;
    return channel;
  })();

  try {
    return await rabbitConnectingPromise;
  } finally {
    if (!rabbitChannel) {
      rabbitConnectingPromise = null;
    }
  }
}

function parseQueueMessage(raw: ConsumeMessage): JobExecutionQueueMessage | null {
  try {
    const parsed = JSON.parse(raw.content.toString("utf8")) as Partial<JobExecutionQueueMessage>;
    const jobId = typeof parsed.jobId === "string" ? parsed.jobId.trim() : "";
    const platform = parsed.platform;
    if (!jobId) {
      return null;
    }
    if (platform !== "instagram" && platform !== "whatsapp") {
      return null;
    }
    return {
      jobId,
      platform,
      enqueuedAtIso: typeof parsed.enqueuedAtIso === "string" ? parsed.enqueuedAtIso : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function enqueueJobExecutionMessage(input: {
  jobId: string;
  platform: JobExecutionPlatform;
}): Promise<void> {
  const payload: JobExecutionQueueMessage = {
    jobId: input.jobId,
    platform: input.platform,
    enqueuedAtIso: new Date().toISOString(),
  };

  try {
    const channel = await ensureRabbitChannel();
    channel.sendToQueue(
      RABBITMQ_JOB_QUEUE,
      Buffer.from(JSON.stringify(payload), "utf8"),
      {
        persistent: true,
      },
    );
  } catch (error) {
    if (!RABBITMQ_LOCAL_FALLBACK_ENABLED) {
      throw error;
    }
    printLocalFallbackWarning(error);
    enqueueLocalFallbackMessage(payload);
  }
}

export async function startJobExecutionConsumer(
  handler: (message: JobExecutionQueueMessage) => Promise<JobExecutionConsumerResult>,
): Promise<void> {
  rabbitConsumerHandler = handler;

  if (RABBITMQ_LOCAL_FALLBACK_ENABLED) {
    localQueueHandler = handler;
    void drainLocalFallbackQueue();
  }

  if (rabbitConsumerRegistered) {
    return;
  }

  let channel: Channel;
  try {
    channel = await ensureRabbitChannel();
  } catch (error) {
    if (!RABBITMQ_LOCAL_FALLBACK_ENABLED) {
      throw error;
    }
    printLocalFallbackWarning(error);
    scheduleRabbitConsumerRestart();
    throw error;
  }

  await channel.consume(
    RABBITMQ_JOB_QUEUE,
    async (raw: ConsumeMessage | null) => {
      if (!raw) {
        return;
      }

      const parsed = parseQueueMessage(raw);
      if (!parsed) {
        channel.ack(raw);
        return;
      }

      try {
        const result = await handler(parsed);
        if (result === "requeue") {
          channel.nack(raw, false, true);
          return;
        }
        channel.ack(raw);
      } catch (error) {
        console.error("RabbitMQ consumer handler failed", error);
        channel.nack(raw, false, true);
      }
    },
    {
      noAck: false,
    },
  );
  rabbitConsumerRegistered = true;
}

export async function closeRabbitMqInfra(): Promise<void> {
  rabbitConsumerHandler = null;
  rabbitConsumerRegistered = false;
  if (rabbitConsumerRestartTimer) {
    clearTimeout(rabbitConsumerRestartTimer);
    rabbitConsumerRestartTimer = null;
  }
  rabbitConsumerRestartInFlight = false;
  localQueueHandler = null;
  localQueueMessages.splice(0, localQueueMessages.length);

  try {
    if (rabbitChannel) {
      await rabbitChannel.close();
    }
  } catch {
    // no-op
  } finally {
    rabbitChannel = null;
  }

  try {
    if (rabbitConnection) {
      await rabbitConnection.close();
    }
  } catch {
    // no-op
  } finally {
    rabbitConnection = null;
    rabbitConnectingPromise = null;
  }
}
