import "reflect-metadata";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeghApplication } from "../core/application";
import { MeghApplicationOptions } from "../core/interfaces";
import { Container } from "../di";
import { discoverPlugins } from "./discovery";
import { definePlugin, type MeghPlugin } from "./plugin";
import { fastifyOf } from "../core/internal";

const apps: MeghApplication[] = [];
// A fresh app per test; getApp() would return a shared singleton.
function createApp(options: MeghApplicationOptions) {
  const app = MeghApplication.getInternalApp({
    autoloadPlugins: false,
    ...options,
  });
  apps.push(app);
  return app;
}

const plugin = (name: string, extra: Partial<MeghPlugin> = {}) =>
  definePlugin({ name, register: () => {}, ...extra });

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

describe("registering plugins", () => {
  it("adds the plugin's methods to the app and records its name", () => {
    const app = createApp({
      plugins: [
        definePlugin({
          name: "greeter",
          register(ctx) {
            ctx.extend("greet", (name: string) => `hello ${name}`);
          },
        }),
      ],
    });

    expect((app as any).greet("megh")).toBe("hello megh");
    expect(app.getPlugins()).toEqual(["greeter"]);
  });

  it("gives the plugin the app, container and Fastify instance", () => {
    let seen: any;
    const app = createApp({
      plugins: [
        definePlugin({ name: "probe", register: (ctx) => void (seen = ctx) }),
      ],
    });

    expect(seen.app).toBe(app);
    expect(seen.container).toBe(Container);
    expect(seen.http).toBe(fastifyOf(app));
    expect(typeof seen.logger.info).toBe("function");
  });

  it("runs the plugin's lifecycle hooks with the app's", async () => {
    const calls: string[] = [];
    const app = createApp({
      plugins: [
        definePlugin({
          name: "db",
          register(ctx) {
            ctx.onInit(() => void calls.push("connect"));
            ctx.onReady(() => void calls.push("ready"));
            ctx.onClose(() => void calls.push("disconnect"));
          },
        }),
      ],
    });

    await app.run(0);
    await app.close();

    expect(calls).toEqual(["connect", "ready", "disconnect"]);
  });

  it("registers dependencies first", () => {
    const order: string[] = [];
    const track = (name: string, dependsOn?: string[]) =>
      plugin(name, { dependsOn, register: () => void order.push(name) });

    const app = createApp({
      plugins: [
        track("queue", ["data"]),
        track("audit", ["queue", "data"]),
        track("data"),
      ],
    });

    expect(order).toEqual(["data", "queue", "audit"]);
    expect(app.getPlugins()).toEqual(["data", "queue", "audit"]);
  });

  it("rejects a missing dependency", () => {
    expect(() =>
      createApp({ plugins: [plugin("queue", { dependsOn: ["data"] })] }),
    ).toThrow("Plugin \"queue\" depends on \"data\", which is not installed");
  });

  it("rejects a dependency cycle", () => {
    expect(() =>
      createApp({
        plugins: [
          plugin("a", { dependsOn: ["b"] }),
          plugin("b", { dependsOn: ["a"] }),
        ],
      }),
    ).toThrow("Plugin dependency cycle: a -> b -> a");
  });

  it("rejects the same plugin listed twice", () => {
    expect(() =>
      createApp({ plugins: [plugin("data"), plugin("data")] }),
    ).toThrow("Plugin \"data\" is listed more than once");
  });

  it("rejects a method name the application already defines", () => {
    const bad = plugin("bad", {
      register: (ctx) => ctx.extend("useCors", () => {}),
    });

    expect(() => createApp({ plugins: [bad] })).toThrow(
      "Plugin \"bad\" cannot add app.useCors: the application already defines it",
    );
  });

  it("rejects a method name another plugin added", () => {
    const first = plugin("first", {
      register: (ctx) => ctx.extend("useThing", () => {}),
    });
    const second = plugin("second", {
      register: (ctx) => ctx.extend("useThing", () => {}),
    });

    expect(() => createApp({ plugins: [first, second] })).toThrow(
      "Plugin \"second\" cannot add app.useThing: plugin \"first\" already added it",
    );
  });

  it("rejects an async register()", () => {
    const asyncPlugin = {
      name: "slow",
      register: async () => {},
    } as unknown as MeghPlugin;

    expect(() => createApp({ plugins: [asyncPlugin] })).toThrow(
      "Plugin \"slow\": register() must be synchronous. Move async work into ctx.onInit().",
    );
  });

  it("names the plugin when register() throws", () => {
    const broken = plugin("broken", {
      register: () => {
        throw new Error("missing config");
      },
    });

    expect(() => createApp({ plugins: [broken] })).toThrow(
      "Plugin \"broken\" failed to register: missing config",
    );
  });

  it("rejects something that is not a plugin", () => {
    expect(() => createApp({ plugins: [{ name: "x" } as any] })).toThrow(
      "An entry in the plugins option is not a valid Megh plugin",
    );
  });
});

