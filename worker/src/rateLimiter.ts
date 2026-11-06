/**
 * Write rate limiter: at most MAX_HITS requests per WINDOW_MS per IP.
 *
 * One Durable Object instance per IP (named by the caller). A Durable Object
 * serializes its own requests, so the counter cannot race the way a KV
 * read-modify-write would (KV is only eventually consistent).
 */

const WINDOW_MS = 60 * 60 * 1000;
const MAX_HITS = 20;
const HITS_KEY = "hits";

function json(data: unknown, status: number, extra: Record<string, string> = {}): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(JSON.stringify(data), { status, headers });
}

export class RateLimiter implements DurableObject {
  private readonly storage: DurableObjectStorage;

  constructor(ctx: DurableObjectState) {
    this.storage = ctx.storage;
  }

  async fetch(_request: Request): Promise<Response> {
    const now = Date.now();
    const stored = await this.storage.get<number[]>(HITS_KEY);
    const hits = Array.isArray(stored) ? stored : [];

    // Drop everything that has left the sliding window.
    const recent = hits.filter(
      (at) => typeof at === "number" && now - at < WINDOW_MS,
    );

    if (recent.length >= MAX_HITS) {
      const oldest = recent[0] ?? now;
      const retryAfterMs = oldest + WINDOW_MS - now;
      const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
      return json({ allowed: false }, 429, {
        "Retry-After": String(retryAfter),
      });
    }

    recent.push(now);
    await this.storage.put(HITS_KEY, recent);
    // Wake up once the window has fully drained so the object can clean up
    // after itself instead of holding a list per IP forever.
    await this.storage.setAlarm(now + WINDOW_MS);

    return json({ allowed: true }, 200);
  }

  async alarm(): Promise<void> {
    await this.storage.deleteAll();
  }
}
