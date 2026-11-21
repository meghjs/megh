import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeghApplication } from "../core/application";
import type { MeghApplicationOptions } from "../core/interfaces";
import { LoggerService } from "../observability/logger";
import { ApiController } from "../http/controller";
import { Get, Post } from "../http/route-methods";
import { Version } from "../http/versioning";
import {
  MemoryRateLimitStore,
  RateLimit,
  RateLimitStore,
  RedisRateLimitStore,
  parseWindow,
  rateLimitIpKey,
} from "./rate-limit";

@ApiController("/rl")
class LimitedController {
  @Get("/")
  list() {
    return { ok: true };
  }

  @Post("/login")
  @RateLimit({ max: 2 })
  login() {
    return { ok: true };
  }

  @Get("/free")
  @RateLimit(false)
  free() {
    return { ok: true };
  }
}

@ApiController("/plain")
class PlainController {
  @Get("/")
  get() {
    return { ok: true };
  }
}

const apps: MeghApplication[] = [];
async function boot(
  setup: (app: MeghApplication) => void,
  controllers: any[] = [LimitedController],
  options: MeghApplicationOptions = {},
) {
  const app = MeghApplication.getInternalApp({
    autoloadPlugins: false,
    ...options,
  });
  app.useErrorLogger(false);
  app.useControllers(controllers);
  setup(app);
  apps.push(app);
  await app.run(0);
  return app;
}

const hit = (
  app: MeghApplication,
  url = "/rl",
  method: "GET" | "POST" = "GET",
  ip?: string,
) => app.app.inject({ url, method, ...(ip && { remoteAddress: ip }) });

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  vi.restoreAllMocks();
});

describe("parseWindow", () => {
  it("reads milliseconds and durations", () => {
    expect(parseWindow(500)).toBe(500);
    expect(parseWindow("250ms")).toBe(250);
    expect(parseWindow("30s")).toBe(30_000);
    expect(parseWindow("15m")).toBe(900_000);
    expect(parseWindow("1 minute")).toBe(60_000);
    expect(parseWindow("2 hours")).toBe(7_200_000);
    expect(parseWindow("1d")).toBe(86_400_000);
  });

  it("rejects nonsense", () => {
    for (const bad of ["", "soon", "5 weeks", 0, -1, NaN]) {
      expect(() => parseWindow(bad as any), String(bad)).toThrow(
        /Invalid rate limit window/,
      );
    }
  });
});

