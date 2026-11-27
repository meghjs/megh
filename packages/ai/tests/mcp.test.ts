import "reflect-metadata";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  ApiController,
  AppService,
  Authorized,
  Body,
  Get,
  IsInt,
  IsNotEmpty,
  MeghApplication,
  MeghAuthentication,
  Param,
  Post,
  type IRequest,
} from "@meghjs/core";
import { Tool, aiPlugin, type McpOptions } from "../src";

class RefundDto {
  @IsInt()
  @IsNotEmpty()
  amount!: number;
}

/** `authorization: Bearer <name>` signs in as <name>. */
@AppService
class BearerAuthentication extends MeghAuthentication {
  async authenticate(req: IRequest) {
    const header = req.headers.authorization;
    return typeof header === "string" && header.startsWith("Bearer ") ? { name: header.slice(7) } : null;
  }
}

@AppService
class RequireUser {
  authorize(req: IRequest) {
    return (req as any).user ? req : false;
  }
}

const refunds: string[] = [];

@ApiController("/shop")
class ShopController {
  @Get("/products/:id")
  @Tool({ description: "Look up a product by its ID.", tags: ["public"] })
  product(@Param("id") id: string) {
    return { id, name: `Product ${id}` };
  }

  @Get("/me")
  @Authorized()
  @Tool({ description: "The signed-in user.", tags: ["public"] })
  me(@MeghRequestUser() user: any) {
    return user;
  }

  @Post("/orders/:id/refund")
  @Authorized()
  @Tool({ description: "Refund an order.", confirm: true, tags: ["public"] })
  refund(@Param("id") id: string, @Body() body: RefundDto) {
    refunds.push(id);
    return { refunded: id, amount: body.amount };
  }

  @Get("/internal")
  @Tool({ description: "Internal only.", tags: ["internal"] })
  internal() {
    return { secret: true };
  }
}

// @AuthUser() is the request user.
import { AuthUser as MeghRequestUser } from "@meghjs/core";

const apps: MeghApplication[] = [];
const clients: Client[] = [];

async function boot(options: McpOptions) {
  const app = MeghApplication.getInternalApp({ plugins: [aiPlugin], autoloadPlugins: false });
  app.useErrorLogger(false);
  app.useAuthentication(BearerAuthentication);
  app.useAuthorization(RequireUser);
  app.useControllers([ShopController]);
  app.useMcp(options);
  apps.push(app);
  await app.run(0);
  const { port } = app.address() as AddressInfo;
  return { app, url: new URL(`http://127.0.0.1:${port}${options.path ?? "/mcp"}`) };
}

