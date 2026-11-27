import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiController,
  AppService,
  Authorized,
  Body,
  Get,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MeghApplication,
  MeghAuthentication,
  Min,
  Param,
  Post,
  Query,
  type IRequest,
} from "@meghjs/core";
import { Tool, ToolSet, aiPlugin } from "../src";

class RefundDto {
  @IsInt()
  @IsNotEmpty()
  @Min(1)
  amount!: number;

  @IsString()
  @IsOptional()
  reason?: string;
}

@AppService
class HeaderAuthentication extends MeghAuthentication {
  async authenticate(req: IRequest) {
    const name = req.headers["x-user"];
    return name ? { name } : null;
  }
}

@AppService
class RequireUser {
  authorize(req: IRequest) {
    return (req as any).user ? req : false;
  }
}

@ApiController("/orders")
class OrderController {
  @Get("/:id")
  @Tool({ description: "Look up one order by its ID.", tags: ["orders"] })
  find(@Param("id") id: string, @Query("expand", { required: false }) expand?: string) {
    return { id, expand: expand ?? null };
  }

  @Post("/:id/refund")
  @Authorized()
  @Tool({ description: "Refund an order.", confirm: true, tags: ["orders", "admin"] })
  refund(@Param("id") id: string, @Body() body: RefundDto) {
    return { refunded: id, amount: body.amount, reason: body.reason ?? null };
  }

  @Get("/")
  @Tool({ name: "big_list", description: "A very long list.", maxOutput: 50 })
  list() {
    return Array.from({ length: 100 }, (_, i) => ({ i }));
  }

  @Get("/hidden/:id")
  notATool(@Param("id") id: string) {
    return { id };
  }
}

const apps: MeghApplication[] = [];

async function boot(setup?: (app: MeghApplication) => void) {
  const app = MeghApplication.getInternalApp({ plugins: [aiPlugin], autoloadPlugins: false });
  app.useErrorLogger(false);
  app.useAuthentication(HeaderAuthentication);
  app.useAuthorization(RequireUser);
  app.useControllers([OrderController]);
  setup?.(app);
  apps.push(app);
  await app.run(0);
  return app;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  vi.restoreAllMocks();
});

describe("tool registry", () => {
  it("lists only @Tool routes, named from the controller and method", async () => {
    const app = await boot();
    const names = app.tools().list().map((t) => t.name).sort();
    expect(names).toEqual(["big_list", "order_find", "order_refund"]);
  });

  it("builds one input schema from path params, query and the body DTO", async () => {
    const app = await boot();
    const refund = app.tools().get("order_refund")!;
    expect(refund.method).toBe("POST");
    expect(refund.confirm).toBe(true);
    expect(refund.readOnly).toBe(false);
    expect(refund.authorized).toBe(true);
    expect(refund.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        amount: { type: "integer" },
        reason: { type: "string" },
      },
    });
    expect(refund.inputSchema.required).toEqual(expect.arrayContaining(["id", "amount"]));
    expect(refund.inputSchema.required).not.toContain("reason");

    const find = app.tools().get("order_find")!;
    expect(Object.keys(find.inputSchema.properties)).toEqual(["id", "expand"]);
  });

  it("filters by tag and name", async () => {
    const app = await boot();
    expect(app.tools({ tags: ["admin"] }).list().map((t) => t.name)).toEqual(["order_refund"]);
    expect(app.tools({ names: ["big_list"] }).list()).toHaveLength(1);
  });

  it("formats tools for Anthropic, OpenAI and MCP", async () => {
    const app = await boot();
    const set = app.tools({ names: ["order_find"] });
    expect(set.forAnthropic()[0]).toEqual({
      name: "order_find",
      description: "Look up one order by its ID.",
      input_schema: set.get("order_find")!.inputSchema,
    });
    expect(set.forOpenAI()[0]).toMatchObject({
      type: "function",
      function: { name: "order_find", parameters: { type: "object" } },
    });
    expect(set.forMcp()[0].annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
  });
});

