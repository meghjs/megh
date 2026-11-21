import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { LoggerService } from "../observability/logger";
import {
  ArrayTransport,
  FailoverTransport,
  Mailable,
  MailError,
  Mailer,
  MailTransportError,
  MailgunTransport,
  PostmarkTransport,
  ResendTransport,
  SendGridTransport,
  mailConfigFromEnv,
  resolveMailConfig,
  type MailAttachment,
  type MailMessage,
} from "./index";
import { attachmentBytes, formatAddress } from "./http-transports";
import { buildMessage } from "./mailer";
import { toNodemailerMessage } from "./transports";

type Call = { url: string; init: RequestInit };
let calls: Call[];
let reply: () => Response | Promise<Response>;

beforeEach(async () => {
  await Mailer.reset();
  calls = [];
  reply = () => new Response("{}", { status: 200 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return reply();
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Mailer.reset();
});

const json = () => JSON.parse(String(calls[0].init.body));
const headers = () => calls[0].init.headers as Record<string, string>;

class InvoiceMail extends Mailable {
  envelope() {
    return {
      subject: "Your invoice",
      replyTo: "Billing <billing@x.io>",
      headers: { "X-Tag": "invoice" },
    };
  }
  content() {
    return { html: "<p>Attached <img src='cid:logo'></p>", text: "Attached" };
  }
  attachments(): MailAttachment[] {
    return [
      { filename: "invoice.pdf", content: Buffer.from("PDF") },
      { filename: "logo.png", content: Buffer.from("PNG"), cid: "logo" },
    ];
  }
}

async function message(): Promise<MailMessage> {
  return buildMessage(
    new InvoiceMail(),
    {
      to: [{ name: "Lee, Ann", address: "ann@x.io" }],
      cc: [{ address: "lead@x.io" }],
      bcc: [{ address: "ANN@x.io" }, { address: "audit@x.io" }],
    },
    "Shop <shop@x.io>",
  );
}

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("SendGrid", () => {
  it("posts the v3 mail/send shape", async () => {
    reply = () =>
      new Response(null, { status: 202, headers: { "X-Message-Id": "sg-1" } });
    const result = await new SendGridTransport({
      transport: "sendgrid",
      apiKey: "SG.key",
    }).send(await message());

    expect(calls[0].url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(headers().Authorization).toBe("Bearer SG.key");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(json()).toEqual({
      personalizations: [
        {
          to: [{ email: "ann@x.io", name: "Lee, Ann" }],
          cc: [{ email: "lead@x.io" }],
          // ANN@x.io is already in `to`; SendGrid would reject it.
          bcc: [{ email: "audit@x.io" }],
        },
      ],
      from: { email: "shop@x.io", name: "Shop" },
      reply_to: { email: "billing@x.io", name: "Billing" },
      subject: "Your invoice",
      content: [
        { type: "text/plain", value: "Attached" },
        { type: "text/html", value: "<p>Attached <img src='cid:logo'></p>" },
      ],
      headers: { "X-Tag": "invoice" },
      attachments: [
        {
          content: b64("PDF"),
          filename: "invoice.pdf",
          type: "application/pdf",
        },
        {
          content: b64("PNG"),
          filename: "logo.png",
          type: "image/png",
          disposition: "inline",
          content_id: "logo",
        },
      ],
    });
    expect(result.messageId).toBe("sg-1");
  });

  it("uses reply_to_list for several reply-to addresses, and a custom endpoint", async () => {
    const m = await message();
    m.replyTo.push({ address: "help@x.io" });
    await new SendGridTransport({
      transport: "sendgrid",
      apiKey: "k",
      endpoint: "https://api.eu.sendgrid.com/",
    }).send(m);
    expect(calls[0].url).toBe("https://api.eu.sendgrid.com/v3/mail/send");
    expect(json().reply_to).toBeUndefined();
    expect(json().reply_to_list).toEqual([
      { email: "billing@x.io", name: "Billing" },
      { email: "help@x.io" },
    ]);
  });

  it("reports a rejection with its status and body", async () => {
    reply = () =>
      new Response("{\"errors\":[{\"message\":\"bad from\"}]}", { status: 400 });
    const err = await new SendGridTransport({
      transport: "sendgrid",
      apiKey: "k",
    })
      .send(await message())
      .catch((e) => e);
    expect(err).toBeInstanceOf(MailTransportError);
    expect(err).toMatchObject({ provider: "SendGrid", status: 400 });
    expect(err.body).toContain("bad from");
    expect(err.message).toContain("SendGrid rejected the message (HTTP 400)");
  });

  it("reports a network failure", async () => {
    reply = () => {
      throw new TypeError("fetch failed");
    };
    await expect(
      new SendGridTransport({ transport: "sendgrid", apiKey: "k" }).send(
        await message(),
      ),
    ).rejects.toThrow("SendGrid could not be reached: fetch failed");
  });
});

describe("Mailgun", () => {
  it("posts form data with one field per address", async () => {
    reply = () => Response.json({ id: "<mg-1@mg.x.io>", message: "Queued" });
    const result = await new MailgunTransport({
      transport: "mailgun",
      apiKey: "mg-key",
      domain: "mg.x.io",
      endpoint: "https://api.eu.mailgun.net",
    }).send(await message());

    expect(calls[0].url).toBe("https://api.eu.mailgun.net/v3/mg.x.io/messages");
    expect(headers().Authorization).toBe(`Basic ${b64("api:mg-key")}`);
    const form = calls[0].init.body as FormData;
    expect(form.get("from")).toBe("Shop <shop@x.io>");
    expect(form.getAll("to")).toEqual(["\"Lee, Ann\" <ann@x.io>"]);
    expect(form.getAll("bcc")).toEqual(["ANN@x.io", "audit@x.io"]);
    expect(form.get("subject")).toBe("Your invoice");
    expect(form.get("text")).toBe("Attached");
    expect(form.get("h:Reply-To")).toBe("Billing <billing@x.io>");
    expect(form.get("h:X-Tag")).toBe("invoice");

    const file = form.get("attachment") as File;
    expect(file.name).toBe("invoice.pdf");
    expect(file.type).toBe("application/pdf");
    expect(await file.text()).toBe("PDF");
    expect((form.get("inline") as File).name).toBe("logo"); // the cid
    expect(result.messageId).toBe("<mg-1@mg.x.io>");
  });
});

describe("Postmark", () => {
  it("posts the email shape", async () => {
    reply = () =>
      Response.json({ ErrorCode: 0, Message: "OK", MessageID: "pm-1" });
    const result = await new PostmarkTransport({
      transport: "postmark",
      token: "pm-token",
      messageStream: "outbound",
    }).send(await message());

    expect(calls[0].url).toBe("https://api.postmarkapp.com/email");
    expect(headers()["X-Postmark-Server-Token"]).toBe("pm-token");
    expect(json()).toEqual({
      From: "Shop <shop@x.io>",
      To: "\"Lee, Ann\" <ann@x.io>",
      Cc: "lead@x.io",
      Bcc: "ANN@x.io, audit@x.io",
      ReplyTo: "Billing <billing@x.io>",
      Subject: "Your invoice",
      HtmlBody: "<p>Attached <img src='cid:logo'></p>",
      TextBody: "Attached",
      Headers: [{ Name: "X-Tag", Value: "invoice" }],
      MessageStream: "outbound",
      Attachments: [
        {
          Name: "invoice.pdf",
          Content: b64("PDF"),
          ContentType: "application/pdf",
        },
        {
          Name: "logo.png",
          Content: b64("PNG"),
          ContentType: "image/png",
          ContentID: "cid:logo",
        },
      ],
    });
    expect(result.messageId).toBe("pm-1");
  });

  it("treats a non-zero ErrorCode as a failure, and a 422 too", async () => {
    const send = async () =>
      new PostmarkTransport({ transport: "postmark", token: "t" }).send(
        await message(),
      );
    reply = () =>
      Response.json({ ErrorCode: 406, Message: "Inactive recipient" });
    await expect(send()).rejects.toThrow(
      "Postmark rejected the message (error 406): Inactive recipient",
    );
    reply = () =>
      Response.json(
        { ErrorCode: 400, Message: "Sender signature" },
        { status: 422 },
      );
    await expect(send()).rejects.toThrow(/HTTP 422/);
  });
});

describe("Resend", () => {
  it("posts the emails shape", async () => {
    reply = () => Response.json({ id: "re-1" });
    const result = await new ResendTransport({
      transport: "resend",
      apiKey: "re_key",
    }).send(await message());
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(headers().Authorization).toBe("Bearer re_key");
    expect(json()).toEqual({
      from: "Shop <shop@x.io>",
      to: ["\"Lee, Ann\" <ann@x.io>"],
      cc: ["lead@x.io"],
      bcc: ["ANN@x.io", "audit@x.io"],
      reply_to: ["Billing <billing@x.io>"],
      subject: "Your invoice",
      html: "<p>Attached <img src='cid:logo'></p>",
      text: "Attached",
      headers: { "X-Tag": "invoice" },
      attachments: [
        { filename: "invoice.pdf", content: b64("PDF") },
        { filename: "logo.png", content: b64("PNG"), content_id: "logo" },
      ],
    });
    expect(result.messageId).toBe("re-1");
  });
});

describe("attachments and addresses", () => {
  it("reads attachment bytes from content, base64, a file or a URL", async () => {
    expect(String(await attachmentBytes({ content: "hi" }))).toBe("hi");
    expect(
      String(await attachmentBytes({ content: b64("hi"), encoding: "base64" })),
    ).toBe("hi");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "megh-mail-"));
    const file = path.join(dir, "terms.txt");
    fs.writeFileSync(file, "Be nice.");
    try {
      expect(String(await attachmentBytes({ path: file }))).toBe("Be nice.");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    reply = () => new Response("remote");
    expect(
      String(await attachmentBytes({ path: "https://cdn.x.io/a.txt" })),
    ).toBe("remote");
    reply = () => new Response("", { status: 404 });
    await expect(
      attachmentBytes({ path: "https://cdn.x.io/b.txt" }),
    ).rejects.toThrow(/HTTP 404/);
    await expect(attachmentBytes({ filename: "x.txt" })).rejects.toThrow(
      "Attachment x.txt has neither content nor path.",
    );
  });

  it("names a path attachment after its file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "megh-mail-"));
    const file = path.join(dir, "report.csv");
    fs.writeFileSync(file, "a,b");
    try {
      const m = await message();
      m.attachments = [{ path: file }];
      await new ResendTransport({ transport: "resend", apiKey: "k" }).send(m);
      expect(json().attachments).toEqual([
        { filename: "report.csv", content: b64("a,b") },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("quotes display names that need it", () => {
    expect(formatAddress({ address: "a@x.io" })).toBe("a@x.io");
    expect(formatAddress({ name: "Ann", address: "a@x.io" })).toBe(
      "Ann <a@x.io>",
    );
    expect(formatAddress({ name: "Lee, Ann", address: "a@x.io" })).toBe(
      "\"Lee, Ann\" <a@x.io>",
    );
    expect(formatAddress({ name: "Ann \"A\"", address: "a@x.io" })).toBe(
      "\"Ann \\\"A\\\"\" <a@x.io>",
    );
  });
});

describe("provider settings", () => {
  const env = (vars: Record<string, string>) =>
    mailConfigFromEnv((k) => vars[k]);

  it("reads the providers' MEGH_MAIL_* variables", () => {
    const { mailers } = env({
      MEGH_MAIL_SENDGRID_API_KEY: "sg",
      MEGH_MAIL_MAILGUN_API_KEY: "mg",
      MEGH_MAIL_MAILGUN_DOMAIN: "mg.x.io",
      MEGH_MAIL_MAILGUN_ENDPOINT: "https://api.eu.mailgun.net",
      MEGH_MAIL_POSTMARK_TOKEN: "pm",
      MEGH_MAIL_POSTMARK_MESSAGE_STREAM: "outbound",
      MEGH_MAIL_RESEND_API_KEY: "re",
      MEGH_MAIL_FAILOVER: "sendgrid, smtp",
    });
    expect(mailers).toMatchObject({
      sendgrid: { transport: "sendgrid", apiKey: "sg" },
      mailgun: {
        transport: "mailgun",
        apiKey: "mg",
        domain: "mg.x.io",
        endpoint: "https://api.eu.mailgun.net",
      },
      postmark: {
        transport: "postmark",
        token: "pm",
        messageStream: "outbound",
      },
      resend: { transport: "resend", apiKey: "re" },
      failover: { transport: "failover", mailers: ["sendgrid", "smtp"] },
    });
  });

  it("fails at startup when the default mailer lacks a setting", () => {
    expect(() => resolveMailConfig({ default: "sendgrid" }, env({}))).toThrow(
      "The default mailer \"sendgrid\" needs an API key: set MEGH_MAIL_SENDGRID_API_KEY or apiKey.",
    );
    expect(() =>
      resolveMailConfig(
        { default: "mailgun" },
        env({ MEGH_MAIL_MAILGUN_API_KEY: "k" }),
      ),
    ).toThrow(/needs a domain: set MEGH_MAIL_MAILGUN_DOMAIN/);
    expect(() => resolveMailConfig({ default: "smtp" }, env({}))).toThrow(
      /needs a host/,
    );
    expect(() =>
      resolveMailConfig(
        {
          default: "x",
          mailers: { x: { transport: "carrier-pigeon" } as any },
        },
        env({}),
      ),
    ).toThrow(/unknown transport "carrier-pigeon"/);
    // Mailers other than the default are checked when first used.
    expect(resolveMailConfig({ default: "log" }, env({})).default).toBe("log");
  });

  it("merges a mailer's options over its .env settings", () => {
    const { mailers } = resolveMailConfig(
      {
        default: "log",
        mailers: {
          sendgrid: {
            transport: "sendgrid",
            endpoint: "https://api.eu.sendgrid.com",
          },
          // A different transport under the same name replaces it.
          mailgun: { transport: "resend", apiKey: "re" },
        },
      },
      env({
        MEGH_MAIL_SENDGRID_API_KEY: "sg",
        MEGH_MAIL_MAILGUN_API_KEY: "mg",
      }),
    );
    expect(mailers.sendgrid).toEqual({
      transport: "sendgrid",
      apiKey: "sg",
      endpoint: "https://api.eu.sendgrid.com",
    });
    expect(mailers.mailgun).toEqual({ transport: "resend", apiKey: "re" });
  });

  it("checks a failover default's list", () => {
    const resolve = (mailers: string[], extra = {}) =>
      resolveMailConfig(
        {
          default: "f",
          mailers: { f: { transport: "failover", mailers }, ...extra },
        },
        env({}),
      );
    expect(() => resolve([])).toThrow(/needs a list of mailers to try/);
    expect(() => resolve(["nope"])).toThrow(
      /lists "nope", which is not configured/,
    );
    expect(() =>
      resolve(["g"], { g: { transport: "failover", mailers: ["log"] } }),
    ).toThrow(/another failover mailer/);
    expect(() => resolve(["sendgrid", "log"])).toThrow(
      /"f" lists "sendgrid" needs an API key/,
    );
    expect(resolve(["log", "array"]).default).toBe("f");
  });

  it("checks a non-default mailer when it is first used", async () => {
    Mailer.configure({ default: "array", from: "h@x.io" });
    await expect(
      new Mailer().mailer("postmark").to("a@x.io").send(new InvoiceMail()),
    ).rejects.toThrow("The mailer \"postmark\" needs a server token");
  });
});

describe("failover", () => {
  const failing = (why: string) => ({
    send: vi.fn(async () => {
      throw new Error(why);
    }),
  });

  it("sends through the next mailer when one fails, and logs it", async () => {
    const warn = vi.fn();
    const info = vi.fn();
    vi.spyOn(LoggerService, "child").mockReturnValue({ warn, info } as any);
    const primary = failing("SendGrid is down");
    const backup = new ArrayTransport();
    Mailer.configure({
      default: "main",
      from: "h@x.io",
      mailers: {
        primary,
        backup,
        main: { transport: "failover", mailers: ["primary", "backup"] },
      },
    });

    const sent = await new Mailer().to("a@x.io").send(new InvoiceMail());
    expect(sent.mailer).toBe("main");
    expect(primary.send).toHaveBeenCalledOnce();
    expect(backup.messages).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ mailer: "primary", next: "backup" }),
      "Mailer \"primary\" failed; trying \"backup\"",
    );
    expect(info).toHaveBeenCalledWith(
      { mailer: "backup" },
      "Mail sent through \"backup\" after failover",
    );
  });

  it("fails with every reason when all mailers fail", async () => {
    vi.spyOn(LoggerService, "child").mockReturnValue({
      warn: vi.fn(),
      info: vi.fn(),
    } as any);
    const transport = new FailoverTransport(["a", "b"], async (name) => {
      throw new Error(`${name} down`);
    });
    const err = await transport.send(await message()).catch((e) => e);
    expect(err).toBeInstanceOf(MailError);
    expect(err.message).toBe(
      "[Megh Mail] Every failover mailer failed. a: a down | b: b down",
    );
  });

  it("works with the HTTP mailers from .env", async () => {
    vi.spyOn(LoggerService, "child").mockReturnValue({
      warn: vi.fn(),
      info: vi.fn(),
    } as any);
    vi.stubEnv("MEGH_MAIL_SENDGRID_API_KEY", "sg");
    vi.stubEnv("MEGH_MAIL_RESEND_API_KEY", "re");
    vi.stubEnv("MEGH_MAIL_FAILOVER", "sendgrid,resend");
    vi.stubEnv("MEGH_MAIL_MAILER", "failover");
    reply = () =>
      calls.length === 1
        ? new Response("down", { status: 503 })
        : Response.json({ id: "re-9" });
    try {
      Mailer.configure({ from: "h@x.io" });
      const sent = await new Mailer().to("a@x.io").send(new InvoiceMail());
      expect(calls.map((c) => new URL(c.url).host)).toEqual([
        "api.sendgrid.com",
        "api.resend.com",
      ]);
      expect(sent.messageId).toBe("re-9");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("one address stays one recipient (#134)", () => {
  const mailers = {
    sendgrid: { transport: "sendgrid", apiKey: "sg" },
    mailgun: { transport: "mailgun", apiKey: "mg", domain: "mg.x.io" },
    postmark: { transport: "postmark", token: "pm" },
    resend: { transport: "resend", apiKey: "re" },
  } as const;

  const smuggled = [
    "victim@a.com, attacker@evil.com",
    "victim@a.com; attacker@evil.com",
    { name: "x", address: "victim@a.com>, <attacker@evil.com" },
  ];

  for (const [name, config] of Object.entries(mailers)) {
    it(`${name}: rejects an address that would reach a second recipient`, async () => {
      Mailer.configure({
        default: name,
        from: "shop@x.io",
        mailers: { [name]: config },
      });
      for (const to of smuggled) {
        // Rejected when the address is given, before anything is sent.
        await expect(
          (async () => new Mailer().to(to as any).send(new InvoiceMail()))(),
        ).rejects.toThrow(MailError);
        await expect(
          (async () =>
            new Mailer()
              .to("ann@x.io")
              .cc(to as any)
              .send(new InvoiceMail()))(),
        ).rejects.toThrow(/single email address/);
      }
      expect(calls).toHaveLength(0);
    });
  }
});

describe("attachment access (#139)", () => {
  class PathMail extends Mailable {
    constructor(private readonly file: string) {
      super();
    }
    content() {
      return { text: "see attached" };
    }
    attachments(): MailAttachment[] {
      return [{ path: this.file }];
    }
  }

  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "megh-attach-"));
    fs.mkdirSync(path.join(dir, "root"));
    fs.writeFileSync(path.join(dir, "root", "invoice.pdf"), "PDF");
    fs.writeFileSync(path.join(dir, "secret.txt"), "secret");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const send = (file: string, config = {}) => {
    Mailer.configure({ default: "array", from: "shop@x.io", ...config });
    return new Mailer().to("ann@x.io").send(new PathMail(file));
  };

  it("refuses URL attachments by default, before fetching anything", async () => {
    await expect(
      send("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow(/URL attachments are off/);
    await expect(send("HTTPS://cdn.x.io/a.pdf")).rejects.toThrow(MailError);
    expect(calls).toHaveLength(0);
  });

  it("allows URL attachments with allowUrlAccess, but only http(s)", async () => {
    const sent = await send("https://cdn.x.io/a.pdf", { allowUrlAccess: true });
    expect(sent.message.attachments[0].path).toBe("https://cdn.x.io/a.pdf");
    await expect(
      send("ftp://x.io/a.pdf", { allowUrlAccess: true }),
    ).rejects.toThrow(/http\(s\) URL/);
  });

  it("allows files by default, and refuses them with allowFileAccess: false", async () => {
    const file = path.join(dir, "secret.txt");
    expect((await send(file)).message.attachments[0].path).toBe(file);
    await expect(send(file, { allowFileAccess: false })).rejects.toThrow(
      /file attachments are off/,
    );
  });

  it("confines files to attachmentRoot", async () => {
    const root = path.join(dir, "root");
    const sent = await send("invoice.pdf", { attachmentRoot: root });
    expect(sent.message.attachments[0].path).toBe(
      fs.realpathSync(path.join(root, "invoice.pdf")),
    );
    for (const escape of [
      "../secret.txt",
      path.join(dir, "secret.txt"),
      "/etc/passwd",
    ]) {
      await expect(send(escape, { attachmentRoot: root })).rejects.toThrow(
        /outside the attachment root/,
      );
    }
    await expect(send("missing.pdf", { attachmentRoot: root })).rejects.toThrow(
      /was not found/,
    );
  });

  it("doesn't follow a symlink out of attachmentRoot", async () => {
    const root = path.join(dir, "root");
    try {
      fs.symlinkSync(path.join(dir, "secret.txt"), path.join(root, "link.txt"));
    } catch {
      return; // symlinks need extra rights on Windows
    }
    await expect(send("link.txt", { attachmentRoot: root })).rejects.toThrow(
      /outside the attachment root/,
    );
  });

  it("keeps content and data: attachments working with every access off", async () => {
    Mailer.configure({
      default: "array",
      from: "shop@x.io",
      allowFileAccess: false,
      allowUrlAccess: false,
    });
    const sent = await new Mailer().to("ann@x.io").send(new InvoiceMail());
    expect(sent.message.attachments).toHaveLength(2);
    await expect(
      send("data:text/plain;base64,aGk=", { allowFileAccess: false }),
    ).resolves.toBeDefined();
  });

  it("tells Nodemailer to refuse files and URLs too", () => {
    const base = {
      from: { address: "a@x.io" },
      to: [],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: "s",
      attachments: [],
      headers: {},
    };
    expect(toNodemailerMessage(base)).toMatchObject({
      disableFileAccess: false,
      disableUrlAccess: true,
    });
    expect(
      toNodemailerMessage(base, {
        allowFileAccess: false,
        allowUrlAccess: true,
      }),
    ).toMatchObject({ disableFileAccess: true, disableUrlAccess: false });
  });
});
