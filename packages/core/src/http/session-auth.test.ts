import "reflect-metadata";
import fs from "fs";
import os from "os";
import path from "path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MeghApplication } from "../core/application";
import { IRequest } from "../core/types";
import { AppService } from "../common/decorators";
import { MeghAuthentication } from "../security/authentication";
import { clearGates, gate } from "../security/gate";
import { requestContext } from "../observability/request-context";
import { ViewEngine, setViewEngine } from "../view";
import { ApiController } from "./controller";
import { Get, Post } from "./route-methods";
import { Authorized, CanAuthorize, Public } from "./middleware";
import { Body, Param, Session } from "./params";
import { Results } from "./results";
import { MeghSession, currentSession } from "./session";

const SECRET = "s".repeat(32);

type User = { id: number; role: "admin" | "member" };
const USERS: Record<number, User> = {
  1: { id: 1, role: "admin" },
  2: { id: 2, role: "member" },
};
const POSTS: Record<number, { id: number; authorId: number }> = {
  10: { id: 10, authorId: 2 },
};

@AppService
class SessionAuth extends MeghAuthentication<User> {
  authenticate(_request: IRequest) {
    const id = currentSession()?.get<number>("userId");
    return id ? USERS[id] : null;
  }
}

@CanAuthorize
class RoleAuthorization {
  authorize(request: IRequest, options?: { roles?: string[] }) {
    const user = (request as any).user as User | undefined;
    if (!user) return false;
    return !options?.roles || options.roles.includes(user.role);
  }
}

@ApiController("/")
class AppController {
  @Public()
  @Get("/login")
  loginPage() {
    return "login page";
  }

  @Public()
  @Post("/login")
  login(@Body() body: { id: number }, @Session() session: MeghSession) {
    session.regenerate().set("userId", body.id);
    return Results.Redirect(session.intended("/dashboard"));
  }

  @Get("/dashboard")
  dashboard() {
    return "dashboard";
  }

  @Post("/dashboard/save")
  save() {
    return "saved";
  }

  @Authorized({ roles: ["admin"] })
  @Get("/admin")
  admin() {
    return "admin";
  }

  @Get("/posts/:id")
  post(@Param("id") id: number) {
    return Results.View("post", { post: POSTS[id] });
  }

  @Post("/posts/:id/edit")
  edit(@Param("id") id: number) {
    gate.authorize("edit-post", POSTS[id]);
    return "edited";
  }
}

let viewsRoot: string;

beforeAll(() => {
  viewsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "megh-gate-views-"));
  fs.writeFileSync(
    path.join(viewsRoot, "post.megh.html"),
    [
      "@can('edit-post', post)[edit]@else[read-only]@endcan",
      "@cannot('admin')[not-admin] @endcannot",
    ].join("\n"),
  );
});

afterAll(() => {
  setViewEngine(undefined);
  fs.rmSync(viewsRoot, { recursive: true, force: true });
});

const apps: MeghApplication[] = [];

async function boot() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const app = MeghApplication.getInternalApp();
  app.useErrorLogger(false);
  app.useSession({ secret: SECRET, loginPath: "/login" });
  app.useAuthentication(SessionAuth);
  app.useAuthorization(RoleAuthorization, { default: "authenticated" });
  app.useViews(new ViewEngine({ root: viewsRoot, cache: false }));
  app.defineGate(
    "edit-post",
    (user: User, post: { authorId: number }) =>
      user.role === "admin" || user.id === post.authorId,
  );
  app.defineGate("admin", (user: User) => user.role === "admin");
  app.useControllers([AppController]);
  apps.push(app);
  const before = process.listeners("SIGTERM");
  await app.run(0, { host: "127.0.0.1" });
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    for (const l of process.listeners(sig)) {
      if (!before.includes(l)) process.removeListener(sig, l);
    }
  }
  return app;
}

