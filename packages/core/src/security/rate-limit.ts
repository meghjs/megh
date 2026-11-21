/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 */
import { isIPv6 } from "node:net";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { IRequest } from "../core/types";
import { TooManyRequestsException } from "../errors/http-exceptions";
import { SKIP_GLOBAL_MIDDLEWARE } from "../observability/health";
import { internalLogger } from "../observability/internal-logger";

/** The count for one key in the current window. */
export interface RateLimitHit {
  /** Hits in the current window, including this one. */
  count: number;
  /** Epoch milliseconds when the window ends and the count starts over. */
  resetAt: number;
}

/**
 * Where hit counts live. The memory store is per process; use
 * `RedisRateLimitStore`, or your own, to share counts between replicas.
 */
export interface RateLimitStore {
  /** Count one hit for `key` in a window of `windowMs` milliseconds. */
  hit(key: string, windowMs: number): RateLimitHit | Promise<RateLimitHit>;
  /** Forget the count for `key`. */
  reset?(key: string): void | Promise<void>;
  /** Release timers or connections. Megh calls it on shutdown for stores it created. */
  close?(): void | Promise<void>;
}

/** A window: milliseconds, or a duration such as `'30s'`, `'15m'`, `'1 hour'`. */
export type RateLimitWindow = number | string;

/** The limit for one route, set with `@RateLimit()` or `.rateLimit()`. */
export interface RouteRateLimitOptions {
  /** Requests allowed per window, per client. */
  max?: number;
  /** Window length. Defaults to the app's window, else one minute. */
  window?: RateLimitWindow;
  /** How to tell clients apart. Defaults to the app's key, else `request.ip`. */
  key?: (request: IRequest) => string | Promise<string>;
}

/** Options for `app.useRateLimit()`. */
export interface RateLimitOptions extends RouteRateLimitOptions {
  /** Requests allowed per window, per client. Defaults to 100. */
  max?: number;
  /** Window length. Defaults to one minute. */
  window?: RateLimitWindow;
  /**
   * How to tell clients apart. Defaults to `request.ip`; behind a proxy, set
   * `server.trustProxy` to a hop count or the proxy's address (not `true`)
   * so that is the client's address.
   */
  key?: (request: IRequest) => string | Promise<string>;
  /**
   * With the default key, IPv6 clients are counted per network prefix of
   * this many bits, since one host usually owns a whole /64 and could rotate
   * addresses inside it. `128` counts every address on its own. IPv4 is
   * always counted per address. Defaults to `64`.
   */
  ipv6Subnet?: number;
  /** Return `true` to let a request through uncounted, e.g. an internal IP. */
  skip?: (request: IRequest) => boolean | Promise<boolean>;
  /** Where counts live. Defaults to memory. */
  store?: RateLimitStore;
  /** Shortcut for `store: new RedisRateLimitStore(redis)`, with an ioredis client. */
  redis?: RedisEvalClient;
  /** Send `RateLimit-*` headers on every limited response. Defaults to `true`. */
  headers?: boolean;
  /** The 429 message. Defaults to "Too many requests, please try again later." */
  message?: string;
  /**
   * Let requests through when the store fails (Redis is down) instead of
   * answering 500. The error is still logged. Defaults to `false`.
   */
  failOpen?: boolean;
  /**
   * Limit every route. `false` limits only routes with `@RateLimit()` or
   * `.rateLimit()`. Defaults to `true`.
   */
  global?: boolean;
}

/** Route config key holding a route's own limit, or `false` to skip limiting. */
export const RATE_LIMIT_CONFIG_KEY = "meghRateLimit";
/** Metadata key for `@RateLimit()`. */
export const RATE_LIMIT_META_KEY = "megh:rate-limit";

const DEFAULT_MAX = 100;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MESSAGE = "Too many requests, please try again later.";

const UNITS: Record<string, number> = {
  ms: 1,
  millisecond: 1,
  s: 1000,
  sec: 1000,
  second: 1000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
};

