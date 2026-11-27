import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runCli } from "../src/program";
import { createApplication, FEATURES, initGit } from "../src/commands/new";
import { spawnSync } from "child_process";
import { runChecks } from "../src/commands/doctor";
import { formatRoutes, joinRoute, scanRoutes } from "../src/commands/route-list";
import {
  makeConfig,
  makeController,
  makeDto,
  makeMail,
  makeMiddleware,
  makeModel,
  makeService,
} from "../src/generators/make";
import { entryCandidates, projectLayout, resolveEntry } from "../src/utils/entry";
import { kebabCase, pascalCase, resolveName } from "../src/utils/names";
import { parseJsonc, readTsConfig } from "../src/utils/tsconfig";
import { CliError } from "../src/errors";

let tmp: string;
const quiet = () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "megh-cli-"));
  quiet();
  // Projects made by `new` skip git init unless a test turns it back on.
  vi.stubEnv("MEGH_SKIP_GIT", "1");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const read = (...p: string[]) => fs.readFileSync(path.join(tmp, ...p), "utf8");
const exists = (...p: string[]) => fs.existsSync(path.join(tmp, ...p));
const project = () => fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "x" }));

describe("names", () => {
  it("splits identifiers in any casing", () => {
    expect(pascalCase("jwt-auth")).toBe("JwtAuth");
    expect(pascalCase("jwt_auth")).toBe("JwtAuth");
    expect(kebabCase("JwtAuth")).toBe("jwt-auth");
    expect(kebabCase("HTTPServer")).toBe("http-server");
  });

  it("resolves nested names and drops a repeated suffix", () => {
    const n = resolveName("admin/UserController", "Controller");
    expect(n).toEqual({
      dirs: ["admin"],
      base: "User",
      className: "UserController",
      varName: "user",
      fileBase: "user",
    });
  });

  it("rejects empty names and parent traversal", () => {
    expect(() => resolveName("", "Model")).toThrow(CliError);
    expect(() => resolveName("../User", "Model")).toThrow(CliError);
  });
});

describe("tsconfig", () => {
  it("parses comments and trailing commas but keeps strings intact", () => {
    const json = parseJsonc('{ // c\n "a": "http://x/*y*/", /* b */ "b": [1,2,], }');
    expect(json).toEqual({ a: "http://x/*y*/", b: [1, 2] });
  });

  it("merges extends and resolves path options", () => {
    fs.writeFileSync(path.join(tmp, "base.json"), '{ "compilerOptions": { "outDir": "out", "strict": true } }');
    fs.writeFileSync(path.join(tmp, "tsconfig.json"), '{ "extends": "./base", "compilerOptions": { "rootDir": "lib" } }');
    const { compilerOptions } = readTsConfig(path.join(tmp, "tsconfig.json"));
    expect(compilerOptions.strict).toBe(true);
    expect(compilerOptions.outDir).toBe(path.join(tmp, "out"));
    expect(compilerOptions.rootDir).toBe(path.join(tmp, "lib"));
  });
});

describe("entry resolution", () => {
  it("maps main from src to the output dir and falls back to conventional names", () => {
    project();
    const layout = projectLayout(tmp);
    const list = entryCandidates(layout, { main: "src/app.ts" });
    expect(list[0]).toBe(path.join(tmp, "dist", "app.js"));
    expect(list).toContain(path.join(tmp, "dist", "serve.js"));

    fs.mkdirSync(path.join(tmp, "dist"));
    fs.writeFileSync(path.join(tmp, "dist", "serve.js"), "");
    expect(resolveEntry(list)).toBe(path.join(tmp, "dist", "serve.js"));
  });

  it("does not fall back when --entry is missing", () => {
    project();
    fs.mkdirSync(path.join(tmp, "dist"));
    fs.writeFileSync(path.join(tmp, "dist", "serve.js"), "");
    const list = entryCandidates(projectLayout(tmp), {}, "nope.js");
    expect(resolveEntry(list, "nope.js")).toBeNull();
  });
});