describe("discovering plugins", () => {
  let root: string;

  /** Write `node_modules/<name>` with the given package.json fields and files. */
  function installPackage(
    name: string,
    pkg: object,
    files: Record<string, string> = {},
  ) {
    const dir = path.join(root, "node_modules", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name, ...pkg }),
    );
    for (const [file, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, file), content);
    }
  }

  const pluginSource = (name: string, method: string) =>
    `exports.default = { name: ${JSON.stringify(name)}, register(ctx) {` +
    ` ctx.extend(${JSON.stringify(method)}, () => ${JSON.stringify(name)}); } };`;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "megh-plugins-"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        dependencies: {
          "@acme/data": "*",
          "plain-lib": "*",
          "not-installed": "*",
        },
        devDependencies: { "dev-plugin": "*" },
      }),
    );
    installPackage(
      "@acme/data",
      { megh: { plugin: "./plugin.js" } },
      { "plugin.js": pluginSource("@acme/data", "useData") },
    );
    installPackage("plain-lib", { main: "index.js" });
    installPackage(
      "dev-plugin",
      { megh: { plugin: "./plugin.js" } },
      { "plugin.js": pluginSource("dev-plugin", "useDev") },
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("finds installed dependencies that declare a plugin entry", () => {
    expect(discoverPlugins(root).map((p) => p.name)).toEqual([
      "@acme/data",
      "dev-plugin",
    ]);
  });

  it("finds packages installed in a parent node_modules", () => {
    const nested = path.join(root, "apps", "api");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, "package.json"),
      JSON.stringify({ dependencies: { "@acme/data": "*" } }),
    );

    expect(discoverPlugins(nested).map((p) => p.name)).toEqual(["@acme/data"]);
  });

  it("returns nothing without a package.json", () => {
    expect(discoverPlugins(path.join(root, "missing"))).toEqual([]);
  });

  it("reports a plugin entry that exports something else", () => {
    installPackage(
      "bad-plugin",
      { megh: { plugin: "./plugin.js" } },
      { "plugin.js": "exports.x = 1;" },
    );
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { "bad-plugin": "*" } }),
    );

    expect(() => discoverPlugins(root)).toThrow(
      "bad-plugin (./plugin.js) is not a valid Megh plugin",
    );
  });

  it("autoloads discovered plugins when the app is created", () => {
    vi.spyOn(process, "cwd").mockReturnValue(root);

    const app = createApp({ autoloadPlugins: true });

    expect((app as any).useData()).toBe("@acme/data");
    expect(app.getPlugins()).toEqual(["@acme/data", "dev-plugin"]);
  });

  it("prefers an explicit plugin over a discovered one with the same name", () => {
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const local = definePlugin({
      name: "@acme/data",
      register: (ctx) => ctx.extend("useData", () => "explicit"),
    });

    const app = createApp({ autoloadPlugins: true, plugins: [local] });

    expect((app as any).useData()).toBe("explicit");
  });

  it("skips discovery when autoloadPlugins is false", () => {
    vi.spyOn(process, "cwd").mockReturnValue(root);

    const app = createApp({ autoloadPlugins: false });

    expect(app.getPlugins()).toEqual([]);
    expect((app as any).useData).toBeUndefined();
  });
});
