import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeghApplication } from "../core/application";
import { ApiController } from "../http/controller";
import { Get } from "../http/route-methods";
import { Authorized, Public } from "../http/middleware";
import { AppService } from "../common/decorators";
import { MeghAuthentication } from "./authentication";
import { LoggerService } from "../observability/logger";
import type { IRequest } from "../core/types";
import type { UseAuthorizationOptions } from "../http/middleware";

@AppService
class HeaderAuthentication extends MeghAuthentication {
  authenticate(req: IRequest) {
    const name = req.headers["x-user"];
    return name ? { name, role: req.headers["x-role"] } : null;
  }
}

/** Allows signed-in users; with `{ role }`, only that role. */
@AppService
class RoleAuthorization {
  authorize(req: IRequest, options?: { role?: string }) {
    const user = (req as any).user;
    if (!user) return false;
    return !options?.role || user.role === options.role;
  }
}

@AppService
class AdminOnly {
  authorize(req: IRequest) {
    return (req as any).user?.role === "admin";
  }
}

@ApiController("/items")
class ItemsController {
  @Get("/")
  list() {
    return { ok: "list" };
  }

  @Public()
  @Get("/open")
  open() {
    return { ok: "open" };
  }

  @Authorized({ role: "admin" })
  @Get("/admin")
  admin() {
    return { ok: "admin" };
  }
}

@Public()
@ApiController("/status")
class StatusController {
  @Get("/")
  status() {
    return { ok: "status" };
  }
}

const apps: MeghApplication[] = [];
let warn: ReturnType<typeof vi.fn>;

async function boot(
  options?: UseAuthorizationOptions,
  setup: (app: MeghApplication) => void = () => {},
  authorization: any = RoleAuthorization,
) {
  const app = MeghApplication.getInternalApp({ autoloadPlugins: false });
  app.useErrorLogger(false);
  app.useAuthentication(HeaderAuthentication);
  app.useAuthorization(authorization, options);
  app.useControllers([ItemsController, StatusController]);
  setup(app);
  apps.push(app);
  await app.run(0);
  return app;
}

const get = (app: MeghApplication, url: string, user?: string, role?: string) =>
  app.inject({
    url,
    headers: {
      ...(user && { "x-user": user }),
      ...(role && { "x-role": role }),
    },
  });

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  warn = vi.fn();
  vi.spyOn(LoggerService, "child").mockReturnValue({
    warn,
    error: () => {},
    info: () => {},
    debug: () => {},
  } as any);
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  vi.restoreAllMocks();
});

describe("deny-by-default authorization (#142)", () => {
  it("leaves routes without @Authorized public when no default is set", async () => {
    const app = await boot();
    expect((await get(app, "/items")).statusCode).toBe(200);
  });

  it("'authenticated' requires a user on every unmarked route", async () => {
    const app = await boot({ default: "authenticated" });
    expect((await get(app, "/items")).statusCode).toBe(401);
    expect((await get(app, "/items", "ann")).json()).toEqual({ ok: "list" });
  });

  it("@Public() on a route or controller skips the default", async () => {
    const app = await boot({ default: "authenticated" });
    expect((await get(app, "/items/open")).statusCode).toBe(200);
    expect((await get(app, "/status")).statusCode).toBe(200);
  });

  it("keeps an explicit @Authorized over the default", async () => {
    const app = await boot({ default: "authenticated" });
    expect((await get(app, "/items/admin", "ann")).statusCode).toBe(403);
    expect((await get(app, "/items/admin", "ann", "admin")).statusCode).toBe(
      200,
    );
  });

  it("true runs the default authorizer, like a bare @Authorized()", async () => {
    const app = await boot({ default: true });
    expect((await get(app, "/items")).statusCode).toBe(403);
    expect((await get(app, "/items", "ann")).statusCode).toBe(200);
  });

  it("a name picks a named authorizer, with options", async () => {
    const app = await boot({ default: "admin" }, () => {}, {
      user: RoleAuthorization,
      admin: AdminOnly,
    });
    expect((await get(app, "/items", "ann")).statusCode).toBe(403);
    expect((await get(app, "/items", "ann", "admin")).statusCode).toBe(200);
    // { name, ...options } form
    const app2 = await boot({ default: { role: "editor" } });
    expect((await get(app2, "/items", "ann")).statusCode).toBe(403);
    expect((await get(app2, "/items", "ann", "editor")).statusCode).toBe(200);
  });

  it("applies to inline routes, with .public() to opt out", async () => {
    const app = await boot({ default: "authenticated" }, (a) => {
      a.mapGet("/inline", () => ({ ok: "inline" }));
      a.mapGet("/inline-open", () => ({ ok: "open" })).public();
    });
    expect((await get(app, "/inline")).statusCode).toBe(401);
    expect((await get(app, "/inline", "ann")).statusCode).toBe(200);
    expect((await get(app, "/inline-open")).statusCode).toBe(200);
  });

  it("documents protected routes in OpenAPI", async () => {
    const app = await boot({ default: "authenticated" }, (a) =>
      a.useOpenApi({ provider: "default" } as any),
    );
    const spec = (await app.inject({ url: "/swagger/json" })).json();
    const responses = (path: string) =>
      Object.keys(spec.paths[path].get.responses);
    expect(responses("/items")).toContain("401");
    expect(responses("/items/open")).not.toContain("401");
  });

  it("warns when a route is both @Public and @Authorized", async () => {
    @Public()
    @ApiController("/mixed")
    class MixedController {
      @Authorized()
      @Get("/")
      get() {
        return { ok: true };
      }
    }
    const app = MeghApplication.getInternalApp({ autoloadPlugins: false });
    app.useErrorLogger(false);
    app.useAuthorization(RoleAuthorization, { default: "authenticated" });
    app.useControllers([MixedController]);
    apps.push(app);
    await app.run(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/GET \/mixed.*both public and authorized/),
    );
    // @Authorized wins: still protected.
    expect((await get(app, "/mixed")).statusCode).toBe(403);
  });
});
