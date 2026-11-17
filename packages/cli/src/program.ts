import { Command, CommanderError, InvalidArgumentError } from "commander";
import { build } from "./commands/build";
import { doctor } from "./commands/doctor";
import { createApplication, DATABASES, FEATURES, PACKAGE_MANAGERS } from "./commands/new";
import { routeList } from "./commands/route-list";
import { serve } from "./commands/serve";
import { start } from "./commands/start";
import { CliError } from "./errors";
import { dbSeed, migrate, migrateRefresh, migrateReset, migrateRollback, migrateStatus } from "./commands/migrate";
import {
  makeConfig,
  makeController,
  makeDto,
  makeEvent,
  makeListener,
  makeMail,
  makeQueue,
  makeTask,
  makeWorker,
  makeMiddleware,
  makeMigration,
  makeModel,
  makeResource,
  makeSeeder,
  makeFactory,
  syncModel,
  makeService,
} from "./generators/make";
import { listTemplates, makeFromTemplate, scaffoldDomain } from "./generators/scaffold";
import { AUTH_STRATEGIES, scaffoldAuth, ROLE_MODES, scaffoldRbac } from "./generators/auth";
import { parseFieldList } from "./templates/fields";
import { banner } from "./utils/banner";
import { log } from "./utils/log";
import { cliVersion } from "./utils/stubs";
import { withReview } from "./utils/changes";
import { findProjectRoot } from "./utils/project";