/** Milliseconds in a window given as a number or a duration string. */
export function parseWindow(window: RateLimitWindow): number {
  let ms: number;
  if (typeof window === "number") {
    ms = window;
  } else {
    const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*$/i.exec(window);
    const name = match?.[2].toLowerCase() ?? "";
    // "ms" and "s" are units; otherwise allow a plural ("minutes").
    const unit = UNITS[name] ?? UNITS[name.replace(/s$/, "")];
    ms = match && unit ? Number(match[1]) * unit : NaN;
  }
  if (!Number.isFinite(ms) || ms < 1) {
    throw new TypeError(
      `[Megh] Invalid rate limit window ${JSON.stringify(window)}. Use milliseconds or a duration such as '30s', '15m' or '1 hour'.`,
    );
  }
  return Math.round(ms);
}

function resolveIpv6Subnet(bits: number | undefined): number {
  const value = bits ?? 64;
  if (!Number.isInteger(value) || value < 1 || value > 128) {
    throw new TypeError(
      `[Megh] Rate limit ipv6Subnet must be a whole number from 1 to 128, got ${value}.`,
    );
  }
  return value;
}

function assertMax(max: number) {
  if (!Number.isInteger(max) || max < 1) {
    throw new TypeError(
      `[Megh] Rate limit max must be a whole number of at least 1, got ${max}.`,
    );
  }
}

// ─── Stores ──────────────────────────────────────────────────────────────────

/** Options for `new MemoryRateLimitStore()`. */
export interface MemoryRateLimitStoreOptions {
  /** How often expired windows are swept, in milliseconds. Defaults to 60000. */
  sweepIntervalMs?: number;
  /**
   * Most keys (clients) held at once. Past it, the oldest windows are
   * dropped first, and a warning is logged once. Defaults to 100000.
   */
  maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 100_000;

/**
 * Fixed-window counts in memory. Counts are per process and lost on
 * restart. Expired windows are swept every minute by an `unref`'d timer.
 * At most `maxKeys` clients are held, so a flood of new keys can't exhaust
 * the heap; the oldest windows are dropped first.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, RateLimitHit>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly sweepIntervalMs: number;
  private readonly maxKeys: number;
  private warnedFull = false;

  /** Pass options, or (as before) just the sweep interval in milliseconds. */
  constructor(options: MemoryRateLimitStoreOptions | number = {}) {
    const opts =
      typeof options === "number" ? { sweepIntervalMs: options } : options;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? 60_000;
    this.maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
    if (!Number.isInteger(this.maxKeys) || this.maxKeys < 1) {
      throw new TypeError(
        `[Megh] MemoryRateLimitStore maxKeys must be a whole number of at least 1, got ${this.maxKeys}.`,
      );
    }
  }

  hit(key: string, windowMs: number): RateLimitHit {
    const now = Date.now();
    let entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      // Re-insert so the Map stays ordered by window start, oldest first.
      if (entry) this.windows.delete(key);
      else if (this.windows.size >= this.maxKeys) this.evictOldest(now);
      entry = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, entry);
      this.startSweep();
    }
    entry.count++;
    return { count: entry.count, resetAt: entry.resetAt };
  }

  reset(key: string) {
    this.windows.delete(key);
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.windows.clear();
  }

  /** Make room for one key: drop the oldest window. */
  private evictOldest(now: number) {
    const oldest = this.windows.keys().next();
    if (!oldest.done) this.windows.delete(oldest.value);
    if (!this.warnedFull) {
      this.warnedFull = true;
      internalLogger("rate-limit").warn(
        { maxKeys: this.maxKeys, at: new Date(now).toISOString() },
        "[Megh] MemoryRateLimitStore is full; dropping the oldest windows. " +
          "Many distinct clients, or keys that change per request, can cause this. " +
          "Raise maxKeys or use RedisRateLimitStore.",
      );
    }
  }

  private startSweep() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.windows) {
        if (entry.resetAt <= now) this.windows.delete(key);
      }
      if (this.windows.size === 0) this.close();
    }, this.sweepIntervalMs);
    this.timer.unref();
  }
}

