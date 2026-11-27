import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeghApplication } from "./application";
import { ApiController, MeghRequest } from "../http/controller";
import { Get } from "../http/route-methods";
import {
  AppMiddleware,
  Authorized,
  MeghMiddleware,
  UseMiddleware,
} from "../http/middleware";
import { AppService } from "../common/decorators";
import { MeghAuthentication } from "../security/authentication";
import { Results } from "../http/results";
import { ConflictException } from "../errors/http-exceptions";
import { IRequest } from "./types";

// Every stage appends to `req.trail`, so a test can read the order back.
const mark = (req: any, step: string) => {
  req.trail = [...(req.trail ?? []), step];
};

@AppMiddleware
class GlobalMw extends MeghMiddleware {
  async invoke(req: IRequest) {
    mark(req, "global");
    return req;
  }
}

@AppMiddleware
class ClassMw extends MeghMiddleware {
  async invoke(req: IRequest) {
    mark(req, `class(user=${!!(req as any).user})`);
    return req;
  }
}

@AppMiddleware
class RouteMw extends MeghMiddleware {
  async invoke(req: IRequest) {
    mark(req, "route");
    return req;
  }
}

@AppService
class Prefix {
  value = "svc";
}

/** Uses `this` and DI, which an unbound `invoke` would break. */
@AppMiddleware
class InjectedMw extends MeghMiddleware {
  constructor(private prefix: Prefix) {
    super();
  }
  async invoke(req: IRequest) {
    mark(req, `injected:${this.prefix.value}`);
    return req;
  }
}

/** Returns nothing: the pipeline should keep the request it had. */
class SilentMw extends MeghMiddleware {
  async invoke(req: IRequest): Promise<any> {
    mark(req, "silent");
  }
}

@AppService
class HeaderAuthentication extends MeghAuthentication {
  async authenticate(req: IRequest) {
    mark(req, "authn");
    const name = req.headers["x-user"];
    return name ? { name } : null;
  }
}

@AppService
class RequireUser {
  authorize(req: IRequest) {
    mark(req, "authz");
    return (req as any).user ? req : false;
  }
}

@UseMiddleware(ClassMw)
@ApiController("/ordered")
class OrderedController {
  @UseMiddleware(RouteMw)
  @Authorized()
  @Get("/")
  get(@MeghRequest() req: IRequest) {
    mark(req, "handler");
    return { trail: (req as any).trail };
  }
}

const apps: MeghApplication[] = [];

async function boot(setup: (app: MeghApplication) => void) {
  const app = MeghApplication.getInternalApp();
  app.useErrorLogger(false);
  app.useAuthentication(HeaderAuthentication);
  app.useAuthorization(RequireUser);
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
  vi.restoreAllMocks();
});

describe("controller pipeline order", () => {
  it("runs middleware, then authentication, then @Authorized", async () => {
    const app = await boot((a) =>
      a.useMiddlewares([GlobalMw]).useControllers([OrderedController]),
    );
    const res = await app.inject({
      url: "/ordered",
      headers: { "x-user": "ada" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().trail).toEqual([
      "global",
      "class(user=false)",
      "route",
      "authn",
      "authz",
      "handler",
    ]);
  });

  it("still denies after the middleware ran", async () => {
    const app = await boot((a) => a.useControllers([OrderedController]));
    const res = await app.inject({ url: "/ordered" });
    expect(res.statusCode).toBe(403);
  });
});

describe("functional routes", () => {
  it("supports mapPatch", async () => {
    const app = await boot((a) => {
      a.mapPatch("/fn/item", () => ({ patched: true }));
    });
    const res = await app.inject({ method: "PATCH", url: "/fn/item" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ patched: true });
  });

  it("runs middleware classes and instances bound, then authentication", async () => {
    const app = await boot((a) => {
      a.mapGet("/fn/trail", (req: any) => ({
        trail: req.trail,
        user: req.user,
      })).useMiddleware([InjectedMw, new SilentMw()]);
    });
    const res = await app.inject({
      url: "/fn/trail",
      headers: { "x-user": "ada" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      trail: ["injected:svc", "silent", "authn"],
      user: { name: "ada" },
    });
  });

  it("enforces .authorized()", async () => {
    const app = await boot((a) => {
      a.mapGet("/fn/secret", () => ({ ok: true })).authorized();
    });
    expect((await app.inject({ url: "/fn/secret" })).statusCode).toBe(403);
    const allowed = await app.inject({
      url: "/fn/secret",
      headers: { "x-user": "ada" },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("denies .authorized() routes when the named handler is missing", async () => {
    const app = MeghApplication.getInternalApp();
    app.mapGet("/fn/named", () => ({ ok: true })).authorized("missing");
    apps.push(app);
    await expect(app.run(0)).rejects.toThrow(/No authorization handler/);
  });

  it("sends Results with their status", async () => {
    const app = await boot((a) => {
      a.mapPost("/fn/create", () => Results.Created({ id: 1 }));
    });
    const res = await app.inject({ method: "POST", url: "/fn/create" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ data: { id: 1 } });
  });

  it("sends thrown errors through the error handler", async () => {
    const app = await boot((a) => {
      a.mapGet("/fn/conflict", () => {
        throw new ConflictException("Taken");
      });
    });
    const res = await app.inject({ url: "/fn/conflict" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 409, message: "Taken" });
  });
});