describe("route scanning", () => {
  it("joins paths without duplicate or trailing slashes", () => {
    expect(joinRoute("/", "/")).toBe("/");
    expect(joinRoute("/users/", "/:id/")).toBe("/users/:id");
  });

  it("reads controller and method decorators", () => {
    const src = `
@ApiController('/users')
export class UserController {
  @Get()
  list() {}
  @Post({ path: '/create' })
  async create() {}
}
@ApiController
export class HomeController {
  @Get('/health')
  health() {}
}`;
    expect(scanRoutes(src, "a.ts").map((r) => `${r.method} ${r.path} ${r.handler}`)).toEqual([
      "GET /users list",
      "POST /users/create create",
      "GET /health health",
    ]);
  });

  it("reads @Authorized and @Public for the AUTH column (#142)", () => {
    const src = `
import { ApiController, Authorized, Get, Public } from '@meghjs/core';

@Authorized('jwt')
@ApiController('/admin')
export class AdminController {
  @Get('/')
  list() {}
}

@ApiController('/posts')
export class PostController {
  @Public()
  @Get('/')
  list() { return []; }

  @Authorized({ name: 'editor', roles: ['x'] })
  @Get('/drafts')
  drafts() {}

  @Get('/:id')
  show() {}
}

@Public()
@ApiController
export class HealthController {
  @Authorized()
  @Get('/deep')
  deep() {}
}`;
    expect(scanRoutes(src, "a.ts").map((r) => `${r.path} ${r.auth}`)).toEqual([
      "/admin authorized:jwt",
      "/posts public",
      "/posts/drafts authorized:editor",
      "/posts/:id default",
      "/deep authorized",
    ]);
  });

  it("reads @Tool from @meghjs/ai, with the default tool name", () => {
    const src = `
@ApiController('/orders')
export class OrderController {
  @Get('/:id')
  @Tool({ description: "Look up one order by its ID." })
  findOne() {}

  @Tool({
    name: 'refund_order',
    description: 'Refund an order.',
    confirm: true,
  })
  @Post('/:id/refund')
  refund() {}

  @Get('/')
  list() {}
}`;
    expect(scanRoutes(src, "a.ts").map((r) => [r.handler, r.tool])).toEqual([
      ["findOne", { name: "order_find_one", description: "Look up one order by its ID.", confirm: false }],
      ["refund", { name: "refund_order", description: "Refund an order.", confirm: true }],
      ["list", undefined],
    ]);
  });

  it("shows a TOOL column only when a route is a tool", () => {
    const base = { method: "GET", path: "/a", controller: "A", handler: "a", file: "a.ts", auth: "default" as const };
    expect(formatRoutes([base])).not.toMatch(/TOOL/);
    const table = formatRoutes([base, { ...base, path: "/b", tool: { name: "a_b", confirm: true } }]);
    expect(table).toMatch(/TOOL/);
    expect(table).toMatch(/a_b \(confirm\)/);
  });
});