describe("tools.call", () => {
  it("runs the route with path params and query", async () => {
    const app = await boot();
    const r = await app.tools().call("order_find", { id: "a/b", expand: "items" });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ id: "a/b", expand: "items" });
    expect(JSON.parse(r.content)).toEqual({ id: "a/b", expand: "items" });
  });

  it("refuses a confirm tool that wasn't approved, without running it", async () => {
    const app = await boot();
    const r = await app.tools().call("order_refund", { id: "1", amount: 5 }, {
      headers: { "x-user": "ada" },
    });
    expect(r).toMatchObject({ ok: false, status: 0, needsConfirmation: true });
  });

  it("goes through authentication and @Authorized", async () => {
    const app = await boot();
    const denied = await app.tools().call("order_refund", { id: "1", amount: 5 }, { confirmed: true });
    expect(denied.ok).toBe(false);
    expect(denied.status).toBe(403);

    // Acting for an incoming request forwards its auth headers.
    const request = { headers: { "x-user": "ada" } };
    const allowed = await app
      .tools()
      .call("order_refund", { id: "1", amount: 5 }, { confirmed: true, headers: request.headers });
    expect(allowed).toMatchObject({ ok: true, status: 200, data: { refunded: "1", amount: 5 } });
  });

  it("forwards the configured headers from a request", async () => {
    const app = await boot((a) => a.useTools({ forwardHeaders: ["x-user"] }));
    const r = await app
      .tools()
      .call("order_refund", { id: "2", amount: 3 }, { confirmed: true, request: { headers: { "x-user": "ada" } } });
    expect(r.status).toBe(200);
  });

  it("returns validation errors as a result the model can fix", async () => {
    const app = await boot();
    const r = await app
      .tools()
      .call("order_refund", { id: "1", amount: 0 }, { confirmed: true, headers: { "x-user": "ada" } });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.content).toMatch(/^Error 400: /);
    expect(r.content).toMatch(/amount/);
  });

  it("rejects unknown and missing arguments before calling the route", async () => {
    const app = await boot();
    const unknown = await app.tools().call("order_find", { id: "1", nope: true });
    expect(unknown).toMatchObject({ ok: false, status: 0 });
    expect(unknown.content).toMatch(/unknown argument "nope"/);

    const missing = await app.tools().call("order_find", {});
    expect(missing.content).toMatch(/missing required argument "id"/);

    expect((await app.tools().call("nope", {})).content).toMatch(/Unknown tool/);
  });

  it("caps the output sent to the model", async () => {
    const app = await boot();
    const r = await app.tools().call("big_list", {});
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.content).toMatch(/^.{50}\n\[truncated: \d+ more characters\]$/s);
    expect(r.data).toHaveLength(100);
  });

  it("runs Anthropic tool_use blocks and OpenAI tool calls", async () => {
    const app = await boot();
    const tools = app.tools();
    const results = await tools.anthropicResults([
      { type: "text" },
      { type: "tool_use", id: "tu_1", name: "order_find", input: { id: "7" } },
      { type: "tool_use", id: "tu_2", name: "order_refund", input: { id: "7", amount: 1 } },
    ]);
    expect(results).toEqual([
      { type: "tool_result", tool_use_id: "tu_1", content: '{"id":"7","expand":null}', is_error: false },
      expect.objectContaining({ tool_use_id: "tu_2", is_error: true }),
    ]);

    const messages = await tools.openAIResults([
      { id: "c1", function: { name: "order_find", arguments: '{"id":"8"}' } },
      { id: "c2", function: { name: "order_find", arguments: "{oops" } },
    ]);
    expect(messages[0]).toEqual({ role: "tool", tool_call_id: "c1", content: '{"id":"8","expand":null}' });
    expect(messages[1].content).toMatch(/not valid JSON/);
  });
});

describe("ToolSet injection", () => {
  it("injects the app's tools into a controller, narrowed with filter()", async () => {
    @ApiController("/assistant")
    class AssistantController {
      constructor(private readonly tools: ToolSet) {}

      @Get("/tools")
      names() {
        return this.tools.filter({ tags: ["orders"] }).list().map((t) => t.name);
      }

      @Get("/ask/:id")
      async ask(@Param("id") id: string) {
        const r = await this.tools.call("order_find", { id });
        return r.data;
      }
    }
    const app = await boot((a) => a.useControllers([OrderController, AssistantController]));
    expect(app.tools().filter({ tags: ["orders"] }).filter({ tags: ["admin"] }).list().map((t) => t.name)).toEqual([
      "order_refund",
    ]);
    expect((await app.inject({ url: "/assistant/tools" })).json()).toEqual(["order_find", "order_refund"]);
    expect((await app.inject({ url: "/assistant/ask/9" })).json()).toEqual({ id: "9", expand: null });
  });
});

describe("@Tool checks", () => {
  it("needs a description", () => {
    expect(() => Tool({ description: " " })).toThrow(/needs a description/);
  });

  it("refuses an invalid name", () => {
    expect(() => Tool({ name: "has space", description: "x" })).toThrow(/Invalid tool name/);
  });

  it("refuses two tools with the same name", async () => {
    @ApiController("/dup")
    class DupController {
      @Get("/a")
      @Tool({ name: "same", description: "a" })
      a() {
        return 1;
      }
      @Get("/b")
      @Tool({ name: "same", description: "b" })
      b() {
        return 2;
      }
    }
    const app = MeghApplication.getInternalApp({ plugins: [aiPlugin], autoloadPlugins: false });
    app.useErrorLogger(false);
    app.useControllers([DupController]);
    apps.push(app);
    await expect(app.run(0)).rejects.toThrow(/Two tools are named "same"/);
  });
});
