import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runCli } from "../src/program";
import { createApplication } from "../src/commands/new";
import { runChecks } from "../src/commands/doctor";
import { joinRoute, scanRoutes } from "../src/commands/route-list";
import { makeController, makeDto, makeModel, makeService } from "../src/generators/make";
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
});

afterEach(() => {
  vi.restoreAllMocks();
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
});

describe("generators", () => {
  beforeEach(project);

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
    const ctrl = read("src", "controllers", "admin", "product.controller.ts");
    expect(ctrl).toContain("class ProductController");
    expect(ctrl).toContain("@ApiController('/admin/products')");
    expect(ctrl).toContain("from '../../services/product.service'");
    expect(ctrl).toContain("from '../../dtos/product.dto'");
    expect(read("src", "services", "product.service.ts")).toContain("Product.findOrFail(id)");
    expect(read("src", "models", "product.model.ts")).toContain("class Product extends Model");
    expect(read("src", "dtos", "product.dto.ts")).toContain("class CreateProductDto");
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
    makeController("b", { cwd: tmp, model: "b", orm: true });
    makeModel("c", { cwd: tmp, orm: true });
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
    expect(pkg.scripts["start:dev"]).toBe("megh serve");
    expect(pkg.scripts.test).toBe("vitest run");
    expect(read("my_api", "vitest.config.mts")).toContain("swc.vite()");
    expect(exists("my_api", "vitest.e2e.config.mts")).toBe(true);
    expect(read("my_api", "src", "app.ts")).toContain("useCors");
    expect(fs.existsSync(path.join(root, "src", "config", "openapi.config.ts"))).toBe(true);
    expect(pkg.dependencies["@meghjs/data"]).toBeUndefined();
    expect(read("my_api", "megh-env.d.ts")).not.toContain("reference");
  });

  it("adds @meghjs/data and its types for the database features", async () => {
    await createApplication("db_api", { cwd: tmp, yes: true, skipInstall: true, features: ["typeorm"] });
    const pkg = JSON.parse(read("db_api", "package.json"));
    expect(pkg.dependencies["@meghjs/data"]).toBe(pkg.dependencies["@meghjs/cli"]);
    expect(pkg.dependencies.typeorm).toBeDefined();
    expect(read("db_api", "megh-env.d.ts")).toContain('/// <reference types="@meghjs/data" />');
    expect(read("db_api", "tsconfig.json")).toContain('"megh-env.d.ts"');
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

describe("runCli", () => {
  const capture = () => {
    let out = "";
    return { write: (s: string) => (out += s), text: () => out };
  };

  it("prints the version", async () => {
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

  it("reports CliErrors as exit code 1", async () => {
    project();
    await runCli(["m:m", "user"], { cwd: tmp });
    expect(await runCli(["m:m", "user"], { cwd: tmp })).toBe(1);
  });
});
