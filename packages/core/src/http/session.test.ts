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
import { ViewEngine, setViewEngine } from "../view";
import { ApiController } from "./controller";
import { Get, Post } from "./route-methods";
import { Body, Session } from "./params";
import { Results } from "./results";
import {
  MeghSession,
  MemorySessionStore,
  RedisSessionStore,
  type SessionOptions,
  currentSession,
  unsignSessionId,
} from "./session";

const SECRET = "a".repeat(32);

@AppService
class SessionAuth extends MeghAuthentication {
  authenticate(request: IRequest) {
    void request;
    const id = currentSession()?.get<number>("userId");
    return id ? { id, name: "Ana" } : null;
  }
}

@ApiController("/s")
class SessionController {
  @Get("/count")
  count(@Session() session: MeghSession) {
    const n = (session.get<number>("n") ?? 0) + 1;
    session.set("n", n);
    return { n };
  }

  @Get("/peek")
  peek(@Session() session: MeghSession) {
    return { all: session.all(), isNew: session.isNew };
  }

  @Post("/login")
  login(@Body() body: { id: number }, @Session() session: MeghSession) {
    session.regenerate().set("userId", body.id);
    session.flash("status", "Welcome back!");
    return Results.Redirect("/s/home");
  }

  @Post("/logout")
  logout(@Session() session: MeghSession) {
    session.destroy();
    return Results.Redirect("/s/home");
  }

  @Get("/home")
  home() {
    return Results.View("home");
  }
}

let viewsRoot: string;

beforeAll(() => {
  viewsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "megh-session-views-"));
  fs.writeFileSync(
    path.join(viewsRoot, "home.megh.html"),
    [
      "@session('status')<p class=\"status\">{{ value }}</p>@endsession",
      "@auth<p>Hi user {{ session.get('userId') }}</p>@else<a>Log in</a>@endauth",
      "@guest<span>guest</span>@endguest",
    ].join("\n"),
  );
});

afterAll(() => {
  setViewEngine(undefined);
  fs.rmSync(viewsRoot, { recursive: true, force: true });
});

const apps: MeghApplication[] = [];

async function boot(options: SessionOptions = { secret: SECRET }) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const app = MeghApplication.getInternalApp();
  app.useErrorLogger(false);
  app.useSession(options);
  app.useAuthentication(SessionAuth);
  app.useViews(new ViewEngine({ root: viewsRoot, cache: false }));
  app.useControllers([SessionController]);
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
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

/** The `name=value` part of the session cookie a response set, if any. */
function cookieOf(res: { headers: Record<string, unknown> }) {
  const header = res.headers["set-cookie"];
  const list = Array.isArray(header) ? header : header ? [header] : [];
  return list.map(String).find((c) => c.startsWith("megh_session="));
}

const pair = (setCookie: string) => setCookie.split(";")[0];

