import "reflect-metadata";
import { Writable } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeghApplication } from "../core/application";
import { ApiController } from "../http/controller";
import { Get } from "../http/route-methods";
import { AppService } from "../common/decorators";
import { LoggerService } from "./logger";
import { getRequestId } from "./request-context";
import { HealthRegistry } from "./health";
import { AppMiddleware, MeghMiddleware } from "../http/middleware";
import { UnauthorizedException } from "../errors/http-exceptions";
import { IRequest } from "../core/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

@AppService
class AuditService {
  /** Reads the request ID deep in a service, without it being passed in. */
  async currentId() {
    await new Promise((r) => setTimeout(r, 1));
    return getRequestId();
  }
}

@ApiController("/rid")
class RequestIdController {
  constructor(private audit: AuditService) {}

  @Get("/")
  async get() {
    return { id: await this.audit.currentId() };
  }

  @Get("/log")
  log() {
    new LoggerService().info("inside request");
    return { ok: true };
  }
}

@AppMiddleware
class RequireApiKey extends MeghMiddleware {
  async invoke(req: IRequest): Promise<IRequest> {
    if (req.headers["x-api-key"] !== "k")
      throw new UnauthorizedException("key");
    return req;
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const apps: MeghApplication[] = [];
async function boot(
  setup: (app: MeghApplication) => void = () => {},
  options: Parameters<typeof MeghApplication.getInternalApp>[0] = {},
) {
  const app = MeghApplication.getInternalApp({
    autoloadPlugins: false,
    ...options,
  });
  app.useErrorLogger(false);
  setup(app);
  apps.push(app);
  await app.run(0);
  return app;
}

const savedEnv = process.env.NODE_ENV;
beforeEach(() => {
  process.env.NODE_ENV = "production";
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  process.env.NODE_ENV = savedEnv;
  vi.restoreAllMocks();
});

// ─── Request IDs ─────────────────────────────────────────────────────────────

describe("request IDs", () => {
  it("generates a UUID, echoes it, and exposes it to services", async () => {
    const app = await boot((a) => a.useControllers([RequestIdController]));
    const res = await app.inject({ url: "/rid" });
    const id = res.headers["x-request-id"];
    expect(id).toMatch(UUID);
    expect(res.json()).toEqual({ id });
  });

  it("reuses a safe incoming x-request-id", async () => {
    const app = await boot((a) => a.useControllers([RequestIdController]));
    const res = await app.inject({
      url: "/rid",
      headers: { "x-request-id": "edge-42.abc:1" },
    });
    expect(res.headers["x-request-id"]).toBe("edge-42.abc:1");
    expect(res.json()).toEqual({ id: "edge-42.abc:1" });
  });

  it("replaces an unsafe or oversized incoming ID", async () => {
    const app = await boot((a) => a.useControllers([RequestIdController]));
    for (const bad of ["has space", "<script>", "x".repeat(129)]) {
      const res = await app.inject({
        url: "/rid",
        headers: { "x-request-id": bad },
      });
      expect(res.headers["x-request-id"], bad).toMatch(UUID);
    }
  });

  it("gives concurrent requests their own IDs", async () => {
    const app = await boot((a) => a.useControllers([RequestIdController]));
    const results = await Promise.all(
      ["a1", "b2", "c3"].map((id) =>
        app.inject({ url: "/rid", headers: { "x-request-id": id } }),
      ),
    );
    expect(results.map((r) => r.json().id)).toEqual(["a1", "b2", "c3"]);
  });

  it("is undefined outside a request", () => {
    expect(getRequestId()).toBeUndefined();
  });

  it("adds reqId to log lines written during the request", async () => {
    const lines: any[] = [];
    const destination = new Writable({
      write(chunk, _enc, cb) {
        lines.push(JSON.parse(chunk.toString()));
        cb();
      },
    });
    LoggerService.configure({ pretty: false, destination });
    try {
      const app = await boot((a) => a.useControllers([RequestIdController]));
      await app.inject({
        url: "/rid/log",
        headers: { "x-request-id": "log-1" },
      });
      const line = lines.find((l) => l.msg === "inside request");
      expect(line).toMatchObject({ reqId: "log-1" });
    } finally {
      LoggerService.configure();
    }
  });

  it("honours a custom header and generator", async () => {
    const app = await boot((a) => a.useControllers([RequestIdController]), {
      requestId: { header: "x-correlation-id", generate: () => "gen-1" },
    });
    const res = await app.inject({ url: "/rid" });
    expect(res.headers["x-correlation-id"]).toBe("gen-1");
    expect(res.headers["x-request-id"]).toBeUndefined();

    const passed = await app.inject({
      url: "/rid",
      headers: { "x-correlation-id": "corr-9" },
    });
    expect(passed.json()).toEqual({ id: "corr-9" });
  });

  it("can be turned off", async () => {
    const app = await boot((a) => a.useControllers([RequestIdController]), {
      requestId: false,
    });
    const res = await app.inject({ url: "/rid" });
    expect(res.headers["x-request-id"]).toBeUndefined();
    expect(res.json()).toEqual({});
  });
});

// ─── Health ──────────────────────────────────────────────────────────────────

describe("health routes", () => {
  it("answers /health with 200 and /ready with every check", async () => {
    const app = await boot((a) =>
      a
        .useHealth({ checks: { cache: () => true } })
        .addHealthCheck("queue", async () => {}),
    );
    const live = await app.inject({ url: "/health" });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "ok" });

    const ready = await app.inject({ url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      status: "ok",
      checks: { cache: { status: "up" }, queue: { status: "up" } },
    });
  });

  it("answers 503 when a check fails, hiding the reason in production", async () => {
    const app = await boot((a) =>
      a.useHealth({
        checks: {
          ok: () => {},
          broken: () => {
            throw new Error("redis://secret@10.0.0.9 refused");
          },
          no: () => false,
        },
      }),
    );
    const res = await app.inject({ url: "/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: "error",
      checks: {
        ok: { status: "up" },
        broken: { status: "down" },
        no: { status: "down" },
      },
    });
    expect(res.body).not.toContain("secret");
  });

  it("shows the reason in development", async () => {
    process.env.NODE_ENV = "development";
    const app = await boot((a) =>
      a.useHealth({
        checks: {
          broken: () => Promise.reject(new Error("connection refused")),
        },
      }),
    );
    const res = await app.inject({ url: "/ready" });
    expect(res.json().checks.broken.error).toBe("connection refused");
  });

  it("counts a slow check as down", async () => {
    const app = await boot((a) =>
      a.useHealth({
        timeout: 20,
        checks: { slow: () => new Promise(() => {}) },
      }),
    );
    const res = await app.inject({ url: "/ready" });
    expect(res.statusCode).toBe(503);
  });

  it("uses custom paths and is hidden from route-level auth", async () => {
    const app = await boot((a) =>
      a.useHealth({ path: "/livez", readyPath: "/readyz" }),
    );
    expect((await app.inject({ url: "/livez" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/readyz" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/health" })).statusCode).toBe(404);
  });

  it("skips global middleware, so probes pass an API key check", async () => {
    const app = await boot((a) =>
      a
        .useMiddlewares([RequireApiKey])
        .useControllers([RequestIdController])
        .useHealth(),
    );
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/ready" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/rid" })).statusCode).toBe(401);
  });

  it("reports the Megh ORM database", async () => {
    const app = await boot((a) =>
      a.useMeghORM({ dialect: "sqlite", database: ":memory:" }).useHealth(),
    );
    const res = await app.inject({ url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json().checks.database.status).toBe("up");
  });

  it("rejects duplicate and non-function checks", () => {
    const registry = new HealthRegistry();
    registry.add("db", () => {});
    expect(() => registry.add("db", () => {})).toThrow(/already registered/);
    expect(() => registry.add("x", 1 as any)).toThrow(/must be a function/);
  });

  it("must be turned on before run()", async () => {
    const app = await boot();
    expect(() => app.useHealth()).toThrow(/before run/);
  });
});