describe("generators", () => {
  beforeEach(project);

  it("creates a Mailable in src/mail", () => {
    const info = vi.spyOn(console, "log");
    makeMail("OrderShipped", { cwd: tmp });
    const mail = read("src", "mail", "order-shipped.mail.ts");
    expect(mail).toContain("import { Mailable } from '@meghjs/core';");
    expect(mail).toContain("export class OrderShippedMail extends Mailable {");
    expect(mail).toContain("return { subject: 'Order Shipped' };");
    expect(mail).toContain("new OrderShippedMail()");
    expect(mail).not.toMatch(/\{(ClassName|Title)\}/);
    // The project has no src/app.ts calling useMail(), so it says how to turn mail on.
    expect(info.mock.calls.flat().join("\n")).toContain("app.useMail()");
    expect(() => makeMail("OrderShipped", { cwd: tmp })).toThrow(/already exists/);
  });

  it("puts a module folder before the type folder", () => {
    makeModel("user", { cwd: tmp });
    makeModel("users/user", { cwd: tmp });
    makeController("users/user", { cwd: tmp });
    makeService("users/user", { cwd: tmp });
    makeDto("users/user", { cwd: tmp });
    makeMiddleware("users/auth", { cwd: tmp });
    makeConfig("users/settings", { cwd: tmp });
    makeMail("users/welcome", { cwd: tmp });
    for (const file of [
      "src/models/user.model.ts",
      "src/users/models/user.model.ts",
      "src/users/controllers/user.controller.ts",
      "src/users/services/user.service.ts",
      "src/users/dtos/user.dto.ts",
      "src/users/middlewares/auth.middleware.ts",
      "src/users/config/settings.config.ts",
      "src/users/mail/welcome.mail.ts",
    ]) {
      expect(exists(...file.split("/")), file).toBe(true);
    }
    for (const old of ["controllers", "services", "dtos", "middlewares", "mail"]) {
      expect(exists("src", old, "users"), `src/${old}/users`).toBe(false);
    }
    expect(exists("src", "models", "users")).toBe(false);
  });

  it("puts --root inside the module folder", () => {
    makeModel("users/user", { cwd: tmp, root: "domain" });
    expect(exists("src", "users", "domain", "user.model.ts")).toBe(true);
  });

  it("strips a Mail suffix and supports folders", () => {
    makeMail("admin/InvoiceMail", { cwd: tmp });
    expect(read("src", "admin", "mail", "invoice.mail.ts")).toContain("export class InvoiceMail extends Mailable");
    makeMail("Welcome", { cwd: tmp, root: "modules/users" });
    expect(exists("src", "modules", "users", "welcome.mail.ts")).toBe(true);
  });

  it("does not repeat the useMail() hint once the app calls it", () => {
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src", "app.ts"), "app.useMail();\n");
    const info = vi.spyOn(console, "log");
    makeMail("Welcome", { cwd: tmp });
    expect(info.mock.calls.flat().join("\n")).not.toContain("Turn mail on");
  });

  it("creates a model and refuses to overwrite without force", () => {
    makeModel("product", { cwd: tmp });
    expect(read("src", "models", "product.model.ts")).toContain("class Product");
    expect(() => makeModel("product", { cwd: tmp })).toThrow(/already exists/);
    expect(() => makeModel("product", { cwd: tmp, force: true })).not.toThrow();
  });

  it("creates a resource controller with its DTOs, service and model (from the migration)", () => {
    const migrations = path.join(tmp, "src", "database", "migrations");
    fs.mkdirSync(migrations, { recursive: true });
    fs.writeFileSync(
      path.join(migrations, "20260101000000_create_products_table.ts"),
      `export async function up(db) {
  await db.schema.createTable("products")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("name", "text", (col) => col.notNull())
    .execute();
}`,
    );
    makeController("admin/product", { cwd: tmp, model: "product" });
    const ctrl = read("src", "admin", "controllers", "product.controller.ts");
    expect(ctrl).toContain("class ProductController");
    expect(ctrl).toContain("@ApiController('/admin/products')");
    expect(ctrl).toContain("from '../../services/product.service'");
    expect(ctrl).toContain("from '../../dtos/product.dto'");
    expect(read("src", "services", "product.service.ts")).toContain("Product.findOrFail(id)");
    expect(read("src", "models", "product.model.ts")).toContain("class Product extends Model");
    expect(read("src", "dtos", "product.dto.ts")).toContain("class CreateProductDto");
  });

  it("uses a singular route when the controller name is already plural", () => {
    const migrations = path.join(tmp, "src", "database", "migrations");
    fs.mkdirSync(migrations, { recursive: true });
    fs.writeFileSync(
      path.join(migrations, "20260101000000_create_users_table.ts"),
      `export async function up(db) {
  await db.schema.createTable("users")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("name", "text", (col) => col.notNull())
    .execute();
}`,
    );
    makeController("Users", { cwd: tmp, resource: true });
    const ctrl = read("src", "controllers", "users.controller.ts");
    expect(ctrl).toContain("@ApiController('/users')");
    expect(ctrl).not.toContain("/userses");
  });

  it("refuses a resource controller without a model or migration, writing nothing", () => {
    expect(() => makeController("product", { cwd: tmp, model: "product" })).toThrow(/make:migration create_products_table/);
    expect(exists("src")).toBe(false);
  });

  it("requires a model for a resource service", () => {
    expect(() => makeService("product", { cwd: tmp, resource: true })).toThrow(/needs a model/);
  });

  it("honours --root", () => {
    makeDto("CreateUser", { cwd: tmp, root: "modules/users" });
    expect(read("src", "modules", "users", "create-user.dto.ts")).toContain("class CreateUserDto");
  });

  it("leaves no unrendered placeholders in any stub", () => {
    makeController("a", { cwd: tmp, resource: true });
    makeController("b", { cwd: tmp, model: "b", typeorm: true });
    makeModel("c", { cwd: tmp, typeorm: true });
    const files = fs
      .readdirSync(path.join(tmp, "src"), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => fs.readFileSync(path.join((e as any).parentPath ?? (e as any).path, e.name), "utf8"));
    for (const content of files) {
      expect(content).not.toMatch(/\{(ClassName|Model|modelVar|route|ServiceClass|serviceVar|serviceImport|modelImport|table)\}/);
    }
  });
});