describe("useRateLimit", () => {
  it("answers 429 in Megh's error shape once a client is over the limit", async () => {
    const app = await boot((a) => a.useRateLimit({ max: 2, window: "1m" }));
    const first = await hit(app);
    expect(first.statusCode).toBe(200);
    expect(first.headers["ratelimit-limit"]).toBe("2");
    expect(first.headers["ratelimit-remaining"]).toBe("1");
    expect(Number(first.headers["ratelimit-reset"])).toBeGreaterThan(0);

    expect((await hit(app)).headers["ratelimit-remaining"]).toBe("0");

    const blocked = await hit(app);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({
      code: 429,
      status: "Error",
      message: "Too many requests, please try again later.",
    });
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("counts each client separately", async () => {
    const app = await boot((a) => a.useRateLimit({ max: 1 }));
    expect((await hit(app, "/rl", "GET", "10.0.0.1")).statusCode).toBe(200);
    expect((await hit(app, "/rl", "GET", "10.0.0.1")).statusCode).toBe(429);
    expect((await hit(app, "/rl", "GET", "10.0.0.2")).statusCode).toBe(200);
  });

  it("starts over when the window ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const app = await boot((a) => a.useRateLimit({ max: 1, window: "1s" }));
      expect((await hit(app)).statusCode).toBe(200);
      expect((await hit(app)).statusCode).toBe(429);
      vi.setSystemTime(Date.now() + 1001);
      expect((await hit(app)).statusCode).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a route's own limit and separate counter", async () => {
    const app = await boot((a) => a.useRateLimit({ max: 100 }));
    expect(
      (await hit(app, "/rl/login", "POST")).headers["ratelimit-limit"],
    ).toBe("2");
    await hit(app, "/rl/login", "POST");
    expect((await hit(app, "/rl/login", "POST")).statusCode).toBe(429);
    // The app-wide counter is untouched by the login route.
    expect((await hit(app)).headers["ratelimit-remaining"]).toBe("99");
  });

  it("leaves @RateLimit(false) routes unlimited", async () => {
    const app = await boot((a) => a.useRateLimit({ max: 1 }));
    for (let i = 0; i < 3; i++) {
      const res = await hit(app, "/rl/free");
      expect(res.statusCode).toBe(200);
      expect(res.headers["ratelimit-limit"]).toBeUndefined();
    }
  });

  it("does not limit health probes", async () => {
    const app = await boot((a) => a.useHealth().useRateLimit({ max: 1 }));
    for (let i = 0; i < 3; i++) {
      expect((await hit(app, "/health")).statusCode).toBe(200);
    }
  });

  it("limits unknown routes too, so scanning counts", async () => {
    const app = await boot((a) => a.useRateLimit({ max: 1 }));
    expect((await hit(app, "/nope")).statusCode).toBe(404);
    expect((await hit(app, "/nope")).statusCode).toBe(429);
  });

  it("supports key, skip, message and headers: false", async () => {
    const app = await boot((a) =>
      a.useRateLimit({
        max: 1,
        key: (req) => String(req.headers["x-api-key"] ?? "anon"),
        skip: (req) => req.headers["x-internal"] === "1",
        message: "Slow down",
        headers: false,
      }),
    );
    const as = (key: string, internal = false) =>
      app.app.inject({
        url: "/rl",
        headers: { "x-api-key": key, ...(internal && { "x-internal": "1" }) },
      });
    const ok = await as("a");
    expect(ok.headers["ratelimit-limit"]).toBeUndefined();
    const blocked = await as("a");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().message).toBe("Slow down");
    expect((await as("b")).statusCode).toBe(200);
    expect((await as("a", true)).statusCode).toBe(200);
  });

  it("answers 500 when the store fails, or lets requests through with failOpen", async () => {
    const broken: RateLimitStore = {
      hit: () => {
        throw new Error("redis down");
      },
    };
    const strict = await boot((a) => a.useRateLimit({ store: broken }));
    expect((await hit(strict)).statusCode).toBe(500);
    await strict.close();

    const open = await boot((a) =>
      a.useRateLimit({ store: broken, failOpen: true }),
    );
    expect((await hit(open)).statusCode).toBe(200);
  });

  it("limits only decorated routes with global: false", async () => {
    const app = await boot((a) => a.useRateLimit({ max: 1, global: false }));
    expect((await hit(app)).statusCode).toBe(200);
    expect((await hit(app)).statusCode).toBe(200);
    await hit(app, "/rl/login", "POST");
    await hit(app, "/rl/login", "POST");
    expect((await hit(app, "/rl/login", "POST")).statusCode).toBe(429);
  });

  it("applies @RateLimit routes without useRateLimit()", async () => {
    const app = await boot(() => {});
    expect((await hit(app)).headers["ratelimit-limit"]).toBeUndefined();
    await hit(app, "/rl/login", "POST");
    await hit(app, "/rl/login", "POST");
    expect((await hit(app, "/rl/login", "POST")).statusCode).toBe(429);
  });

  it("adds no hook when nothing is limited", async () => {
    const app = await boot(() => {}, [PlainController]);
    expect(
      (await hit(app, "/plain")).headers["ratelimit-limit"],
    ).toBeUndefined();
  });

  it("limits inline routes with .rateLimit()", async () => {
    const app = await boot((a) => {
      a.mapGet("/inline", () => ({ ok: true })).rateLimit({ max: 1 });
    }, []);
    expect((await hit(app, "/inline")).statusCode).toBe(200);
    expect((await hit(app, "/inline")).statusCode).toBe(429);
  });

  it("rejects bad limits when they are declared", () => {
    expect(() => RateLimit({ max: 0 })).toThrow(/max/);
    expect(() => RateLimit({ window: "soon" })).toThrow(/window/);
    const app = MeghApplication.getInternalApp({ autoloadPlugins: false });
    expect(() => app.mapGet("/x", () => 1).rateLimit({ max: 1.5 })).toThrow(
      /max/,
    );
  });

  it("closes the store it created on shutdown", async () => {
    const close = vi.spyOn(MemoryRateLimitStore.prototype, "close");
    const app = await boot((a) => a.useRateLimit());
    await hit(app);
    await app.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("rate limiting behind a proxy (#133)", () => {
  // nginx and AWS ALB append the real client to X-Forwarded-For, so the
  // leftmost entry is whatever the client sent.
  const spoofed = (app: MeghApplication, fake: string) =>
    app.app.inject({
      url: "/rl/login",
      method: "POST",
      remoteAddress: "10.0.0.1",
      headers: { "x-forwarded-for": `${fake}, 203.0.113.9` },
    });

  it("still limits a client that spoofs X-Forwarded-For with trustProxy: 1", async () => {
    const app = await boot(() => {}, [LimitedController], {
      server: { trustProxy: 1 },
    });
    expect((await spoofed(app, "1.1.1.1")).statusCode).toBe(200);
    expect((await spoofed(app, "2.2.2.2")).statusCode).toBe(200);
    expect((await spoofed(app, "3.3.3.3")).statusCode).toBe(429);
  });

  it("warns at boot when trustProxy is true", async () => {
    const warn = vi.fn();
    vi.spyOn(LoggerService, "child").mockReturnValue({
      warn,
      error: () => {},
      info: () => {},
      debug: () => {},
    } as any);
    await boot(() => {}, [LimitedController], { server: { trustProxy: true } });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("trustProxy: true"),
    );
  });

  it("does not warn for a hop count", async () => {
    const warn = vi.fn();
    vi.spyOn(LoggerService, "child").mockReturnValue({
      warn,
      error: () => {},
      info: () => {},
      debug: () => {},
    } as any);
    await boot(() => {}, [LimitedController], { server: { trustProxy: 1 } });
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("trustProxy"),
    );
  });
});

describe("MemoryRateLimitStore size cap (#135)", () => {
  const quietLogger = () => {
    const warn = vi.fn();
    vi.spyOn(LoggerService, "child").mockReturnValue({
      warn,
      error: () => {},
      info: () => {},
      debug: () => {},
    } as any);
    return warn;
  };

  it("holds at most maxKeys and drops the oldest window first", () => {
    quietLogger();
    const store = new MemoryRateLimitStore({ maxKeys: 2 });
    store.hit("a", 60_000);
    store.hit("a", 60_000);
    store.hit("b", 60_000);
    store.hit("c", 60_000); // evicts "a"
    expect(store.hit("b", 60_000).count).toBe(2); // kept
    expect(store.hit("c", 60_000).count).toBe(2); // kept
    expect(store.hit("a", 60_000).count).toBe(1); // started over
    store.close();
  });

  it("doesn't grow past the cap under a flood of random keys", () => {
    quietLogger();
    const store = new MemoryRateLimitStore({ maxKeys: 100 });
    for (let i = 0; i < 10_000; i++) store.hit(`k${i}`, 86_400_000);
    expect((store as any).windows.size).toBe(100);
    store.close();
  });

  it("warns once when full", () => {
    const warn = quietLogger();
    const store = new MemoryRateLimitStore({ maxKeys: 1 });
    for (let i = 0; i < 5; i++) store.hit(`k${i}`, 60_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toMatch(/MemoryRateLimitStore is full/);
    store.close();
  });

  it("still accepts a bare sweep interval and rejects a bad cap", () => {
    expect(() => new MemoryRateLimitStore(1000).close()).not.toThrow();
    expect(() => new MemoryRateLimitStore({ maxKeys: 0 })).toThrow(/maxKeys/);
  });
});

describe("IPv6 grouping (#135)", () => {
  it("keys IPv6 by its /64 and keeps IPv4 per address", () => {
    expect(rateLimitIpKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(
      "2001:db8:1:2:0:0:0:0/64",
    );
    expect(rateLimitIpKey("2001:db8:1:2::ffff")).toBe(
      rateLimitIpKey("2001:db8:1:2:1234::1"),
    );
    expect(rateLimitIpKey("2001:db8:1:3::1")).not.toBe(
      rateLimitIpKey("2001:db8:1:2::1"),
    );
    expect(rateLimitIpKey("203.0.113.9")).toBe("203.0.113.9");
    expect(rateLimitIpKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(rateLimitIpKey("fe80::1%eth0")).toBe("fe80:0:0:0:0:0:0:0/64");
  });

  it("is exported from the package root", async () => {
    const core = await import("../index");
    expect(core.rateLimitIpKey).toBe(rateLimitIpKey);
  });

  it("supports other prefix lengths", () => {
    expect(rateLimitIpKey("2001:db8:abcd:12ff::1", 56)).toBe(
      "2001:db8:abcd:1200:0:0:0:0/56",
    );
    expect(rateLimitIpKey("2001:db8::1", 128)).toBe("2001:db8::1");
    expect(rateLimitIpKey("::1.2.3.4", 112)).toBe("0:0:0:0:0:0:102:0/112");
  });

  it("counts addresses in one /64 as one client", async () => {
    const app = await boot(() => {});
    const a = (ip: string) => hit(app, "/rl/login", "POST", ip);
    expect((await a("2001:db8::1")).statusCode).toBe(200);
    expect((await a("2001:db8::2")).statusCode).toBe(200);
    expect((await a("2001:db8::3")).statusCode).toBe(429);
    expect((await a("2001:db8:0:1::1")).statusCode).toBe(200);
  });

  it("rejects a bad ipv6Subnet", async () => {
    await expect(
      boot((a) => a.useRateLimit({ ipv6Subnet: 0 })),
    ).rejects.toThrow(/ipv6Subnet/);
  });
});

describe("rate limits with URI versioning (#136)", () => {
  @ApiController("/auth")
  class VersionedController {
    @Version(["1", "2"])
    @RateLimit({ max: 2 })
    @Post("/login")
    login() {
      return { ok: true };
    }

    @Version(["1", "2"])
    @RateLimit({ max: 2 })
    @Post("/other")
    other() {
      return { ok: true };
    }
  }

  const versioned = () =>
    boot((a) => a.useVersioning({ type: "uri" }), [VersionedController]);
  const post = (app: MeghApplication, url: string) =>
    hit(app, url, "POST", "198.51.100.7");

  it("shares one counter across the versions of a handler", async () => {
    const app = await versioned();
    expect((await post(app, "/v1/auth/login")).statusCode).toBe(200);
    expect((await post(app, "/v2/auth/login")).statusCode).toBe(200);
    expect((await post(app, "/v1/auth/login")).statusCode).toBe(429);
    expect((await post(app, "/v2/auth/login")).statusCode).toBe(429);
  });

  it("keeps different handlers apart", async () => {
    const app = await versioned();
    await post(app, "/v1/auth/login");
    await post(app, "/v2/auth/login");
    expect((await post(app, "/v1/auth/other")).statusCode).toBe(200);
  });

  it("keeps the same handler in two apps apart", async () => {
    const one = await versioned();
    const two = await versioned();
    await post(one, "/v1/auth/login");
    await post(one, "/v1/auth/login");
    expect((await post(two, "/v1/auth/login")).statusCode).toBe(200);
  });
});

describe("RedisRateLimitStore", () => {
  it("counts with one script call per hit and resets with DEL", async () => {
    const counts = new Map<string, number>();
    const redis = {
      eval: vi.fn(
        async (_script: string, _n: number, key: string, windowMs: number) => {
          counts.set(key, (counts.get(key) ?? 0) + 1);
          return [counts.get(key), windowMs - 10];
        },
      ),
      del: vi.fn(async (key: string) => counts.delete(key)),
    };
    const store = new RedisRateLimitStore(redis, { prefix: "t:" });
    expect((await store.hit("ip", 1000)).count).toBe(1);
    const second = await store.hit("ip", 1000);
    expect(second.count).toBe(2);
    expect(second.resetAt).toBeGreaterThan(Date.now());
    expect(redis.eval.mock.calls[0][2]).toBe("t:ip");
    await store.reset("ip");
    expect(redis.del).toHaveBeenCalledWith("t:ip");
  });

  it("needs a client", () => {
    expect(() => new RedisRateLimitStore(undefined as any)).toThrow(/ioredis/);
  });
});
