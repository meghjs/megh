import "reflect-metadata";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeghApplication } from "../core/application";
import { ApiController } from "../http/controller";
import { Get } from "../http/route-methods";
import { MEGH_LOGO_SVG_BASE64, swaggerUiBranding } from "./branding";

@ApiController("/ping")
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

describe("swaggerUiBranding", () => {
  it("defaults to the Megh logo and favicon", () => {
    const { logo, theme } = swaggerUiBranding();
    expect(logo).toMatchObject({ type: "image/svg+xml" });
    const svg = (logo as { content: Buffer }).content.toString("utf8");
    expect(svg).toMatch(/^<svg[\s\S]*<title>MeghJs<\/title>[\s\S]*<\/svg>$/);
    const [favicon] = theme.favicon;
    expect(favicon).toMatchObject({
      filename: "favicon.ico",
      rel: "icon",
      type: "image/x-icon",
    });
    // ICO header: reserved 0, type 1.
    expect([...favicon.content.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
  });

  it("embeds the same logo and favicon as the docs site", () => {
    const docs = path.resolve(__dirname, "../../../../docs/content/public");
    const { logo, theme } = swaggerUiBranding();
    expect((logo as { content: Buffer }).content.toString("utf8")).toBe(
      fs.readFileSync(path.join(docs, "megh-logo.svg"), "utf8").trim(),
    );
    expect(
      theme.favicon[0].content.equals(
        fs.readFileSync(path.join(docs, "favicon.ico")),
      ),
    ).toBe(true);
  });

  it("keeps the app's own logo and theme", () => {
    const logo = {
      type: "image/png",
      content: "png",
      href: "https://example.com",
    };
    const css = [{ filename: "dark.css", content: "body{}" }];
    const branding = swaggerUiBranding({
      logo,
      theme: { title: "Pets API", css },
    });
    expect(branding.logo).toBe(logo);
    expect(branding.theme).toMatchObject({ title: "Pets API", css });
    expect(branding.theme.favicon).toHaveLength(1);
    expect(swaggerUiBranding({ theme: { favicon: [] } }).theme.favicon).toEqual(
      [],
    );
    expect(swaggerUiBranding({ logo: null }).logo).toBeNull();
  });
});

describe("Swagger UI page", () => {
  let app: MeghApplication;

  beforeEach(() => {
    for (const m of ["log", "warn", "info"] as const)
      vi.spyOn(console, m).mockImplementation(() => {});
  });

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it("shows the Megh logo and favicon", async () => {
    app = MeghApplication.getInternalApp();
    app.useOpenApi({ info: { title: "Test", version: "1.0.0" } });
    app.useControllers([PingController]);
    await app.run(0);

    const init = await app.inject({
      method: "GET",
      url: "/swagger/static/swagger-initializer.js",
    });
    expect(init.statusCode).toBe(200);
    expect(init.body).toContain(
      "data:image/svg+xml;base64," + MEGH_LOGO_SVG_BASE64,
    );

    const html = await app.inject({ method: "GET", url: "/swagger/" });
    expect(html.body).toMatch(/href="\.\/static\/theme\/favicon\.ico"/);
    expect(html.body).not.toContain("favicon-32x32.png");

    const icon = await app.inject({
      method: "GET",
      url: "/swagger/static/theme/favicon.ico",
    });
    expect(icon.statusCode).toBe(200);
    expect(icon.headers["content-type"]).toBe("image/x-icon");
  });
});