async function connect(
  url: URL,
  opts: { token?: string; approve?: boolean | "decline" } = {},
): Promise<Client> {
  const client = new Client(
    { name: "test", version: "0.0.0" },
    opts.approve !== undefined ? { capabilities: { elicitation: {} } } : {},
  );
  if (opts.approve !== undefined) {
    client.setRequestHandler(ElicitRequestSchema, async () =>
      opts.approve === "decline"
        ? { action: "decline" as const }
        : { action: "accept" as const, content: { approve: opts.approve as boolean } },
    );
  }
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: opts.token ? { headers: { authorization: `Bearer ${opts.token}` } } : undefined,
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

const text = (r: any) => (r.content as { text: string }[]).map((c) => c.text).join("\n");

beforeEach(() => {
  refunds.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await Promise.all(apps.splice(0).map((a) => a.close()));
  vi.restoreAllMocks();
});

describe("app.useMcp", () => {
  it("serves only the tools it was given, with MCP annotations", async () => {
    const { url } = await boot({ tools: { tags: ["public"] } });
    const client = await connect(url);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["shop_me", "shop_product", "shop_refund"]);
    const refund = tools.find((t) => t.name === "shop_refund")!;
    expect(refund.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
    expect(refund.inputSchema).toMatchObject({ type: "object", required: expect.arrayContaining(["id", "amount"]) });
  });

  it("runs a tool and returns its response", async () => {
    const { url } = await boot({ tools: { tags: ["public"] } });
    const client = await connect(url);
    const r = await client.callTool({ name: "shop_product", arguments: { id: "7" } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(text(r))).toEqual({ id: "7", name: "Product 7" });
  });

  it("runs each tool as the MCP caller, through the route's own authorization", async () => {
    const { url } = await boot({ tools: { tags: ["public"] } });
    const anonymous = await connect(url);
    const denied = await anonymous.callTool({ name: "shop_me", arguments: {} });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/^Error 403/);

    const ada = await connect(url, { token: "ada" });
    const me = await ada.callTool({ name: "shop_me", arguments: {} });
    expect(JSON.parse(text(me))).toEqual({ name: "ada" });
  });

  it("protects the endpoint itself with authorize", async () => {
    const { url } = await boot({ tools: "all", authorize: true });
    await expect(connect(url)).rejects.toThrow(/403/);
    const client = await connect(url, { token: "ada" });
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("shop_internal");
  });

  it("asks the user before a confirm tool runs (elicitation)", async () => {
    const { url } = await boot({ tools: { tags: ["public"] } });
    const yes = await connect(url, { token: "ada", approve: true });
    const ok = await yes.callTool({ name: "shop_refund", arguments: { id: "1", amount: 5 } });
    expect(JSON.parse(text(ok))).toEqual({ refunded: "1", amount: 5 });

    const no = await connect(url, { token: "ada", approve: "decline" });
    const declined = await no.callTool({ name: "shop_refund", arguments: { id: "2", amount: 5 } });
    expect(declined.isError).toBe(true);
    expect(text(declined)).toMatch(/did not approve/);

    const plain = await connect(url, { token: "ada" });
    const cannot = await plain.callTool({ name: "shop_refund", arguments: { id: "3", amount: 5 } });
    expect(text(cannot)).toMatch(/can't ask for it/);

    expect(refunds).toEqual(["1"]);
  });

  it("leaves approval to the client with confirm: 'client'", async () => {
    const { url } = await boot({ tools: { tags: ["public"] }, confirm: "client" });
    const client = await connect(url, { token: "ada" });
    const r = await client.callTool({ name: "shop_refund", arguments: { id: "4", amount: 1 } });
    expect(r.isError).toBeFalsy();
    expect(refunds).toEqual(["4"]);
  });

  it("leaves confirm tools out with confirm: 'refuse'", async () => {
    const { url } = await boot({ tools: { tags: ["public"] }, confirm: "refuse" });
    const client = await connect(url, { token: "ada" });
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain("shop_refund");
    const r = await client.callTool({ name: "shop_refund", arguments: { id: "5", amount: 1 } });
    expect(text(r)).toMatch(/Unknown tool/);
  });

  it("refuses requests without a session, or with someone else's session", async () => {
    const { url } = await boot({ tools: "all", path: "/ai/mcp" });
    const list = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    expect((await fetch(url, { method: "POST", headers, body: list })).status).toBe(400);
    expect((await fetch(url, { method: "POST", headers: { ...headers, "mcp-session-id": "nope" }, body: list })).status).toBe(404);

    // Ada opens a session; the same session ID with Bob's token is refused.
    const init = await fetch(url, {
      method: "POST",
      headers: { ...headers, authorization: "Bearer ada" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
      }),
    });
    const sid = init.headers.get("mcp-session-id")!;
    expect(sid).toBeTruthy();
    await init.text();
    const stolen = await fetch(url, {
      method: "POST",
      headers: { ...headers, authorization: "Bearer bob", "mcp-session-id": sid, "mcp-protocol-version": "2025-06-18" },
      body: list,
    });
    expect(stolen.status).toBe(403);
  });

  it("runs stateless with sessions: false", async () => {
    const { url } = await boot({ tools: { tags: ["public"] }, sessions: false, confirm: "client" });
    const client = await connect(url, { token: "ada" });
    const me = await client.callTool({ name: "shop_me", arguments: {} });
    expect(JSON.parse(text(me))).toEqual({ name: "ada" });
    expect((await fetch(url)).status).toBe(405);
  });

  it("checks its options, and can only be set up once", () => {
    const app = MeghApplication.getInternalApp({ plugins: [aiPlugin], autoloadPlugins: false });
    apps.push(app);
    expect(() => app.useMcp({} as any)).toThrow(/needs tools/);
    expect(() => app.useMcp({ tools: "all", sessions: false })).toThrow(/can't ask the user/);
    app.useMcp({ tools: "all" });
    expect(() => app.useMcp({ tools: "all" })).toThrow(/only be called once/);
  });
});
