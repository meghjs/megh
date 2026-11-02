import { Command, CommanderError, InvalidArgumentError } from "commander";
import { build } from "./commands/build";
import { doctor } from "./commands/doctor";
import { createApplication, FEATURES, PACKAGE_MANAGERS } from "./commands/new";
import { routeList } from "./commands/route-list";
import { serve } from "./commands/serve";
import { start } from "./commands/start";
import { CliError } from "./errors";
import { migrate, migrateRefresh, migrateReset, migrateRollback, migrateStatus } from "./commands/migrate";
import {
  makeConfig,
  makeController,
  makeDto,
  makeMiddleware,
  makeMigration,
  makeModel,
  makeResource,
  makeService,
} from "./generators/make";
import { log } from "./utils/log";
import { cliVersion } from "./utils/stubs";

export type RunOptions = {
  /** Working directory for the command. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Override where commander writes help and errors (used by tests). */
  writeOut?: (s: string) => void;
  writeErr?: (s: string) => void;
};

/**
 * Legacy spellings commander cannot express directly: `-rt` (multi-letter
 * short flag) and `--rest` (second long name for `--resource`).
 */
export function normalizeArgv(args: string[]): string[] {
  return args.map((a) => (a === "-rt" ? "--root" : a === "--rest" ? "--resource" : a));
}

function parseInteger(value: string) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError("Expected a non-negative integer.");
  return n;
}