describe("new", () => {
  it("scaffolds a full project with valid JSON files", async () => {
    const root = await createApplication("my_api", { cwd: tmp, yes: true, skipInstall: true, features: ["openapi", "cors"] });
    const pkg = JSON.parse(read("my_api", "package.json"));
    expect(pkg.name).toBe("my-api");
    expect(pkg.dependencies["@fastify/cors"]).toBeDefined();
    expect(pkg.dependencies["@fastify/swagger"]).toBeDefined();
    expect(pkg.dependencies["@fastify/swagger-ui"]).toBeDefined();
    expect(pkg.scripts["start:dev"]).toBe("megh serve");
    expect(pkg.scripts.test).toBe("vitest run");
    expect(read("my_api", "vitest.config.mts")).toContain("swc.vite()");
    expect(exists("my_api", "vitest.e2e.config.mts")).toBe(true);
    expect(read("my_api", "src", "app.ts")).toContain("useCors");
    expect(fs.existsSync(path.join(root, "src", "config", "openapi.config.ts"))).toBe(true);
    expect(pkg.dependencies["@meghjs/data"]).toBeUndefined();
    expect(read("my_api", "megh-env.d.ts")).not.toContain("reference");
  });

  it("offers only openapi, cors and orm, and says how to add the others", async () => {
    expect(FEATURES).toEqual(["openapi", "cors", "orm"]);
    for (const [feature, hint] of [
      ["mail", /app\.useMail\(\)/],
      ["scalar", /provider: 'scalar'/],
      ["typeorm", /useTypeORM/],
      ["knex", /useKnex/],
    ] as const) {
      await expect(
        createApplication(`${feature}_api`, { cwd: tmp, yes: true, skipInstall: true, features: [feature] }),
      ).rejects.toThrow(hint);
      expect(exists(`${feature}_api`, "package.json")).toBe(false);
    }
  });

  it("writes AGENTS.md for coding agents, and a CLAUDE.md that imports it", async () => {
    await createApplication("shop", { cwd: tmp, yes: true, skipInstall: true, features: ["openapi", "orm"] });
    expect(read("shop", "CLAUDE.md")).toBe("@AGENTS.md\n");
    const agents = read("shop", "AGENTS.md");
    expect(agents).toMatch(/^# shop\n/);
    expect(agents).toContain("| Unit tests (`*.spec.ts`) | `npm test` |");
    expect(agents).toContain("npx megh migrate");
    expect(agents).toContain("app.useControllers([...])");
    expect(agents).toContain("https://meghjs.github.io/llms.txt");
    expect(agents).not.toContain("@Tool()");

    await createApplication("tiny_agents", { cwd: tmp, yes: true, skipInstall: true, minimal: true });
    const tiny = read("tiny_agents", "AGENTS.md");
    expect(tiny).not.toContain("npm test");
    expect(tiny).not.toContain("useControllers");
    expect(tiny).not.toContain("migrate");
  });

  it("leaves the OpenAPI packages out of a minimal project", async () => {
    await createApplication("tiny", { cwd: tmp, yes: true, skipInstall: true, minimal: true });
    const pkg = JSON.parse(read("tiny", "package.json"));
    expect(pkg.dependencies["@fastify/swagger"]).toBeUndefined();
  });

  const hasGit = spawnSync("git", ["--version"]).status === 0;

  it.runIf(hasGit)("runs git init in the new project", async () => {
    vi.stubEnv("MEGH_SKIP_GIT", "");
    await createApplication("git_api", { cwd: tmp, yes: true, skipInstall: true });
    expect(exists("git_api", ".git")).toBe(true);
  });

  it("skips git init with skipGit", async () => {
    vi.stubEnv("MEGH_SKIP_GIT", "");
    await createApplication("nogit_api", { cwd: tmp, yes: true, skipInstall: true, skipGit: true });
    expect(exists("nogit_api", ".git")).toBe(false);
  });

  it.runIf(hasGit)("leaves a folder that is already inside a repository alone", () => {
    expect(initGit(tmp)).toBe("initialized");
    const inner = path.join(tmp, "packages", "api");
    fs.mkdirSync(inner, { recursive: true });
    expect(initGit(inner)).toBe("inside-repo");
    expect(fs.existsSync(path.join(inner, ".git"))).toBe(false);
  });

  it("leaves mail out", async () => {
    await createApplication("plain", { cwd: tmp, yes: true, skipInstall: true });
    expect(JSON.parse(read("plain", "package.json")).dependencies.nodemailer).toBeUndefined();
    expect(read("plain", "src", "app.ts")).not.toContain("useMail");
    expect(read("plain", ".env")).not.toContain("MEGH_MAIL");
    expect(exists("plain", "src", "mail")).toBe(false);
  });

  it("sets up MeghORM with the orm feature, on SQLite by default", async () => {
    await createApplication("shop", { cwd: tmp, yes: true, skipInstall: true, features: ["orm"] });
    const pkg = JSON.parse(read("shop", "package.json"));
    expect(pkg.dependencies["better-sqlite3"]).toBeDefined();
    expect(pkg.devDependencies["@faker-js/faker"]).toBeDefined(); // for make:factory
    expect(pkg.dependencies.kysely).toBeUndefined(); // ships with @meghjs/core
    expect(pkg.dependencies["@meghjs/data"]).toBeUndefined();
    expect(read("shop", "src", "app.ts")).toContain("app.useMeghORM();");
    expect(read("shop", ".env")).toContain("DATABASE_URL=sqlite:./database.sqlite");
    expect(read("shop", ".gitignore")).toContain("database.sqlite");
    expect(exists("shop", "src", "database", "migrations", ".gitkeep")).toBe(true);
    expect(read("shop", "src", "database", "seeders", "database.seeder.ts")).toContain("export default defineSeeder({");
    expect(exists("shop", "src", "database", "connection.ts")).toBe(false);
  });

  it("with pnpm, approves the build scripts pnpm would otherwise block", async () => {
    await createApplication("pn", { cwd: tmp, yes: true, skipInstall: true, pm: "pnpm", features: ["orm"] });
    const ws = read("pn", "pnpm-workspace.yaml");
    expect(ws).toContain('allowBuilds:\n  "@swc/core": true\n  better-sqlite3: true\n');
    expect(ws).toContain('onlyBuiltDependencies:\n  - "@swc/core"\n  - better-sqlite3\n');

    await createApplication("pn_pg", { cwd: tmp, yes: true, skipInstall: true, pm: "pnpm", database: "postgres" });
    expect(read("pn_pg", "pnpm-workspace.yaml")).not.toContain("better-sqlite3");

    await createApplication("np", { cwd: tmp, yes: true, skipInstall: true });
    expect(exists("np", "pnpm-workspace.yaml")).toBe(false);
  });

  it("--database picks the driver and URL, and implies the orm feature", async () => {
    await createApplication("my-api", { cwd: tmp, yes: true, skipInstall: true, features: ["openapi"], database: "postgres" });
    const pkg = JSON.parse(read("my-api", "package.json"));
    expect(pkg.dependencies.pg).toBeDefined();
    expect(read("my-api", "src", "app.ts")).toContain("app.useMeghORM();");
    expect(read("my-api", ".env")).toContain("DATABASE_URL=postgres://postgres:postgres@localhost:5432/my_api");
    expect(read("my-api", ".gitignore")).not.toContain("database.sqlite");

    await createApplication("legacy", { cwd: tmp, yes: true, skipInstall: true, database: "mssql" });
    const mssql = JSON.parse(read("legacy", "package.json"));
    expect([mssql.dependencies.tedious, mssql.dependencies.tarn].every(Boolean)).toBe(true);
    expect(read("legacy", "src", "app.ts")).toContain("useOpenApi"); // default features kept
  });

  it("rejects an unknown database, and --database with --minimal", async () => {
    await expect(
      createApplication("bad", { cwd: tmp, yes: true, skipInstall: true, database: "oracle" }),
    ).rejects.toThrow(/Unknown database "oracle"/);
    await expect(
      createApplication("bad2", { cwd: tmp, yes: true, skipInstall: true, minimal: true, database: "mysql" }),
    ).rejects.toThrow(/needs a full project/);
  });

  it("scaffolds a minimal project", async () => {
    await createApplication("mini", { cwd: tmp, minimal: true, yes: true, skipInstall: true });
    expect(exists("mini", "src", "app.ts")).toBe(true);
    expect(exists("mini", "src", "controllers")).toBe(false);
    expect(JSON.parse(read("mini", "package.json")).devDependencies.vitest).toBeUndefined();
  });

  it("refuses a non-empty directory without --force", async () => {
    fs.mkdirSync(path.join(tmp, "taken"));
    fs.writeFileSync(path.join(tmp, "taken", "x"), "");
    await expect(createApplication("taken", { cwd: tmp, yes: true, skipInstall: true })).rejects.toThrow(/not empty/);
  });

  it("rejects unknown features", async () => {
    await expect(
      createApplication("bad", { cwd: tmp, yes: true, skipInstall: true, features: ["mongo"] }),
    ).rejects.toThrow(/Unknown feature/);
  });
});

describe("doctor", () => {
  it("fails outside a project and on old Node", () => {
    const checks = runChecks(path.parse(tmp).root, "18.0.0");
    expect(checks.find((c) => c.name === "Node.js")?.status).toBe("fail");
  });

  it("flags missing decorator settings", () => {
    project();
    fs.writeFileSync(path.join(tmp, "tsconfig.json"), '{ "compilerOptions": { "experimentalDecorators": true } }');
    const checks = runChecks(tmp);
    expect(checks.find((c) => c.name === "experimentalDecorators")?.status).toBe("ok");
    expect(checks.find((c) => c.name === "emitDecoratorMetadata")?.status).toBe("fail");
  });
});

describe("make:agents", () => {
  const app = (pkg: object, files: Record<string, string> = {}) => {
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify(pkg));
    for (const [f, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.writeFileSync(path.join(tmp, f), content);
    }
  };

  it("describes an existing project: package manager, tests, ORM, views and @meghjs/ai", async () => {
    app(
      { name: "legacy", scripts: { test: "vitest run" }, dependencies: { "@meghjs/core": "^0.7.1", "@meghjs/ai": "^0.7.1" } },
      { "pnpm-lock.yaml": "", "src/database/migrations/.gitkeep": "", "views/pages/home.megh.html": "" },
    );
    expect(await runCli(["make:agents"], { cwd: tmp })).toBe(0);
    const agents = read("AGENTS.md");
    expect(agents).toMatch(/^# legacy\n/);
    expect(agents).toContain("`pnpm start:dev`");
    expect(agents).toContain("`pnpm test`");
    expect(agents).toContain("make:resource");
    expect(agents).toContain("make:view");
    expect(agents).toContain("@Tool({ confirm: true })");
    expect(read("CLAUDE.md")).toBe("@AGENTS.md\n");
  });

  it("keeps an existing AGENTS.md unless --force, and never replaces the user's CLAUDE.md", async () => {
    app({ name: "x" }, { "AGENTS.md": "mine\n", "CLAUDE.md": "# My rules\n" });
    expect(await runCli(["make:agents"], { cwd: tmp })).not.toBe(0);
    expect(read("AGENTS.md")).toBe("mine\n");

    const info = vi.spyOn(console, "log");
    expect(await runCli(["make:agents", "--force"], { cwd: tmp })).toBe(0);
    expect(read("AGENTS.md")).toMatch(/^# x\n/);
    expect(read("CLAUDE.md")).toBe("# My rules\n");
    expect(info.mock.calls.flat().join("\n")).toMatch(/add a line `@AGENTS\.md`/);
  });
});

describe("runCli", () => {
  const capture = () => {
    let out = "";
    return { write: (s: string) => (out += s), text: () => out };
  };

  it("prints just the version for -v", async () => {
    const o = capture();
    expect(await runCli(["-v"], { writeOut: o.write })).toBe(0);
    expect(o.text().trim()).toBe(require("../package.json").version);
  });

  it("returns non-zero for unknown commands", async () => {
    const e = capture();
    expect(await runCli(["nope"], { writeErr: e.write })).not.toBe(0);
    expect(e.text()).toMatch(/unknown command/);
  });

  it("supports legacy -rt and aliases", async () => {
    project();
    expect(await runCli(["m:m", "user", "-rt", "domain"], { cwd: tmp })).toBe(0);
    expect(exists("src", "domain", "user.model.ts")).toBe(true);
  });

  it("registers make:mail and its m:mail alias", async () => {
    project();
    expect(await runCli(["make:mail", "Welcome"], { cwd: tmp })).toBe(0);
    expect(await runCli(["m:mail", "Goodbye"], { cwd: tmp })).toBe(0);
    expect(exists("src", "mail", "welcome.mail.ts")).toBe(true);
    expect(exists("src", "mail", "goodbye.mail.ts")).toBe(true);
  });

  it("reports CliErrors as exit code 1", async () => {
    project();
    await runCli(["m:m", "user"], { cwd: tmp });
    expect(await runCli(["m:m", "user"], { cwd: tmp })).toBe(1);
  });
});
