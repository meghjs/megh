import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeghApplication } from "../core/application";
import type { IRequest } from "../core/types";
import { AppService } from "../common/decorators";
import { MeghAuthentication } from "../security/authentication";
import {
  EventDispatcher,
  EventQueue,
  EventRegistry,
  MeghEvent,
} from "../events/event-registry";
import {
  createContextKey,
  getRequestId,
  requestContext,
} from "./request-context";

const TENANT = createContextKey<string>("tenant");
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A service deep in the call chain, with no access to `req`. */
class TenantService {
  async current() {
    await tick(5);
    return { tenant: requestContext.get(TENANT), id: requestContext.requestId };
  }
}

@AppService
class HeaderAuthentication extends MeghAuthentication {
  authenticate(req: IRequest) {
    const name = req.headers["x-user"];
    return name ? { name } : null;
  }
}

const apps: MeghApplication[] = [];
async function boot(
  setup: (app: MeghApplication) => void,
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

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  EventRegistry.getInstance().clear();
  EventQueue.getInstance().clear();
  vi.restoreAllMocks();
});

describe("requestContext (#141)", () => {
  const tenantApp = (options = {}) =>
    boot((app) => {
      const service = new TenantService();
      app.mapGet("/tenant", async (req: IRequest) => {
        requestContext.set(TENANT, String(req.headers["x-tenant"]));
        return service.current();
      });
    }, options);

  it("carries a value set in the request to a service, across awaits", async () => {
    const app = await tenantApp();
    const res = await app.inject({
      url: "/tenant",
      headers: { "x-tenant": "acme", "x-request-id": "req-1" },
    });
    expect(res.json()).toEqual({ tenant: "acme", id: "req-1" });
  });

  it("keeps concurrent requests apart", async () => {
    const app = await tenantApp();
    const tenants = ["a", "b", "c", "d", "e"];
    const results = await Promise.all(
      tenants.map((t) =>
        app.inject({ url: "/tenant", headers: { "x-tenant": t } }),
      ),
    );
    expect(results.map((r) => r.json().tenant)).toEqual(tenants);
  });

  it("works with request IDs turned off", async () => {
    const app = await tenantApp({ requestId: false });
    const res = await app.inject({
      url: "/tenant",
      headers: { "x-tenant": "acme" },
    });
    expect(res.json()).toEqual({ tenant: "acme" });
    expect(res.headers["x-request-id"]).toBeUndefined();
  });

  it("exposes the authenticated user", async () => {
    const app = await boot((a) => {
      a.useAuthentication(HeaderAuthentication);
      a.mapGet("/me", async () => {
        await tick();
        return {
          user: requestContext.user ?? null,
          typed: requestContext.getUser<{ name: string }>()?.name ?? null,
        };
      });
    });
    const signedIn = await app.inject({
      url: "/me",
      headers: { "x-user": "ann" },
    });
    expect(signedIn.json()).toEqual({ user: { name: "ann" }, typed: "ann" });
    const anonymous = await app.inject({ url: "/me" });
    expect(anonymous.json()).toEqual({ user: null, typed: null });
  });

  it("is empty outside a request: get is undefined, set and getOrThrow throw", () => {
    expect(requestContext.active).toBe(false);
    expect(requestContext.get(TENANT)).toBeUndefined();
    expect(requestContext.has(TENANT)).toBe(false);
    expect(requestContext.user).toBeUndefined();
    expect(() => requestContext.set(TENANT, "x")).toThrow(
      /outside a request.*requestContext\.run/,
    );
    expect(() => requestContext.getOrThrow(TENANT)).toThrow(
      /outside a request/,
    );
  });

  it("runs code in a fresh context with run()", () => {
    const result = requestContext.run(
      () => {
        requestContext.set("extra", 1);
        return {
          tenant: requestContext.getOrThrow(TENANT),
          extra: requestContext.get<number>("extra"),
          user: requestContext.user,
          id: getRequestId(),
        };
      },
      { requestId: "job-7", user: { id: 1 }, values: [[TENANT, "acme"]] },
    );
    expect(result).toEqual({
      tenant: "acme",
      extra: 1,
      user: { id: 1 },
      id: "job-7",
    });
    expect(requestContext.active).toBe(false);
  });

  it("throws from getOrThrow when a value isn't set", () => {
    requestContext.run(() => {
      expect(() => requestContext.getOrThrow(TENANT)).toThrow(
        /no value for "tenant"/,
      );
    });
  });

  it("treats two keys with the same name as different keys", () => {
    const other = createContextKey<string>("tenant");
    requestContext.run(() => {
      requestContext.set(TENANT, "a");
      expect(requestContext.get(other)).toBeUndefined();
    });
  });
});

describe("queued events keep the context they were dispatched in (#141)", () => {
  class TenantEvent extends MeghEvent<null> {}

  it("runs each queued listener in its own dispatcher's context", async () => {
    const seen: Array<string | undefined> = [];
    EventRegistry.getInstance().register(TenantEvent, {
      handler: () => {
        seen.push(requestContext.get(TENANT));
      },
    });
    const dispatcher = new EventDispatcher();
    // Both are queued before the queue starts its loop, which used to run
    // every job in the context of the first.
    await Promise.all(
      ["a", "b", "c"].map((tenant) =>
        requestContext.run(
          () => dispatcher.dispatch(new TenantEvent(null), { queue: true }),
          { values: [[TENANT, tenant]] },
        ),
      ),
    );
    await EventQueue.getInstance().whenIdle();
    expect(seen).toEqual(["a", "b", "c"]);
  });
});