function parseList(value: string) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createProgram(run: RunOptions = {}): { program: Command; exitCode: () => number } {
  const cwd = () => run.cwd ?? process.cwd();
  let exitCode = 0;
  const program = new Command();

  program
    .name("megh")
    .description("Scaffold, run and build Megh applications.")
    .version(cliVersion(), "-v, --version", "Print the CLI version")
    .helpOption("-h, --help", "Show help")
    .helpCommand("help [command]", "Show help for a command")
    .showHelpAfterError("(run `megh --help` for usage)")
    .showSuggestionAfterError(true)
    .exitOverride();

  if (run.writeOut || run.writeErr) {
    program.configureOutput({
      ...(run.writeOut ? { writeOut: run.writeOut } : {}),
      ...(run.writeErr ? { writeErr: run.writeErr } : {}),
    });
  }

  const sub = (name: string, description: string) => {
    const cmd = program.command(name).description(description).helpOption("-h, --help", "Show help");
    cmd.exitOverride();
    if (run.writeOut || run.writeErr) cmd.configureOutput(program.configureOutput());
    return cmd;
  };

  // ── Project ─────────────────────────────────────────────────────────────
  sub("new", "Create a new Megh application")
    .argument("<name>", "Project directory (created if missing); `.` for the current directory")
    .option("-m, --minimal", "Minimal app: a single functional route, no controllers, services or tests")
    .option("-f, --force", "Scaffold into a non-empty directory, overwriting generated files")
    .option("-y, --yes", "Skip prompts and use defaults (npm, openapi)")
    .option("--pm <manager>", `Package manager: ${PACKAGE_MANAGERS.join(", ")}`)
    .option("--features <list>", `Comma-separated features: ${FEATURES.join(", ")}`, parseList)
    .option("--skip-install", "Do not install dependencies (or set MEGH_SKIP_INSTALL=1)")
    .action(async (name: string, o) => {
      await createApplication(name, { cwd: cwd(), ...o });
    });

  sub("serve", "Start the dev server: compile src/ with SWC, run the app, reload on changes")
    .option("--entry <file>", "Entry file, overriding megh.entry / main in package.json")
    .option("--no-type-check", "Do not run `tsc --noEmit --watch` alongside the server")
    .option("--debounce <ms>", "Wait this long for more file changes before reloading", parseInteger, 200)
    .action(async (o) => {
      await serve({ cwd: cwd(), entry: o.entry, typeCheck: o.typeCheck, debounce: o.debounce });
    });

  sub("build", "Compile with tsc (tsconfig.build.json, else tsconfig.json) and copy assets")
    .option("-p, --project <file>", "Use this tsconfig instead")
    .action(async (o) => {
      await build({ cwd: cwd(), project: o.project });
    });

  sub("start", "Run the compiled app in production (NODE_ENV=production unless set)")
    .option("--entry <file>", "Entry file, overriding megh.entry / main in package.json")
    .action(async (o) => {
      exitCode = await start({ cwd: cwd(), entry: o.entry });
    });

  sub("doctor", "Check Node.js, @meghjs/core, reflect-metadata and decorator settings")
    .action(() => {
      exitCode = doctor(cwd());
    });

  sub("route:list", "List the app's routes")
    .alias("routes")
    .option("--json", "Print JSON")
    .option(
      "--static",
      "Scan @ApiController/@Get/@Post/... decorators in src/**/*.controller.ts instead of loading the code",
    )
    .addHelpText(
      "after",
      "\nBy default the sources are compiled with SWC to node_modules/.cache/megh and each\n" +
        "*.controller.ts is loaded in a child process to read Megh's route metadata, so\n" +
        "@meghjs/core must be installed. --static needs no dependencies but only understands\n" +
        "string-literal paths.",
    )
    .action((o) => {
      routeList({ cwd: cwd(), json: o.json, static: o.static });
    });

  // ── Database ────────────────────────────────────────────────────────────
  const db = (name: string, description: string) =>
    sub(name, description).addHelpText(
      "after",
      "\nThe Kysely instance is the default (or `db`) export of src/database/connection.ts and\n" +
        "migrations live in src/database/migrations; set megh.database / megh.migrations in\n" +
        "package.json to change them. Sources are compiled with SWC first, and .env is loaded.",
    );

  db("migrate", "Run pending migrations").action(() => {
    migrate({ cwd: cwd() });
  });

  db("migrate:rollback", "Undo the last migration (or the last --step n)")
    .option("--step <n>", "Number of migrations to undo", parseInteger, 1)
    .action((o) => {
      migrateRollback({ cwd: cwd(), step: o.step });
    });

  db("migrate:reset", "Undo every migration").action(() => {
    migrateReset({ cwd: cwd() });
  });

  db("migrate:refresh", "Undo every migration, then run them all again").action(() => {
    migrateRefresh({ cwd: cwd() });
  });

  db("migrate:status", "Show which migrations have run")
    .option("--json", "Print JSON")
    .action((o) => {
      migrateStatus({ cwd: cwd(), json: o.json });
    });

  sub("make:migration", "Create a migration in src/database/migrations/<timestamp>_<name>.ts")
    .alias("m:mig")
    .argument("<name>", "e.g. create_users_table, add_role_to_users_table")
    .option("--create <table>", "Generate a create-table migration for <table>")
    .option("--table <table>", "Generate an alter-table migration for <table>")
    .option("-f, --force", "Overwrite the file if it exists")
    .action((name: string, o) => {
      makeMigration(name, { cwd: cwd(), create: o.create, table: o.table, force: o.force });
    });

  // ── Generators ──────────────────────────────────────────────────────────
  const make = (name: string, aliases: string[], description: string) =>
    sub(name, description)
      .aliases(aliases)
      .argument("<name>", "Name, optionally nested (e.g. admin/User)")
      .option("-f, --force", "Overwrite the file if it exists");

  make("make:model", ["m:m"], "Create a model in src/models/<name>.model.ts, with columns read from its migrations")
    .option("-t, --table <table>", "Table name (default: plural snake_case name, e.g. blog_posts)")
    .option("--orm", "Generate a TypeORM entity")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action((name: string, o) => {
      makeModel(name, { cwd: cwd(), ...o });
    });

  make(
    "make:resource",
    ["m:r", "m:res"],
    "Create a REST resource for a model: its DTOs, a CRUD service and a controller",
  )
    .option("-t, --table <table>", "Table to read the columns from when the model is missing (default: plural snake_case name)")
    .addHelpText(
      "after",
      "\nThe model in src/models/<name>.model.ts is reused if it exists; otherwise it is\n" +
        "generated from the migration that creates its table (and the command fails if\n" +
        "there is none). Then src/dtos/<name>.dto.ts, src/services/<name>.service.ts and\n" +
        "src/controllers/<name>.controller.ts are written, e.g. for `make:resource user`:\n" +
        "  GET /users?page=&perPage=   POST /users   GET|PUT|DELETE /users/:id",
    )
    .action((name: string, o) => {
      makeResource(name, { cwd: cwd(), force: o.force, table: o.table });
    });

  make("make:controller", ["m:c"], "Create a controller in src/controllers/<name>.controller.ts")
    .option("-r, --resource", "Generate a REST skeleton (also --rest)")
    .option("-m, --model <model>", "Back a REST controller with <model>: also creates its DTOs, service and model (from its migration) if missing")
    .option("--orm", "With -m, back the service with a TypeORM repository and entity")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .option("--base-path", "Use @ApiController without a path prefix")
    .action((name: string, o) => {
      makeController(name, { cwd: cwd(), ...o });
    });

  make("make:service", ["m:s"], "Create a service in src/services/<name>.service.ts")
    .option("-r, --resource", "Generate a resource (CRUD) service; requires -m (also --rest)")
    .option("-m, --model <model>", "Model for a resource service; creates the model from its migration if missing")
    .option("--orm", "Back the resource service with a TypeORM repository and entity")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action((name: string, o) => {
      makeService(name, { cwd: cwd(), ...o });
    });

  make("make:config", ["m:cnf", "m:cfg"], "Create an @AppConfig class in src/config/<name>.config.ts")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action((name: string, o) => {
      makeConfig(name, { cwd: cwd(), ...o });
    });

  make("make:middleware", ["m:mlwr", "m:mdlr"], "Create a middleware in src/middlewares/<name>.middleware.ts")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action((name: string, o) => {
      makeMiddleware(name, { cwd: cwd(), ...o });
    });

  make("make:dto", ["m:dto"], "Create a class-validator DTO in src/dtos/<name>.dto.ts")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action((name: string, o) => {
      makeDto(name, { cwd: cwd(), ...o });
    });

  return { program, exitCode: () => exitCode };
}

/**
 * Parse and run a command line (without the `node` and script entries).
 * Resolves to the process exit code instead of exiting, so it can be tested.
 */
export async function runCli(args: string[], run: RunOptions = {}): Promise<number> {
  const { program, exitCode } = createProgram(run);
  const argv = normalizeArgv(args);
  if (argv.length === 0) {
    program.outputHelp();
    return 0;
  }
  try {
    await program.parseAsync(argv, { from: "user" });
    return exitCode();
  } catch (err) {
    if (err instanceof CommanderError) {
      // Help and version are reported as "errors" with exit code 0.
      return err.exitCode;
    }
    if (err instanceof CliError) {
      log.error(err.message);
      return err.exitCode;
    }
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    return 1;
  }
}