afterEach(async () => {
  vi.restoreAllMocks();
  clearGates();
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

const HTML = { accept: "text/html,application/xhtml+xml,*/*;q=0.8" };

function cookieOf(res: { headers: Record<string, unknown> }) {
  const header = res.headers["set-cookie"];
  const list = Array.isArray(header) ? header : header ? [header] : [];
  const c = list.map(String).find((v) => v.startsWith("megh_session="));
  return c?.split(";")[0];
}

async function loginAs(app: MeghApplication, id: number, cookie?: string) {
  const res = await app.inject({
    method: "POST",
    url: "/login",
    headers: { ...HTML, ...(cookie && { cookie }) },
    payload: { id },
  });
  return { res, cookie: cookieOf(res)! };
}

describe("loginPath", () => {
  it("redirects a browser to the login page, then back to the page it asked for", async () => {
    const app = await boot();
    const guest = await app.inject({
      url: "/dashboard?tab=2",
      headers: HTML,
    });
    expect(guest.statusCode).toBe(302);
    expect(guest.headers.location).toBe("/login");

    const { res } = await loginAs(app, 2, cookieOf(guest));
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/dashboard?tab=2");

    // Used once.
    const { res: again } = await loginAs(app, 2, cookieOf(res));
    expect(again.headers.location).toBe("/dashboard");
  });

  it("uses 303 for a form POST and doesn't remember it", async () => {
    const app = await boot();
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/save",
      headers: HTML,
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/login");
    expect(cookieOf(res)).toBeUndefined();
  });

  it("keeps the 401 for JSON and XHR requests", async () => {
    const app = await boot();
    const json = await app.inject({
      url: "/dashboard",
      headers: { accept: "application/json" },
    });
    expect(json.statusCode).toBe(401);
    const xhr = await app.inject({
      url: "/dashboard",
      headers: { ...HTML, "x-requested-with": "XMLHttpRequest" },
    });
    expect(xhr.statusCode).toBe(401);
    const curl = await app.inject({ url: "/dashboard" });
    expect(curl.statusCode).toBe(401);
  });

  it("serves the page once logged in, and keeps 403 for a denied user", async () => {
    const app = await boot();
    const { cookie } = await loginAs(app, 2);
    const dash = await app.inject({
      url: "/dashboard",
      headers: { ...HTML, cookie },
    });
    expect(dash.body).toBe("dashboard");

    const admin = await app.inject({
      url: "/admin",
      headers: { ...HTML, cookie },
    });
    expect(admin.statusCode).toBe(403);

    const { cookie: adminCookie } = await loginAs(app, 1);
    const ok = await app.inject({
      url: "/admin",
      headers: { ...HTML, cookie: adminCookie },
    });
    expect(ok.body).toBe("admin");
  });

  it("must be a local path", () => {
    const app = MeghApplication.getInternalApp();
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil",
      "login",
    ]) {
      expect(() => app.useSession({ secret: SECRET, loginPath: bad })).toThrow(
        /loginPath/,
      );
    }
  });

  it("intended() ignores anything but a local path", () => {
    const s = new MeghSession("id", { __intended: "//evil.example" });
    expect(s.intended("/home")).toBe("/home");
    s.rememberIntended("https://evil.example");
    expect(s.intended()).toBe("/");
    expect(s.all()).toEqual({});
  });
});

describe("gates", () => {
  it("drive @can / @cannot from the request's user", async () => {
    const app = await boot();
    const guest = await app.inject({ url: "/posts/10", headers: HTML });
    expect(guest.statusCode).toBe(302); // the "authenticated" default

    const author = (await loginAs(app, 2)).cookie;
    const own = await app.inject({
      url: "/posts/10",
      headers: { ...HTML, cookie: author },
    });
    expect(own.body).toContain("[edit]");
    expect(own.body).toContain("[not-admin]");

    const admin = (await loginAs(app, 1)).cookie;
    const any = await app.inject({
      url: "/posts/10",
      headers: { ...HTML, cookie: admin },
    });
    expect(any.body).toContain("[edit]");
    expect(any.body).not.toContain("[not-admin]");
  });

  it("gate.authorize answers 403 for a denied user", async () => {
    const app = await boot();
    app.defineGate("never", () => false);
    const member = (await loginAs(app, 2)).cookie;
    const ok = await app.inject({
      method: "POST",
      url: "/posts/10/edit",
      headers: { cookie: member },
    });
    expect(ok.body).toBe("edited");

    USERS[3] = { id: 3, role: "member" };
    const other = (await loginAs(app, 3)).cookie;
    const denied = await app.inject({
      method: "POST",
      url: "/posts/10/edit",
      headers: { cookie: other },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("deny guests, check other users, and reject bad gates", () => {
    const app = MeghApplication.getInternalApp();
    app.defineGate("admin", (user: User) => user.role === "admin");
    app.defineGate("slow", async () => true as any);

    expect(gate.allows("admin")).toBe(false); // no request, no user
    expect(() => gate.authorize("admin")).toThrow(/Unauthorized/);
    expect(gate.forUser(USERS[1]).allows("admin")).toBe(true);
    expect(gate.forUser(USERS[2]).denies("admin")).toBe(true);
    expect(
      requestContext.run(() => gate.allows("admin"), { user: USERS[1] }),
    ).toBe(true);

    expect(() => gate.forUser(USERS[1]).allows("slow")).toThrow(
      /synchronously/,
    );
    expect(() => gate.allows("missing")).toThrow(/No gate named "missing"/);
    expect(() => app.defineGate("admin", () => true)).toThrow(
      /already defined/,
    );
    expect(() => app.defineGate("x", "nope" as any)).toThrow(/check function/);
  });
});
