import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runCli } from "../src/program";
import { makeResource } from "../src/generators/make";
import { readModelSchema } from "../src/generators/resource";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "megh-resource-"));
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "x" }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const read = (...p: string[]) => fs.readFileSync(path.join(tmp, ...p), "utf8");
const exists = (...p: string[]) => fs.existsSync(path.join(tmp, ...p));
const writeFile = (rel: string, content: string) => {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const CREATE_USERS = `import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("users")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("email", "varchar(255)", (col) => col.notNull().unique())
    .addColumn("bio", "text")
    .addColumn("age", "integer")
    .addColumn("rating", "decimal(3, 1)")
    .addColumn("is_admin", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("born_on", "date")
    .addColumn("settings", "json")
    .addColumn("created_at", "timestamp", (col) => col.notNull().defaultTo(sql\`CURRENT_TIMESTAMP\`))
    .addColumn("updated_at", "timestamp", (col) => col.notNull().defaultTo(sql\`CURRENT_TIMESTAMP\`))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("users").execute();
}
`;

const usersMigration = () => writeFile("src/database/migrations/20260101000000_create_users_table.ts", CREATE_USERS);

/** The body of `class <name> { ... }` in a file. */
const classBody = (source: string, name: string) => source.split(`class ${name} {`)[1].split(/\n}\n/)[0];

describe("make:resource from a migration", () => {
  beforeEach(usersMigration);

  it("writes the model, DTOs, service and controller", () => {
    const files = makeResource("user", { cwd: tmp }).map((f) => path.relative(tmp, f).split(path.sep).join("/"));
    expect(files).toEqual([
      "src/models/user.model.ts",
      "src/dtos/user.dto.ts",
      "src/services/user.service.ts",
      "src/controllers/user.controller.ts",
    ]);
    expect(read("src", "models", "user.model.ts")).toContain('static readonly table = "users";');
  });

  it("validates the writable columns in the DTOs", () => {
    makeResource("user", { cwd: tmp });
    const dto = read("src", "dtos", "user.dto.ts");
    const create = classBody(dto, "CreateUserDto");
    // Generated key and timestamps are never sent.
    expect(create).not.toMatch(/\bid[!?]:|created_at|updated_at/);
    expect(create).toContain("@IsString()\n  name!: string;");
    expect(create).toContain("@IsEmail()\n  @MaxLength(255)\n  email!: string;");
    expect(create).toContain("@IsOptional()\n  @IsString()\n  bio?: string | null;");
    expect(create).toContain("@IsOptional()\n  @IsInt()\n  age?: number | null;");
    expect(create).toContain("@IsOptional()\n  @IsNumber()\n  rating?: number | null;");
    // A column with a default may be left out.
    expect(create).toContain("@IsOptional()\n  @IsBoolean()\n  is_admin?: boolean;");
    expect(create).toContain("@Type(() => Date)\n  @IsDate()\n  born_on?: Date | null;");
    expect(create).toContain("@IsObject()\n  settings?: Record<string, unknown> | null;");

    const update = classBody(dto, "UpdateUserDto");
    expect(update).toContain("@IsOptional()\n  @IsString()\n  name?: string;");
    expect(update).not.toContain("!:");
    expect(dto).toContain("export class ListUsersQuery");
    expect(dto).toMatch(/import \{ [^}]*IsEmail[^}]*IsObject[^}]* \} from 'class-validator';/);
  });

  it("writes a Megh ORM service and a typed controller", () => {
    makeResource("user", { cwd: tmp });
    const service = read("src", "services", "user.service.ts");
    expect(service).toContain("import { User } from '../models/user.model';");
    expect(service).toContain("return User.query().orderBy('id').paginate(request);");
    expect(service).toContain("create(input: CreateInput<typeof User>)");
    expect(service).toContain("return user.fill(sent).save();");
    expect(service).toContain("await user.delete();");

    const ctrl = read("src", "controllers", "user.controller.ts");
    expect(ctrl).toContain("@ApiController('/users')");
    expect(ctrl).toContain("index(@Query() query: ListUsersQuery)");
    expect(ctrl).toContain("create(@Body() body: CreateUserDto)");
    expect(ctrl).toContain("@Put('/:id')\n  update(@Param('id') id: number, @Body() body: UpdateUserDto)");
    expect(ctrl).toContain("this.userService.findOrFail(Number(id))");
    expect(ctrl).not.toContain("@Patch");
  });

  it("supports nested names and irregular plurals", () => {
    writeFile(
      "src/database/migrations/20260102000000_create_categories_table.ts",
      `export async function up(db) {
  await db.schema.createTable("categories").addColumn("id", "integer", (c) => c.primaryKey()).addColumn("name", "text").execute();
}`,
    );
    makeResource("admin/Category", { cwd: tmp });
    const ctrl = read("src", "controllers", "admin", "category.controller.ts");
    expect(ctrl).toContain("@ApiController('/admin/categories')");
    expect(ctrl).toContain("from '../../dtos/admin/category.dto'");
    expect(read("src", "dtos", "admin", "category.dto.ts")).toContain("class ListCategoriesQuery");
  });

  it("reads another table with --table", () => {
    makeResource("member", { cwd: tmp, table: "users" });
    expect(read("src", "models", "member.model.ts")).toContain('static readonly table = "users";');
    expect(read("src", "dtos", "member.dto.ts")).toContain("email!: string;");
  });

  it("refuses to overwrite and writes nothing; --force overwrites", () => {
    writeFile("src/services/user.service.ts", "// mine");
    expect(() => makeResource("user", { cwd: tmp })).toThrow(/Already exists: src\/services\/user\.service\.ts/);
    expect(exists("src", "models", "user.model.ts")).toBe(false);
    expect(exists("src", "controllers")).toBe(false);
    makeResource("user", { cwd: tmp, force: true });
    expect(read("src", "services", "user.service.ts")).toContain("class UserService");
  });
});