describe("useSession", () => {
  it("keeps values across requests with a signed, HttpOnly cookie", async () => {
    const app = await boot();
    const first = await app.inject("/s/count");
    expect(first.json()).toEqual({ n: 1 });
    const setCookie = cookieOf(first)!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Max-Age=7200/);
    expect(setCookie).not.toMatch(/Secure/);

    const second = await app.inject({
      url: "/s/count",
      headers: { cookie: pair(setCookie) },
    });
    expect(second.json()).toEqual({ n: 2 });
  });

  it("sets no cookie for a visitor with nothing stored", async () => {
    const app = await boot();
    const res = await app.inject("/s/peek");
    expect(res.json()).toEqual({ all: {}, isNew: true });
    expect(cookieOf(res)).toBeUndefined();
  });

  it("ignores a cookie with a bad signature", async () => {
    const app = await boot();
    const cookie = pair(cookieOf(await app.inject("/s/count"))!);
    const forged = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const res = await app.inject({
      url: "/s/peek",
      headers: { cookie: forged },
    });
    expect(res.json()).toEqual({ all: {}, isNew: true });
  });

  it("accepts cookies signed with an older secret", async () => {
    const old = "o".repeat(32);
    const store = new MemorySessionStore();
    let app = await boot({ secret: old, store });
    const cookie = pair(cookieOf(await app.inject("/s/count"))!);
    await app.close();

    app = await boot({ secret: [SECRET, old], store });
    const res = await app.inject({ url: "/s/count", headers: { cookie } });
    expect(res.json()).toEqual({ n: 2 });
    store.close();
  });

  it("logs in with a new session ID, flashes once, and renders @auth/@session", async () => {
    const app = await boot();
    const anon = pair(cookieOf(await app.inject("/s/count"))!);

    const login = await app.inject({
      method: "POST",
      url: "/s/login",
      headers: { cookie: anon },
      payload: { id: 7 },
    });
    expect(login.statusCode).toBe(302);
    const authed = pair(cookieOf(login)!);
    expect(authed).not.toBe(anon); // regenerated

    // The pre-login session is gone.
    const reused = await app.inject({
      url: "/s/peek",
      headers: { cookie: anon },
    });
    expect(reused.json().isNew).toBe(true);

    const home = await app.inject({
      url: "/s/home",
      headers: { cookie: authed },
    });
    expect(home.body).toContain("<p class=\"status\">Welcome back!</p>");
    expect(home.body).toContain("Hi user 7");
    expect(home.body).not.toContain("Log in");
    expect(home.body).not.toContain("guest");

    // Flashed values last one request.
    const again = await app.inject({
      url: "/s/home",
      headers: { cookie: authed },
    });
    expect(again.body).not.toContain("status");
    expect(again.body).toContain("Hi user 7");
  });

  it("renders the guest branches without a user", async () => {
    const app = await boot();
    const home = await app.inject("/s/home");
    expect(home.body).toContain("<a>Log in</a>");
    expect(home.body).toContain("<span>guest</span>");
    expect(home.body).not.toContain("status");
  });

  it("destroys the session and clears the cookie on logout", async () => {
    const app = await boot();
    const login = await app.inject({
      method: "POST",
      url: "/s/login",
      payload: { id: 1 },
    });
    const cookie = pair(cookieOf(login)!);

    const logout = await app.inject({
      method: "POST",
      url: "/s/logout",
      headers: { cookie },
    });
    expect(cookieOf(logout)).toMatch(/^megh_session=; .*Max-Age=0/);

    const after = await app.inject({ url: "/s/home", headers: { cookie } });
    expect(after.body).toContain("Log in");
  });

  it("marks the cookie Secure behind HTTPS, and honours cookie options", async () => {
    const app = await boot({
      secret: SECRET,
      cookieName: "sid",
      maxAge: "7 days",
      cookie: { sameSite: "strict", secure: true, domain: "example.com" },
    });
    const res = await app.inject("/s/count");
    const header = String(res.headers["set-cookie"]);
    expect(header).toMatch(/^sid=/);
    expect(header).toMatch(/Max-Age=604800/);
    expect(header).toMatch(/SameSite=Strict/);
    expect(header).toMatch(/Domain=example.com/);
    expect(header).toMatch(/Secure/);
  });

  it("rejects a missing or short secret and bad options", () => {
    const app = MeghApplication.getInternalApp();
    const env = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      expect(() => app.useSession()).toThrow(/needs a secret/);
      expect(() => app.useSession({ secret: "short" })).toThrow(/at least 32/);
      expect(() => app.useSession({ secret: SECRET, maxAge: "soon" })).toThrow(
        /Invalid session maxAge/,
      );
      expect(() =>
        app.useSession({
          secret: SECRET,
          cookie: { sameSite: "none", secure: false },
        }),
      ).toThrow(/must be secure/);
    } finally {
      if (env !== undefined) process.env.SESSION_SECRET = env;
    }
  });

  it("fails @Session() clearly without useSession()", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = MeghApplication.getInternalApp();
    app.useErrorLogger(false);
    app.useControllers([SessionController]);
    apps.push(app);
    await app.run(0, { host: "127.0.0.1" });
    const res = await app.inject("/s/count");
    expect(res.statusCode).toBe(500);
  });
});

describe("MeghSession", () => {
  it("reads flashed values, pulls, clears and reflashes", () => {
    const s = new MeghSession("id", { a: 1, __flash: { msg: "hi" } });
    expect(s.get("msg")).toBe("hi");
    expect(s.pull("a")).toBe(1);
    expect(s.has("a")).toBe(false);
    s.reflash();
    expect(s.snapshot().data).toEqual({ __flash: { msg: "hi" } });
    s.clear();
    expect(s.all()).toEqual({});
    expect(() => s.set("__flash", 1)).toThrow(/Invalid session key/);
  });

  it("verifies signatures with each secret", () => {
    expect(unsignSessionId("abc", [SECRET])).toBeNull();
    expect(unsignSessionId("abc.wrong", [SECRET])).toBeNull();
  });
});

describe("session stores", () => {
  it("expires memory sessions", async () => {
    const store = new MemorySessionStore();
    await store.set("x", { a: 1 }, 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.get("x")).toBeNull();
    store.close();
  });

  it("stores JSON in Redis with a TTL", async () => {
    const data = new Map<string, string>();
    const redis = {
      get: vi.fn(async (k: string) => data.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => void data.set(k, v)),
      del: vi.fn(async (k: string) => void data.delete(k)),
    };
    const store = new RedisSessionStore(redis);
    await store.set("x", { a: 1 }, 5000);
    expect(redis.set).toHaveBeenCalledWith(
      "megh:session:x",
      "{\"a\":1}",
      "PX",
      5000,
    );
    expect(await store.get("x")).toEqual({ a: 1 });
    await store.destroy("x");
    expect(await store.get("x")).toBeNull();
    expect(() => new RedisSessionStore({} as any)).toThrow(/ioredis client/);
  });
});
