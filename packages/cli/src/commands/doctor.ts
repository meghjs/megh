import path from "path";
import { c, icon } from "../utils/log";
import { findProjectRoot, installedVersion } from "../utils/project";
import { cliVersion } from "../utils/stubs";
import { findTsConfig, readTsConfig } from "../utils/tsconfig";

export type CheckStatus = "ok" | "warn" | "fail";
export type Check = { name: string; status: CheckStatus; detail: string };

// Matches "engines.node" in @meghjs/core and @meghjs/cli.
const MIN_NODE_MAJOR = 22;

const major = (v: string) => Number(v.replace(/^[^\d]*/, "").split(".")[0]);
const minor = (v: string) => Number(v.replace(/^[^\d]*/, "").split(".")[1] ?? 0);

/** Run the environment checks. Pure apart from reading files, so it is easy to test. */
export function runChecks(cwd: string, nodeVersion = process.versions.node): Check[] {
  const checks: Check[] = [];
  const cli = cliVersion();

  checks.push({
    name: "Node.js",
    status: major(nodeVersion) >= MIN_NODE_MAJOR ? "ok" : "fail",
    detail: `v${nodeVersion} (requires >=${MIN_NODE_MAJOR})`,
  });
  checks.push({ name: "@meghjs/cli", status: "ok", detail: `v${cli}` });

  const root = findProjectRoot(cwd);
  if (!root) {
    checks.push({
      name: "Project",
      status: "fail",
      detail: `no package.json found in ${path.resolve(cwd)} or its parents`,
    });
    return checks;
  }
  checks.push({ name: "Project", status: "ok", detail: root });

  const core = installedVersion("@meghjs/core", root);
  if (!core) {
    checks.push({ name: "@meghjs/core", status: "fail", detail: "not installed (npm install @meghjs/core)" });
  } else if (major(core) !== major(cli)) {
    checks.push({
      name: "@meghjs/core",
      status: "fail",
      detail: `v${core} does not match CLI v${cli} (major versions must match)`,
    });
  } else if (minor(core) !== minor(cli)) {
    checks.push({ name: "@meghjs/core", status: "warn", detail: `v${core}, CLI is v${cli} (minor versions differ)` });
  } else {
    checks.push({ name: "@meghjs/core", status: "ok", detail: `v${core} (matches CLI)` });
  }

  const reflect = installedVersion("reflect-metadata", root);
  checks.push(
    reflect
      ? { name: "reflect-metadata", status: "ok", detail: `v${reflect}` }
      : { name: "reflect-metadata", status: "fail", detail: "not installed (npm install reflect-metadata)" },
  );

  const tsconfig = findTsConfig(root);
  if (!tsconfig) {
    checks.push({ name: "tsconfig.json", status: "fail", detail: "not found" });
  } else {
    let opts: Record<string, any> | null = null;
    try {
      opts = readTsConfig(tsconfig).compilerOptions;
    } catch (err) {
      checks.push({ name: "tsconfig.json", status: "fail", detail: `cannot parse: ${(err as Error).message}` });
    }
    if (opts) {
      for (const flag of ["experimentalDecorators", "emitDecoratorMetadata"]) {
        checks.push({
          name: flag,
          status: opts[flag] === true ? "ok" : "fail",
          detail: opts[flag] === true ? "enabled" : `set "${flag}": true in compilerOptions`,
        });
      }
    }
  }
  return checks;
}

/** Print the checks and return the exit code: 1 if any check failed. */
export function doctor(cwd = process.cwd()): number {
  const checks = runChecks(cwd);
  const marks: Record<CheckStatus, string> = { ok: icon.success, warn: icon.warn, fail: icon.error };
  for (const check of checks) {
    console.log(`${marks[check.status]} ${check.name.padEnd(24)}${c.dim(check.detail)}`);
  }
  const failed = checks.filter((x) => x.status === "fail").length;
  const warned = checks.filter((x) => x.status === "warn").length;
  console.log();
  if (failed) console.log(c.red(`${failed} check(s) failed${warned ? `, ${warned} warning(s)` : ""}.`));
  else console.log(c.green(`All checks passed${warned ? ` with ${warned} warning(s)` : ""}.`));
  return failed ? 1 : 0;
}