/** The part of an ioredis client the Redis store uses. */
export interface RedisEvalClient {
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

// Count the hit and start the window on the first one, in one round trip.
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

/**
 * Fixed-window counts in Redis, shared by every replica. Pass an ioredis
 * client; Megh does not close it.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly prefix: string;

  constructor(
    private readonly redis: RedisEvalClient,
    options: { prefix?: string } = {},
  ) {
    if (!redis || typeof redis.eval !== "function") {
      throw new TypeError(
        "[Megh] RedisRateLimitStore needs an ioredis client, e.g. new RedisRateLimitStore(new Redis()).",
      );
    }
    this.prefix = options.prefix ?? "megh:rate-limit:";
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const [count, ttl] = (await this.redis.eval(
      HIT_SCRIPT,
      1,
      this.prefix + key,
      windowMs,
    )) as [number, number];
    return { count: Number(count), resetAt: Date.now() + Number(ttl) };
  }

  async reset(key: string) {
    await this.redis.del(this.prefix + key);
  }
}

// ─── Decorator ───────────────────────────────────────────────────────────────

/**
 * Give a controller or route its own limit, in place of the app's, or pass
 * `false` to leave it unlimited. Works without `app.useRateLimit()` too.
 *
 *   @Post('/login')
 *   @RateLimit({ max: 5, window: '15m' })
 *   login() {}
 */
export function RateLimit(
  options: RouteRateLimitOptions | false,
): ClassDecorator & MethodDecorator {
  assertRouteRateLimit(options);
  return (target: object, propertyKey?: string | symbol) => {
    if (propertyKey === undefined) {
      Reflect.defineMetadata(RATE_LIMIT_META_KEY, options, target);
    } else {
      Reflect.defineMetadata(RATE_LIMIT_META_KEY, options, target, propertyKey);
    }
  };
}

/** Throw on a bad route limit when it is declared, not on its first request. */
export function assertRouteRateLimit(options: RouteRateLimitOptions | false) {
  if (options === false) return;
  if (options === null || typeof options !== "object") {
    throw new TypeError(
      "[Megh] A route rate limit is an options object, e.g. { max: 5, window: '1m' }, or false.",
    );
  }
  if (options.max !== undefined) assertMax(options.max);
  if (options.window !== undefined) parseWindow(options.window);
}

/** The `@RateLimit()` for a route: the method's, else the controller's. */
export function getDeclaredRateLimit(
  controller: Function,
  method: string,
): RouteRateLimitOptions | false | undefined {
  return (
    Reflect.getMetadata(RATE_LIMIT_META_KEY, controller.prototype, method) ??
    Reflect.getMetadata(RATE_LIMIT_META_KEY, controller)
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

type ResolvedLimit = {
  max: number;
  windowMs: number;
  key: (request: IRequest) => string | Promise<string>;
  /** Prefix that keeps a route's own counts apart from the app's. */
  scope: string;
};

/**
 * The client's network for rate limiting: IPv4 (and IPv4-mapped IPv6) per
 * address, other IPv6 per `/ipv6Subnet` prefix.
 */
export function rateLimitIpKey(ip: string, ipv6Subnet = 64): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  const address = ip.replace(/%.*$/, ""); // zone id, e.g. fe80::1%eth0
  if (!isIPv6(address) || ipv6Subnet >= 128) return ip;
  const groups = expandIPv6(address);
  const full = Math.floor(ipv6Subnet / 16);
  const rest = ipv6Subnet % 16;
  const kept = groups.slice(0, full);
  if (rest) kept.push(groups[full] & (0xffff << (16 - rest)) & 0xffff);
  while (kept.length < 8) kept.push(0);
  return `${kept.map((g) => g.toString(16)).join(":")}/${ipv6Subnet}`;
}

/** The eight 16-bit groups of a valid IPv6 address. */
function expandIPv6(address: string): number[] {
  let text = address.toLowerCase();
  // An embedded IPv4 tail ("::1.2.3.4") becomes two groups.
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text =
      text.slice(0, v4.index) +
      `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  const zeros = tail !== undefined ? 8 - left.length - right.length : 0;
  return [...left, ...Array(zeros).fill("0"), ...right].map((g) =>
    parseInt(g, 16),
  );
}

const ipKey = (ipv6Subnet: number) => (request: IRequest) =>
  rateLimitIpKey((request as unknown as FastifyRequest).ip, ipv6Subnet);

/**
 * With `trustProxy: true`, Fastify takes `request.ip` from the leftmost
 * `X-Forwarded-For` entry, which the client controls: nginx and AWS ALB
 * append to the header rather than replace it. Each spoofed value would get
 * a fresh counter, so limits keyed by IP stop nothing.
 */
function warnTrustingEveryProxy() {
  internalLogger("rate-limit").warn(
    "[Megh] Rate limiting with server.trustProxy: true. Clients can spoof X-Forwarded-For " +
      "and get a fresh counter per request. Trust a hop count or the proxy's address " +
      "instead, e.g. trustProxy: 1 or trustProxy: '10.0.0.0/8'.",
  );
}

/**
 * Count requests per client and answer 429 over the limit. Returns the
 * store, so the app can close it on shutdown when it created it.
 */
export function installRateLimit(
  app: FastifyInstance,
  options: RateLimitOptions = {},
  server: { trustProxy?: unknown } = {},
): { store: RateLimitStore; ownsStore: boolean } {
  const max = options.max ?? DEFAULT_MAX;
  assertMax(max);
  if (server.trustProxy === true) warnTrustingEveryProxy();
  const windowMs = parseWindow(options.window ?? DEFAULT_WINDOW_MS);
  const appLimit: ResolvedLimit = {
    max,
    windowMs,
    key: options.key ?? ipKey(resolveIpv6Subnet(options.ipv6Subnet)),
    scope: "",
  };
  const ownsStore = !options.store;
  const store =
    options.store ??
    (options.redis
      ? new RedisRateLimitStore(options.redis)
      : new MemoryRateLimitStore());
  const sendHeaders = options.headers ?? true;
  const message = options.message ?? DEFAULT_MESSAGE;
  const limitAll = options.global ?? true;

  // A route's own limit, resolved on its first request.
  const routeLimits = new WeakMap<object, ResolvedLimit | null>();
  const limitFor = (request: FastifyRequest): ResolvedLimit | null => {
    const config = request.routeOptions?.config as unknown as
      Record<string, unknown> | undefined;
    if (!config) return limitAll ? appLimit : null;
    let limit = routeLimits.get(config);
    if (limit !== undefined) return limit;

    const own = config[RATE_LIMIT_CONFIG_KEY] as
      RouteRateLimitOptions | false | undefined;
    if (own === false) limit = null;
    else if (own) {
      limit = {
        max: own.max ?? appLimit.max,
        windowMs:
          own.window !== undefined
            ? parseWindow(own.window)
            : appLimit.windowMs,
        key: own.key ?? appLimit.key,
        scope: `${request.method}:${request.routeOptions.url}|`,
      };
    } else if (config[SKIP_GLOBAL_MIDDLEWARE] || !limitAll) {
      // Health probes must answer even when a client is over its limit.
      limit = null;
    } else limit = appLimit;
    routeLimits.set(config, limit);
    return limit;
  };

  app.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const limit = limitFor(request);
      if (!limit) return;
      const req = request as unknown as IRequest;
      if (options.skip && (await options.skip(req))) return;

      let hit: RateLimitHit;
      try {
        const key = String(await limit.key(req));
        hit = await store.hit(limit.scope + key, limit.windowMs);
      } catch (err) {
        if (!options.failOpen) throw err;
        internalLogger("rate-limit").error(
          { err },
          "Rate limit store failed; letting the request through",
        );
        return;
      }

      const resetSeconds = Math.max(
        0,
        Math.ceil((hit.resetAt - Date.now()) / 1000),
      );
      if (sendHeaders) {
        reply.header("RateLimit-Limit", limit.max);
        reply.header("RateLimit-Remaining", Math.max(0, limit.max - hit.count));
        reply.header("RateLimit-Reset", resetSeconds);
      }
      if (hit.count > limit.max) {
        throw new TooManyRequestsException(message, {
          headers: { "Retry-After": resetSeconds },
        });
      }
    },
  );

  return { store, ownsStore };
}