export type RunOptions = {
  /** Working directory for the command. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Override where commander writes help and errors (used by tests). */
  writeOut?: (s: string) => void;
  writeErr?: (s: string) => void;
  /**
   * Answer the "apply these changes?" question a command asks before changing
   * existing files (used by tests). Without it, the user is asked when running
   * in a terminal; otherwise the changes are kept.
   */
  confirm?: (message: string) => Promise<boolean>;
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
  // Root help only (`megh`, `megh --help`); subcommand help stays plain.
  program.addHelpText("before", () => `${banner()}
`);

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

  /**
   * Run a command that writes files. If it changes files that already exist,
   * show the diff and what it can affect, and ask before keeping it.
   */
  const review = (o: { yes?: boolean; dryRun?: boolean }, command: () => unknown, quiet = true) =>
    withReview(command, {
      projectRoot: findProjectRoot(cwd()) ?? cwd(),
      yes: o.yes,
      dryRun: o.dryRun,
      confirm: run.confirm,
      quiet,
    });

  // ── Project ─────────────────────────────────────────────────────────────
  sub("new", "Create a new Megh application")
    .argument("<name>", "Project directory (created if missing); `.` for the current directory")
    .option("-m, --minimal", "Minimal app: a single functional route, no controllers, services or tests")
    .option("-f, --force", "Scaffold into a non-empty directory, overwriting generated files")
    .option("-y, --yes", "Skip prompts and use defaults (npm, openapi)")
    .option("--pm <manager>", `Package manager: ${PACKAGE_MANAGERS.join(", ")}`)
    .option("--features <list>", `Comma-separated features: ${FEATURES.join(", ")}`, parseList)
    .option(
      "--database <name>",
      `Set up MeghORM (the orm feature) for ${DATABASES.join(", ")}. Defaults to sqlite with orm`,
    )
    .option("--skip-install", "Do not install dependencies (or set MEGH_SKIP_INSTALL=1)")
    .option("--skip-git", "Do not run git init (or set MEGH_SKIP_GIT=1)")
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
    sub(name, description)
      .option("--compiled", "Run the built .js files from the tsconfig outDir instead of compiling src/")
      .addHelpText(
        "after",
        "\nConnects the way app.useMeghORM() does: from DATABASE_URL (or DB_DIALECT, DB_HOST,\n" +
          "DB_NAME, ...) in the environment or .env, with optional settings in megh.database in\n" +
          "package.json. Migrations live in src/database/migrations; set megh.migrations to\n" +
          "change it. Sources are compiled with SWC first; with --compiled (or when there is no\n" +
          "src/ folder, as in a production image) the output of megh build runs instead.",
      );

  db("migrate", "Run pending migrations")
    .option("--seed", "Run the seeders afterwards (see db:seed)")
    .option("--force", "With --seed: seed even when NODE_ENV is production")
    .action((o) => {
      migrate({ cwd: cwd(), seed: o.seed, force: o.force, compiled: o.compiled });
    });

  db("migrate:rollback", "Undo the last migration (or the last --step n)")
    .option("--step <n>", "Number of migrations to undo", parseInteger, 1)
    .action((o) => {
      migrateRollback({ cwd: cwd(), step: o.step, compiled: o.compiled });
    });

  db("migrate:reset", "Undo every migration").action((o) => {
    migrateReset({ cwd: cwd(), compiled: o.compiled });
  });

  db("migrate:refresh", "Undo every migration, then run them all again")
    .option("--seed", "Run the seeders afterwards (see db:seed)")
    .option("--force", "With --seed: seed even when NODE_ENV is production")
    .action((o) => {
      migrateRefresh({ cwd: cwd(), seed: o.seed, force: o.force, compiled: o.compiled });
    });

  db("db:seed", "Fill the database: run the database seeder, or every seeder in file order")
    .option("-s, --seeder <name>", "Run only this seeder, e.g. users for users.seeder.ts")
    .option("--force", "Seed even when NODE_ENV is production")
    .addHelpText(
      "after",
      "\nSeeders live in src/database/seeders (set megh.seeders to change it). Without\n" +
        "--seeder, database.seeder.ts runs and calls the others in its order; without it,\n" +
        "every seeder runs in file-name order. A run is one transaction: if a seeder\n" +
        "throws, nothing is saved.",
    )
    .action((o) => {
      dbSeed({ cwd: cwd(), seeder: o.seeder, force: o.force, compiled: o.compiled });
    });

  db("migrate:status", "Show which migrations have run")
    .option("--json", "Print JSON")
    .action((o) => {
      migrateStatus({ cwd: cwd(), json: o.json, compiled: o.compiled });
    });

  sub("make:migration", "Create a migration in src/database/migrations/<timestamp>_<name>.ts")
    .alias("m:mig")
    .argument("<name>", "e.g. create_users_table, add_role_to_users_table")
    .option("--create <table>", "Generate a create-table migration for <table>")
    .option("--table <table>", "Generate an alter-table migration for <table>")
    .option("-f, --force", "Overwrite the file if it exists")
    .option("-y, --yes", "Apply changes to existing files without asking")
    .action(async (name: string, o) => {
      await review(o, () => makeMigration(name, { cwd: cwd(), create: o.create, table: o.table, force: o.force }));
    });

  sub("make:seeder", "Create a seeder in src/database/seeders/<name>.seeder.ts")
    .alias("m:sd")
    .argument("<name>", "e.g. users, or database for the entry seeder db:seed runs")
    .option("-f, --force", "Overwrite the file if it exists")
    .option("-y, --yes", "Apply changes to existing files without asking")
    .action(async (name: string, o) => {
      await review(o, () => makeSeeder(name, { cwd: cwd(), force: o.force }));
    });

  sub("make:factory", "Create a model factory in src/database/factories/<name>.factory.ts")
    .alias("m:f")
    .argument("<model>", "Model name, e.g. user for src/models/user.model.ts")
    .option("-f, --force", "Overwrite the file if it exists")
    .addHelpText(
      "after",
      "\nWrites UserFactory = defineFactory(User, ({ faker }) => ({ ... })) with a Faker value\n" +
        "for each column, picked from its name and type. A foreign key such as role_id uses\n" +
        "RoleFactory when src/database/factories/role.factory.ts exists. Needs @faker-js/faker.",
    )
    .option("-y, --yes", "Apply changes to existing files without asking")
    .action(async (name: string, o) => {
      await review(o, () => makeFactory(name, { cwd: cwd(), force: o.force }));
    });

  // ── Generators ──────────────────────────────────────────────────────────
  const make = (name: string, aliases: string[], description: string) =>
    sub(name, description)
      .aliases(aliases)
      .argument("<name>", "Name, optionally nested (e.g. admin/User)")
      .option("-f, --force", "Overwrite the file if it exists (shows the changes and asks first)")
      .option("-y, --yes", "Don't prompt: apply changes to existing files without asking");

  make("make:model", ["m:m"], "Create a model in src/models/<name>.model.ts, with columns read from its migrations")
    .option("-t, --table <table>", "Table name (default: plural snake_case name, e.g. blog_posts)")
    .option("--orm", "Generate a TypeORM entity")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .option("--template [ref]", "Create the table from a template, e.g. ecommerce/product (no value: pick one)")
    .option("--fields <list>", 'Columns to add or replace, e.g. "title,price:money,status:in(draft|live)"')
    .option("--factory", "With --template/--fields: also write a factory")
    .option("--no-deps", "With --template/--fields: don't create the tables foreign keys point to")
    .addHelpText("after", TEMPLATE_HELP)
    .action(async (name: string, o) => {
      if (o.template !== undefined || o.fields !== undefined) {
        if (o.orm) throw new CliError("--template and --fields build Megh ORM models; leave out --orm.");
        await review(o, () => makeFromTemplate(name, { cwd: cwd(), mode: "model", ...templateOptions(o) }), false);
        return;
      }
      await review(o, () => makeModel(name, { cwd: cwd(), force: o.force, table: o.table, orm: o.orm, root: o.root }));
    });

  sub("sync:model", "Sync a model's columns with its migrations, keeping relations and methods")
    .aliases(["s:m", "update:model", "u:m"])
    .argument("<name>", "Model name, optionally nested (e.g. admin/User)")
    .option("-t, --table <table>", "Table to read (default: the model's @Table, else the plural snake_case name)")
    .option("--dto", "Also rewrite src/dtos/<name>.dto.ts from the updated columns")
    .option("--dry-run", "Show what would change without writing")
    .option("-y, --yes", "Apply the changes without asking")
    .option("--root <dir>", "Folder under src/ the model is in (also -rt)")
    .addHelpText(
      "after",
      "\nAfter an alter-table migration, e.g. schema.table(\"users\", t => { t.string(\"phone\"); t.dropColumn(\"age\") }):\n" +
        "new columns are added to the model, dropped ones removed, and fields still as make:model\n" +
        "wrote them get the current type and nullability. Fields you customized (a name: mapping,\n" +
        "a custom cast, extra options) are kept and reported.",
    )
    .action(async (name: string, o) => {
      await review(o, () => syncModel(name, { cwd: cwd(), table: o.table, dto: o.dto, root: o.root }));
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
    .option("--template [ref]", "Create the table from a template, e.g. ecommerce/product (no value: pick one)")
    .option("--fields <list>", 'Columns to add or replace, e.g. "title,price:money,status:in(draft|live)"')
    .option("--factory", "With --template/--fields: also write a factory")
    .option("--no-deps", "With --template/--fields: don't create the tables foreign keys point to")
    .action(async (name: string, o) => {
      if (o.template !== undefined || o.fields !== undefined) {
        await review(o, () => makeFromTemplate(name, { cwd: cwd(), mode: "resource", ...templateOptions(o) }), false);
        return;
      }
      await review(o, () => makeResource(name, { cwd: cwd(), force: o.force, table: o.table }));
    });

  make("make:controller", ["m:c"], "Create a controller in src/controllers/<name>.controller.ts")
    .option("-r, --resource", "Generate a REST skeleton (also --rest)")
    .option("-m, --model <model>", "Back a REST controller with <model>: also creates its DTOs, service and model (from its migration) if missing")
    .option("--orm", "With -m, back the service with a TypeORM repository and entity")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .option("--base-path", "Use @ApiController without a path prefix")
    .action(async (name: string, o) => {
      await review(o, () => makeController(name, { cwd: cwd(), ...o }));
    });

  make("make:service", ["m:s"], "Create a service in src/services/<name>.service.ts")
    .option("-r, --resource", "Generate a resource (CRUD) service; requires -m (also --rest)")
    .option("-m, --model <model>", "Model for a resource service; creates the model from its migration if missing")
    .option("--orm", "Back the resource service with a TypeORM repository and entity")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action(async (name: string, o) => {
      await review(o, () => makeService(name, { cwd: cwd(), ...o }));
    });

  make("make:config", ["m:cnf", "m:cfg"], "Create an @AppConfig class in src/config/<name>.config.ts")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action(async (name: string, o) => {
      await review(o, () => makeConfig(name, { cwd: cwd(), ...o }));
    });

  make("make:middleware", ["m:mlwr", "m:mdlr"], "Create a middleware in src/middlewares/<name>.middleware.ts")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action(async (name: string, o) => {
      await review(o, () => makeMiddleware(name, { cwd: cwd(), ...o }));
    });

  make("make:mail", ["m:mail"], "Create a Mailable in src/mail/<name>.mail.ts")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action(async (name: string, o) => {
      await review(o, () => makeMail(name, { cwd: cwd(), ...o }));
    });

  make("make:event", ["m:ev"], "Create an event in src/events/<name>.event.ts")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action((name: string, o) => {
      makeEvent(name, { cwd: cwd(), ...o });
    });

  make("make:listener", ["m:lsn"], "Create an event listener in src/listeners/<name>.listener.ts")
    .option("-e, --event <event>", "The event it handles, e.g. UserCreated (created in src/events/ if missing)")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action((name: string, o) => {
      makeListener(name, { cwd: cwd(), ...o });
    });

  make("make:queue", ["m:q"], "Create a queue (jobs and their handlers) in src/queues/<name>.queue.ts")
    .option("-q, --queue <name>", "Queue name in Redis (default: kebab-case name)")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action((name: string, o) => {
      makeQueue(name, { cwd: cwd(), ...o });
    });

  make("make:worker", ["m:w"], "Create a worker for a queue filled elsewhere in src/workers/<name>.worker.ts")
    .option("-q, --queue <name>", "Queue it consumes (default: kebab-case name)")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action((name: string, o) => {
      makeWorker(name, { cwd: cwd(), ...o });
    });

  make("make:task", ["m:task", "make:scheduler"], "Create a scheduled task in src/tasks/<name>.task.ts")
    .option("--cron <expression>", 'Cron schedule, e.g. "0 3 * * *" (default: hourly)')
    .option("--interval <ms>", "Run every <ms> milliseconds instead of on a cron")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action((name: string, o) => {
      makeTask(name, { cwd: cwd(), ...o });
    });

  make("make:dto", ["m:dto"], "Create a class-validator DTO in src/dtos/<name>.dto.ts")
    .option("--root <dir>", "Folder under src/ to write to (also -rt)")
    .action(async (name: string, o) => {
      await review(o, () => makeDto(name, { cwd: cwd(), ...o }));
    });

  // ── Templates ───────────────────────────────────────────────────────────
  sub("scaffold:domain", "Create the tables (and models or resources) of a domain's templates")
    .alias("sc:domain")
    .argument("[domain]", "e.g. ecommerce, pos, medical (no value: pick one)")
    .option("--only <list>", "Only these templates, e.g. product,order,order_item", parseList)
    .option("--all", "Every template of the domain, without the checklist")
    .option("--resource", "Generate REST resources (DTOs, service, controller), not just models")
    .option("--migrations-only", "Only write the migrations")
    .option("--factory", "Also write a factory for each model")
    .option("--no-deps", "Don't create the tables foreign keys point to")
    .option("-f, --force", "Overwrite the generated models' files")
    .option("-y, --yes", "Don't prompt: take every template (or --only) and their dependencies")
    .addHelpText("after", TEMPLATE_HELP)
    .action(async (domain: string | undefined, o) => {
      await scaffoldDomain(domain, {
        cwd: cwd(),
        only: o.only,
        all: o.all,
        mode: o.migrationsOnly ? "migration" : o.resource ? "resource" : "model",
        factory: o.factory,
        deps: o.deps,
        force: o.force,
        interactive: !o.yes,
      });
    });

  // ── Auth ────────────────────────────────────────────────────────────────
  sub("scaffold:auth", "Add sign-up and sign-in (JWT, API keys or both), optionally with roles and permissions")
    .alias("sc:auth")
    .option("--strategy <strategy>", `How clients sign in: ${AUTH_STRATEGIES.join(", ")} (default: asked, else jwt)`)
    .option("--roles <mode>", `Roles per user: ${ROLE_MODES.join(", ")} (default: asked, else none)`)
    .option("--permissions", "Roles grant permissions")
    .option("--no-permissions", "Roles without permissions")
    .option("-f, --force", "Overwrite the generated auth files")
    .option("-y, --yes", "Don't prompt: use the options given and the defaults")
    .addHelpText(
      "after",
      [
        "",
        "Writes the users table (and roles, user_roles or users.role_id, permissions, api_keys",
        "as chosen) as migrations and models; src/auth/ (password hashing, JWT or API-key helpers,",
        "AppAuthentication, AppAuthorization, rbac.ts); an AuthService, DTOs and an AuthController",
        "(POST /auth/register, POST /auth/login, GET /auth/me, /auth/api-keys); a roles seeder;",
        "and registers them in src/app.ts. An existing users table gets the missing columns.",
      ].join("\n"),
    )
    .action(async (o) => {
      await scaffoldAuth({
        cwd: cwd(),
        strategy: o.strategy,
        roles: o.roles,
        permissions: o.permissions,
        force: o.force,
        interactive: !o.yes,
      });
    });

  sub("scaffold:rbac", "Add roles (one or many per user) and permissions to an app's users")
    .alias("sc:rbac")
    .option("--roles <mode>", "Roles per user: single or multiple (default: asked, else multiple)")
    .option("--permissions", "Roles grant permissions")
    .option("--no-permissions", "Roles without permissions")
    .option("-f, --force", "Overwrite the generated files")
    .option("-y, --yes", "Don't prompt: use the options given and the defaults")
    .action(async (o) => {
      await scaffoldRbac({
        cwd: cwd(),
        roles: o.roles,
        permissions: o.permissions,
        force: o.force,
        interactive: !o.yes,
      });
    });

  sub("template:list", "List the model templates by domain")
    .alias("templates")
    .argument("[domain]", "Show one domain, with each template's columns")
    .option("--json", "Print JSON")
    .action((domain: string | undefined, o) => {
      listTemplates({ cwd: cwd(), domain, json: o.json });
    });

  return { program, exitCode: () => exitCode };
}

const TEMPLATE_HELP = [
  "",
  "Templates describe a table with fields from the fields library, e.g.",
  '  megh make:model Product --template ecommerce/product --fields "barcode?:string(64)"',
  '  megh make:model Ticket --fields "title,body,status:in(open|closed),user_id:cascade"',
  "A field is name[?][:type[(args)]][:modifier]...: a preset (title, slug, price, address, ...),",
  "or a type (string(n), text, integer, money, decimal(p,s), boolean, date, timestamp, json,",
  "foreign(table), ...) with modifiers nullable, unique, index, default(x), in(a|b), cascade,",
  "nullOnDelete, restrict. Columns ending in _id are foreign keys. Tables the foreign keys",
  "point to are created too when no migration creates them. List templates: megh template:list",
].join("\n");

/** The template options shared by make:model and make:resource. */
function templateOptions(o: Record<string, any>) {
  return {
    template: o.template,
    fields: o.fields !== undefined ? parseFieldList(o.fields) : undefined,
    table: o.table,
    force: o.force,
    factory: o.factory,
    deps: o.deps,
    interactive: !o.yes,
  };
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
