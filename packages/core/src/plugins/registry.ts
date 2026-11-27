import type { MeghApplication } from "../core/application";
import { fastifyOf } from "../core/internal";
import { Container } from "../di";
import { LoggerService } from "../observability/logger";
import { SystemUseError } from "../common/exceptions/system-exception";
import { BUILTIN_PLUGINS } from "./builtin";
import { discoverPlugins } from "./discovery";
import { assertPlugin, type MeghPlugin, type PluginContext } from "./plugin";

export type PluginOptions = {
  /** Plugins to register explicitly. They take precedence over discovered plugins of the same name. */
  plugins?: MeghPlugin[];
  /** Find plugins among the app's dependencies. Defaults to true. */
  autoloadPlugins?: boolean;
};

/**
 * Register the app's plugins, dependencies first, and return the names of
 * the installed and explicitly given ones in registration order. Core's
 * built-in plugins are registered too, unless a plugin with the same name
 * replaces them, but aren't listed.
 */
export function registerPlugins(
  app: MeghApplication,
  options: PluginOptions = {},
  builtins: readonly MeghPlugin[] = BUILTIN_PLUGINS,
): string[] {
  const byName = new Map<string, MeghPlugin>();
  for (const plugin of options.plugins ?? []) {
    assertPlugin(plugin, "An entry in the plugins option");
    if (byName.has(plugin.name)) {
      throw new SystemUseError(
        `Plugin "${plugin.name}" is listed more than once`,
      );
    }
    byName.set(plugin.name, plugin);
  }
  if (options.autoloadPlugins !== false) {
    for (const plugin of discoverPlugins()) {
      if (!byName.has(plugin.name)) byName.set(plugin.name, plugin);
    }
  }

  const builtin = new Set<MeghPlugin>();
  for (const plugin of builtins) {
    if (byName.has(plugin.name)) continue;
    byName.set(plugin.name, plugin);
    builtin.add(plugin);
  }

  const ordered = sortByDependencies(byName);
  const methodOwners = new Map<string, string>();
  for (const plugin of ordered) {
    let result: unknown;
    try {
      result = plugin.register(createContext(app, plugin, methodOwners));
    } catch (err: any) {
      throw new SystemUseError(
        `Plugin "${plugin.name}" failed to register: ${err?.message ?? err}`,
      );
    }
    if (typeof (result as any)?.then === "function") {
      throw new SystemUseError(
        `Plugin "${plugin.name}": register() must be synchronous. Move async work into ctx.onInit().`,
      );
    }
  }
  return ordered.filter((p) => !builtin.has(p)).map((p) => p.name);
}

function createContext(
  app: MeghApplication,
  plugin: MeghPlugin,
  methodOwners: Map<string, string>,
): PluginContext {
  return {
    app,
    container: Container,
    http: fastifyOf(app),
    logger: LoggerService.child({ plugin: plugin.name }),
    extend(name, method) {
      if (typeof method !== "function") {
        throw new SystemUseError(
          `Plugin "${plugin.name}" tried to add app.${name}, which is not a function`,
        );
      }
      const owner = methodOwners.get(name);
      if (owner) {
        throw new SystemUseError(
          `Plugin "${plugin.name}" cannot add app.${name}: plugin "${owner}" already added it`,
        );
      }
      if (name in app) {
        throw new SystemUseError(
          `Plugin "${plugin.name}" cannot add app.${name}: the application already defines it`,
        );
      }
      Object.defineProperty(app, name, {
        value: method,
        writable: false,
        enumerable: false,
      });
      methodOwners.set(name, plugin.name);
    },
    onInit: (hook) => void app.onInit(hook),
    onReady: (hook) => void app.onReady(hook),
    onClose: (hook) => void app.onClose(hook),
    addHealthCheck: (name, check) => void app.addHealthCheck(name, check),
  };
}

/** Order plugins so each one comes after everything in its `dependsOn`. */
function sortByDependencies(byName: Map<string, MeghPlugin>): MeghPlugin[] {
  const ordered: MeghPlugin[] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (plugin: MeghPlugin, chain: string[]) => {
    const current = state.get(plugin.name);
    if (current === "done") return;
    if (current === "visiting") {
      throw new SystemUseError(
        `Plugin dependency cycle: ${[...chain, plugin.name].join(" -> ")}`,
      );
    }
    state.set(plugin.name, "visiting");
    for (const dep of plugin.dependsOn ?? []) {
      const required = byName.get(dep);
      if (!required) {
        throw new SystemUseError(
          `Plugin "${plugin.name}" depends on "${dep}", which is not installed`,
        );
      }
      visit(required, [...chain, plugin.name]);
    }
    state.set(plugin.name, "done");
    ordered.push(plugin);
  };

  for (const plugin of byName.values()) visit(plugin, []);
  return ordered;
}