describe("make:resource with an existing model", () => {
  it("reuses the model, skipping statics, relations and methods", () => {
    usersMigration();
    const model = `import { Model, hasMany } from "@meghjs/core";
import { Post } from "./post.model";

export class User extends Model {
  static readonly table = "users";
  static readonly generated = ["id", "is_admin"] as const;
  static readonly timestamps = true;
  static readonly casts = {
    is_admin: "boolean",
  } as const;

  id!: number;
  name!: string;
  email!: string;
  nickname!: string | null; // not in the migration
  is_admin!: boolean;
  created_at!: Date;
  updated_at!: Date;

  posts = hasMany(() => Post);

  greet(): string {
    const label: string = this.name;
    return label;
  }
}
`;
    writeFile("src/models/user.model.ts", model);
    makeResource("User", { cwd: tmp });
    expect(read("src", "models", "user.model.ts")).toBe(model);
    const create = classBody(read("src", "dtos", "user.dto.ts"), "CreateUserDto");
    expect(create.match(/^\s+\w+[!?]:/gm)!.map((l) => l.trim().slice(0, -2))).toEqual([
      "name",
      "email",
      "nickname",
      "is_admin",
    ]);
    // The migration still supplies the column's length.
    expect(create).toContain("@MaxLength(255)\n  email!: string;");
  });

  it("works without a migration when the model exists", () => {
    writeFile(
      "src/models/token.model.ts",
      `import { Model } from "@meghjs/core";
export class Token extends Model {
  static readonly primaryKey = "uuid";
  static readonly generated = [] as const;

  uuid!: string;
  label!: string;
}
`,
    );
    makeResource("token", { cwd: tmp });
    const create = classBody(read("src", "dtos", "token.dto.ts"), "CreateTokenDto");
    // A key that is not generated is sent by the client.
    expect(create).toContain("@IsString()\n  uuid!: string;");
    expect(read("src", "services", "token.service.ts")).toContain("orderBy('uuid')");
    const ctrl = read("src", "controllers", "token.controller.ts");
    expect(ctrl).toContain("show(@Param('id') id: string)");
    expect(ctrl).toContain("this.tokenService.findOrFail(id)");
  });

  it("uses the TypeORM service for an @Entity model, without DTOs", () => {
    writeFile(
      "src/models/order.model.ts",
      `import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'orders' })
export class Order {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    nullable: true,
  })
  note!: string;
}
`,
    );
    makeResource("order", { cwd: tmp });
    expect(read("src", "services", "order.service.ts")).toContain("@InjectRepository(Order)");
    expect(read("src", "controllers", "order.controller.ts")).toContain("@ApiController('/orders')");
    expect(exists("src", "dtos")).toBe(false);
  });
});

describe("readModelSchema", () => {
  it("reads TypeORM columns, with multi-line decorators", () => {
    const schema = readModelSchema(`@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    nullable: true,
  })
  note!: string;

  @Column()
  total!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => User)
  user!: User;
}`);
    expect(schema).toMatchObject({ kind: "typeorm", table: "orders", primaryKey: "id", primaryKeyType: "string" });
    expect(schema.inputFields.map((f) => [f.name, f.nullable])).toEqual([
      ["note", true],
      ["total", false],
    ]);
  });
});

describe("make:resource errors and CLI", () => {
  it("fails with a hint when there is no model and no migration, writing nothing", async () => {
    expect(() => makeResource("widget", { cwd: tmp })).toThrow(/megh make:migration create_widgets_table/);
    expect(exists("src")).toBe(false);
    expect(await runCli(["make:resource", "widget"], { cwd: tmp })).toBe(1);
  });

  it("runs as make:resource and its m:r alias", async () => {
    usersMigration();
    expect(await runCli(["make:resource", "user"], { cwd: tmp })).toBe(0);
    expect(await runCli(["m:r", "user", "-f"], { cwd: tmp })).toBe(0);
    expect(exists("src", "controllers", "user.controller.ts")).toBe(true);
  });

  it("leaves no unrendered placeholders", () => {
    usersMigration();
    makeResource("user", { cwd: tmp });
    for (const dir of ["models", "dtos", "services", "controllers"]) {
      for (const file of fs.readdirSync(path.join(tmp, "src", dir))) {
        expect(read("src", dir, file)).not.toMatch(/\{[A-Za-z]+\}/);
      }
    }
  });
});
