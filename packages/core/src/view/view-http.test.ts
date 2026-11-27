import "reflect-metadata";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeghApplication } from "../core/application";
import { ApiController } from "../http/controller";
import { Get } from "../http/route-methods";
import { Param } from "../http/params";
import { Results } from "../http/results";
import { setViewEngine, view } from "./index";

const root = path.join(__dirname, "__fixtures__", "views");
const todos = [{ title: "Write engine", done: true }];

@ApiController("/pages")
class PagesController {
  @Get("/home")
  home() {
    return Results.View("home", { user: { name: "Ana" }, todos });
  }

  @Get("/nav/:name")
  nav(@Param("name") name: string) {
    return view("partials.nav", { user: { name } }, 202).header(
      "x-view",
      "nav",
    );
  }

  @Get("/broken")
  broken() {
    return Results.View("missing.page");
  }
}

async function boot(setup: (app: MeghApplication) => void) {
  const app = MeghApplication.getInternalApp();
  setup(app);
  const before = {
    SIGTERM: process.listeners("SIGTERM"),
    SIGINT: process.listeners("SIGINT"),
  };
  await app.run(0);
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    for (const l of process.listeners(sig)) {
      if (!before[sig].includes(l)) process.removeListener(sig, l);
    }
  }
  return app;
}

describe("views over HTTP", () => {
  let app: MeghApplication;
  let spies: ReturnType<typeof vi.spyOn>[] = [];

  beforeEach(async () => {
    spies = (["log", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    app = await boot((a) => {
      a.useViews({ root });
      a.getViews().share("appName", "Megh");
      a.useControllers([PagesController]);
      a.mapGet("/fn", () => view("partials.nav", { user: null }));
    });
  });

  afterEach(async () => {
    await app.close();
    setViewEngine(undefined);
    spies.forEach((s) => s.mockRestore());
  });

  it("renders Results.View from a controller as text/html", async () => {
    const res = await app.inject({ method: "GET", url: "/pages/home" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toMatch(/<title>Home<\/title>/);
    expect(res.body).toMatch(/<nav>Megh \| Ana<\/nav>/);
  });

  it("applies the status code, headers and escaping", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/pages/nav/%3Cb%3E",
    });
    expect(res.statusCode).toBe(202);
    expect(res.headers["x-view"]).toBe("nav");
    expect(res.body).toBe("<nav>Megh | &lt;b&gt;</nav>\n");
  });

  it("renders views returned by mapGet handlers", async () => {
    const res = await app.inject({ method: "GET", url: "/fn" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toBe("<nav>Megh | Guest</nav>\n");
  });

  it("answers 500 when a view fails", async () => {
    const res = await app.inject({ method: "GET", url: "/pages/broken" });
    expect(res.statusCode).toBe(500);
  });
});
