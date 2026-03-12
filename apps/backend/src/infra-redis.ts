import Redis from "ioredis";
import { randomUUID } from "node:crypto";

type LockHandle = {
  key: string;
  token: string;
  release: () => Promise<void>;
};

const REDIS_URL = (process.env.REDIS_URL || "").trim();
const REDIS_KEY_PREFIX = (process.env.REDIS_KEY_PREFIX || "socialup").trim();

const localFallbackLocks = new Map<string, { token: string; expiresAtMs: number }>();

let redisClient: Redis | null = null;
let redisConnectAttempted = false;
let redisConnectionFailed = false;

function prefixedKey(key: string): string {
  const normalized = key.trim().replace(/^:+/, "");
  if (!normalized) {
    throw new Error("REDIS_LOCK_KEY_INVALID");
  }
  return `${REDIS_KEY_PREFIX}:${normalized}`;
}

function pruneExpiredLocalLocks(nowMs = Date.now()): void {
  for (const [key, entry] of localFallbackLocks.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      localFallbackLocks.delete(key);
    }
  }
}

async function getRedisClient(): Promise<Redis | null> {
  if (!REDIS_URL) {
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

  if (redisConnectAttempted && redisConnectionFailed) {
    return null;
  }

  redisConnectAttempted = true;
  try {
    const client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      enableReadyCheck: true,
    });
    await client.connect();
    redisClient = client;
    redisConnectionFailed = false;
    return redisClient;
  } catch (error) {
    redisConnectionFailed = true;
    console.error("Redis connection failed. Falling back to in-memory locks.", error);
    if (redisClient) {
      redisClient.disconnect();
      redisClient = null;
    }
    return null;
  }
}

async function acquireLocalLock(key: string, ttlMs: number): Promise<LockHandle | null> {
  const nowMs = Date.now();
  pruneExpiredLocalLocks(nowMs);
  if (localFallbackLocks.has(key)) {
    return null;
  }
  const token = randomUUID();
  localFallbackLocks.set(key, {
    token,
    expiresAtMs: nowMs + ttlMs,
  });
  return {
    key,
    token,
    release: async () => {
      const current = localFallbackLocks.get(key);
      if (current && current.token === token) {
        localFallbackLocks.delete(key);
      }
    },
  };
}

async function releaseRedisLock(redis: Redis, lock: LockHandle): Promise<void> {
  const lua = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;
  await redis.eval(lua, 1, lock.key, lock.token);
}

export async function acquireDistributedLock(rawKey: string, ttlMs: number): Promise<LockHandle | null> {
  const key = prefixedKey(rawKey);
  const token = randomUUID();
  const normalizedTtlMs = Math.max(1_000, Math.trunc(ttlMs));
  const redis = await getRedisClient();

  if (!redis) {
    return acquireLocalLock(key, normalizedTtlMs);
  }

  try {
    const result = await redis.set(key, token, "PX", normalizedTtlMs, "NX");
    if (result !== "OK") {
      return null;
    }
    return {
      key,
      token,
      release: async () => {
        await releaseRedisLock(redis, {
          key,
          token,
          release: async () => {},
        });
      },
    };
  } catch (error) {
    console.error("Redis lock acquisition failed. Falling back to in-memory lock.", error);
    return acquireLocalLock(key, normalizedTtlMs);
  }
}

export async function isDistributedLockHeld(rawKey: string): Promise<boolean> {
  const key = prefixedKey(rawKey);
  const redis = await getRedisClient();
  if (!redis) {
    pruneExpiredLocalLocks();
    return localFallbackLocks.has(key);
  }

  try {
    const value = await redis.get(key);
    return Boolean(value);
  } catch (error) {
    console.error("Redis lock check failed. Falling back to local lock map.", error);
    pruneExpiredLocalLocks();
    return localFallbackLocks.has(key);
  }
}

export async function closeRedisInfra(): Promise<void> {
  if (!redisClient) {
    return;
  }
  try {
    await redisClient.quit();
  } catch {
    redisClient.disconnect();
  } finally {
    redisClient = null;
  }
}
