import path from "path";
import type { JobsOptions, QueueOptions } from "bullmq";
import { Environment } from "../config/environment-variables";
import type { QueueDriver } from "../queue/memory-driver";
import { MailError } from "./errors";
import type { MailAddressLike, MailTransport } from "./types";

/** SMTP through Nodemailer (`npm install nodemailer`). */
export interface SmtpMailerConfig {
  transport: "smtp";
  host?: string;
  /** Defaults to 465 with `ssl`, else 587. */
  port?: number;
  /**
   * `ssl`: TLS from the start (port 465). `tls`: STARTTLS, required.
   * `none`: plain, upgraded with STARTTLS when the server offers it.
   * Left out, `ssl` on port 465 and `none` otherwise.
   */
  encryption?: "ssl" | "tls" | "none";
  username?: string;
  password?: string;
  /** Extra Nodemailer transport options, applied last (pool, timeouts, dkim, ...). */
  options?: Record<string, unknown>;
}

/** Writes messages to the Megh logger instead of sending them. */
export interface LogMailerConfig {
  transport: "log";
}

/** Keeps messages in memory, for tests. */
export interface ArrayMailerConfig {
  transport: "array";
}

/** Settings shared by the HTTP API mailers. */
interface HttpMailerOptions {
  /** The API's base URL, e.g. for a regional endpoint or a test server. */
  endpoint?: string;
  /** Milliseconds to wait for the API. Defaults to 30 000. */
  timeout?: number;
}

/** Twilio SendGrid. EU subusers use `endpoint: "https://api.eu.sendgrid.com"`. */
export interface SendGridMailerConfig extends HttpMailerOptions {
  transport: "sendgrid";
  /** `MEGH_MAIL_SENDGRID_API_KEY`. */
  apiKey?: string;
}

/** Mailgun. EU domains use `endpoint: "https://api.eu.mailgun.net"`. */
export interface MailgunMailerConfig extends HttpMailerOptions {
  transport: "mailgun";
  /** `MEGH_MAIL_MAILGUN_API_KEY`. */
  apiKey?: string;
  /** The sending domain, e.g. `mg.example.com`. `MEGH_MAIL_MAILGUN_DOMAIN`. */
  domain?: string;
}

/** Postmark. */
export interface PostmarkMailerConfig extends HttpMailerOptions {
  transport: "postmark";
  /** The server API token. `MEGH_MAIL_POSTMARK_TOKEN`. */
  token?: string;
  /** Defaults to Postmark's transactional stream. `MEGH_MAIL_POSTMARK_MESSAGE_STREAM`. */
  messageStream?: string;
}

/** Resend. */
export interface ResendMailerConfig extends HttpMailerOptions {
  transport: "resend";
  /** `MEGH_MAIL_RESEND_API_KEY`. */
  apiKey?: string;
}

/**
 * Tries other mailers in order until one sends: `{ transport: "failover",
 * mailers: ["sendgrid", "smtp"] }`. `MEGH_MAIL_FAILOVER=sendgrid,smtp` sets
 * up one named `failover`.
 */
export interface FailoverMailerConfig {
  transport: "failover";
  mailers: string[];
}

/** A mailer's settings, or a transport of your own. */
export type MailerConfig =
  | SmtpMailerConfig
  | LogMailerConfig
  | ArrayMailerConfig
  | SendGridMailerConfig
  | MailgunMailerConfig
  | PostmarkMailerConfig
  | ResendMailerConfig
  | FailoverMailerConfig
  | MailTransport;

/** Options for `app.useMail()`. Anything left out comes from `MEGH_MAIL_*` in `.env`. */
export interface MailConfig {
  /** The mailer `send()` uses unless one is named with `mailer(name)`. */
  default?: string;
  /** The address messages come from unless `envelope()` says otherwise. */
  from?: MailAddressLike;
  /**
   * Named mailers. `smtp`, `log`, `array`, `sendgrid`, `mailgun`, `postmark`
   * and `resend` are always there, set up from `.env`; these add to or
   * replace them.
   */
  mailers?: Record<string, MailerConfig>;
  /**
   * Turn on `queue()` and `later()`: `true` for the defaults, or options.
   * The queue's worker starts when this is set, unless `worker: false`.
   */
  queue?: boolean | MailQueueConfig;
  /**
   * Let attachments read a local file given as `path`. Defaults to `true`.
   * Turn it off when attachments are built from user input, or confine
   * paths with `attachmentRoot`.
   */
  allowFileAccess?: boolean;
  /**
   * Let attachments download an `http(s)://` URL given as `path`. Defaults to
   * `false`: a URL from user input could reach internal services or cloud
   * metadata (`169.254.169.254`) and mail the response out.
   */
  allowUrlAccess?: boolean;
  /**
   * Only read attachment files inside this folder. Relative paths resolve
   * against it, and symlinks can't lead out of it.
   */
  attachmentRoot?: string;
}

/** What an attachment `path` may read. */
export interface AttachmentAccess {
  allowFileAccess: boolean;
  allowUrlAccess: boolean;
  attachmentRoot?: string;
}

/** Files on, URLs off, no root. */
export const DEFAULT_ATTACHMENT_ACCESS: AttachmentAccess = {
  allowFileAccess: true,
  allowUrlAccess: false,
};

/** Where queued mail goes, and how it is retried. */
export interface MailQueueConfig {
  /** Queue name, as it appears in Redis. Defaults to `mail`. */
  name?: string;
  /** BullMQ queue options, including the Redis `connection`. */
  adapter?: QueueOptions;
  /**
   * Backend. Defaults to `setQueueDriver()`, then `MEGH_QUEUE_DRIVER`, then
   * `bullmq`. Use `memory` or `sync` in tests.
   */
  driver?: QueueDriver;
  /**
   * Options for the worker that sends queued mail, or `false` in a process
   * that only queues mail while another process sends it.
   */
  worker?: false | { concurrency?: number };
  /**
   * Options for each job. Defaults to 3 attempts with exponential backoff
   * from 10 seconds, and removing jobs once sent.
   */
  jobOptions?: JobsOptions;
}

/** A {@link MailConfig} with every gap filled from the environment. */
export interface ResolvedMailConfig {
  default: string;
  from?: MailAddressLike;
  mailers: Record<string, MailerConfig>;
  /** Set when queueing is on. */
  queue?: MailQueueConfig;
  /** What attachment paths may read. */
  attachments: AttachmentAccess;
}

const ENCRYPTIONS = ["ssl", "tls", "none"] as const;

/** `MailConfig` from the `MEGH_MAIL_*` variables in `.env` and the process environment. */
export function mailConfigFromEnv(
  get: (key: string) => string | undefined = defaultEnvReader(),
): MailConfig {
  const value = (key: string) => {
    const v = get(key);
    return v === undefined || v === "" ? undefined : String(v);
  };
  const encryption = value("MEGH_MAIL_ENCRYPTION")?.toLowerCase();
  if (encryption && !(ENCRYPTIONS as readonly string[]).includes(encryption)) {
    throw new MailError(
      `MEGH_MAIL_ENCRYPTION must be one of ${ENCRYPTIONS.join(", ")}, not "${encryption}".`,
    );
  }
  const port = value("MEGH_MAIL_PORT");
  if (port !== undefined && !/^\d+$/.test(port)) {
    throw new MailError(`MEGH_MAIL_PORT must be a number, not "${port}".`);
  }
  const fromAddress = value("MEGH_MAIL_FROM_ADDRESS");
  const fromName = value("MEGH_MAIL_FROM_NAME");
  const failover = value("MEGH_MAIL_FAILOVER")
    ?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return {
    default: value("MEGH_MAIL_MAILER"),
    from: fromAddress
      ? { address: fromAddress, ...(fromName ? { name: fromName } : {}) }
      : undefined,
    mailers: {
      smtp: {
        transport: "smtp",
        host: value("MEGH_MAIL_HOST"),
        port: port === undefined ? undefined : Number(port),
        encryption: encryption as SmtpMailerConfig["encryption"],
        username: value("MEGH_MAIL_USERNAME"),
        password: value("MEGH_MAIL_PASSWORD"),
      },
      sendgrid: {
        transport: "sendgrid",
        apiKey: value("MEGH_MAIL_SENDGRID_API_KEY"),
      },
      mailgun: {
        transport: "mailgun",
        apiKey: value("MEGH_MAIL_MAILGUN_API_KEY"),
        domain: value("MEGH_MAIL_MAILGUN_DOMAIN"),
        endpoint: value("MEGH_MAIL_MAILGUN_ENDPOINT"),
      },
      postmark: {
        transport: "postmark",
        token: value("MEGH_MAIL_POSTMARK_TOKEN"),
        messageStream: value("MEGH_MAIL_POSTMARK_MESSAGE_STREAM"),
      },
      resend: {
        transport: "resend",
        apiKey: value("MEGH_MAIL_RESEND_API_KEY"),
      },
      ...(failover?.length
        ? { failover: { transport: "failover", mailers: failover } }
        : {}),
    },
  };
}

function defaultEnvReader() {
  const env = new Environment();
  return (key: string) => env.get<string | undefined>(key);
}

/**
 * Merge `useMail()` options over the environment, and choose the default
 * mailer: `MEGH_MAIL_MAILER`, else `smtp` when `MEGH_MAIL_HOST` is set, else
 * `log` in development and `array` in tests.
 *
 * @throws MailError in production when no mailer is set, or when the default
 *   mailer is missing or lacks a setting it needs (a host, an API key).
 */
export function resolveMailConfig(
  options: MailConfig = {},
  env: MailConfig = mailConfigFromEnv(),
): ResolvedMailConfig {
  const mailers: Record<string, MailerConfig> = {
    smtp: { transport: "smtp" },
    log: { transport: "log" },
    array: { transport: "array" },
    sendgrid: { transport: "sendgrid" },
    mailgun: { transport: "mailgun" },
    postmark: { transport: "postmark" },
    resend: { transport: "resend" },
    ...env.mailers,
  };
  // A mailer given in options is merged over the one from .env when both use
  // the same transport, so setting only `endpoint` keeps the API key.
  for (const [key, given] of Object.entries(options.mailers ?? {})) {
    const fromEnv = mailers[key];
    mailers[key] =
      isSettings(given) &&
      isSettings(fromEnv) &&
      given.transport === fromEnv.transport
        ? ({
            ...withoutUndefined(fromEnv),
            ...withoutUndefined(given),
          } as MailerConfig)
        : given;
  }
  const smtp = mailers.smtp as SmtpMailerConfig;
  const name = options.default ?? env.default ?? implicitDefault(smtp);
  if (!mailers[name]) {
    throw new MailError(
      `The default mailer "${name}" is not configured. Configured mailers: ${Object.keys(mailers).join(", ")}.`,
    );
  }
  const problem = mailerProblem(name, mailers);
  if (problem) throw new MailError(`The default mailer ${problem}`);
  const queue = options.queue === true ? {} : options.queue || undefined;
  return {
    default: name,
    from: options.from ?? env.from,
    mailers,
    ...(queue ? { queue } : {}),
    attachments: {
      allowFileAccess:
        options.allowFileAccess ?? DEFAULT_ATTACHMENT_ACCESS.allowFileAccess,
      allowUrlAccess:
        options.allowUrlAccess ?? DEFAULT_ATTACHMENT_ACCESS.allowUrlAccess,
      ...(options.attachmentRoot !== undefined && {
        attachmentRoot: path.resolve(options.attachmentRoot),
      }),
    },
  };
}

function implicitDefault(smtp: SmtpMailerConfig | undefined): string {
  if (smtp?.transport === "smtp" && smtp.host) return "smtp";
  if (process.env.NODE_ENV === "development") return "log";
  if (process.env.NODE_ENV === "test") return "array";
  throw new MailError(
    "No mailer is set. Set MEGH_MAIL_MAILER (smtp, sendgrid, mailgun, postmark, resend, failover or log) " +
      "or MEGH_MAIL_HOST in .env, " +
      "or pass { default } to app.useMail().",
  );
}

/**
 * What stops a mailer from sending, or `undefined` when it is ready.
 * Checked for the default mailer at startup, and for others on first use.
 */
export function mailerProblem(
  name: string,
  mailers: Record<string, MailerConfig>,
): string | undefined {
  const config = mailers[name];
  if (!config) return `"${name}" is not configured.`;
  if ("send" in config && typeof config.send === "function") return undefined;
  const missing = (setting: string) => `"${name}" needs ${setting}.`;
  const c = config as Exclude<MailerConfig, MailTransport>;
  switch (c.transport) {
    case "log":
    case "array":
      return undefined;
    case "smtp":
      return c.host || c.options
        ? undefined
        : missing("a host: set MEGH_MAIL_HOST or mailers.smtp.host");
    case "sendgrid":
      return c.apiKey
        ? undefined
        : missing("an API key: set MEGH_MAIL_SENDGRID_API_KEY or apiKey");
    case "mailgun":
      if (!c.apiKey)
        return missing("an API key: set MEGH_MAIL_MAILGUN_API_KEY or apiKey");
      return c.domain
        ? undefined
        : missing("a domain: set MEGH_MAIL_MAILGUN_DOMAIN or domain");
    case "postmark":
      return c.token
        ? undefined
        : missing("a server token: set MEGH_MAIL_POSTMARK_TOKEN or token");
    case "resend":
      return c.apiKey
        ? undefined
        : missing("an API key: set MEGH_MAIL_RESEND_API_KEY or apiKey");
    case "failover": {
      if (!c.mailers?.length) return missing("a list of mailers to try");
      for (const member of c.mailers) {
        const target = mailers[member];
        if (!target)
          return `"${name}" lists "${member}", which is not configured.`;
        if ((target as { transport?: string }).transport === "failover") {
          return `"${name}" lists "${member}", another failover mailer; list the mailers directly.`;
        }
        const problem = mailerProblem(member, mailers);
        if (problem) return `"${name}" lists ${problem}`;
      }
      return undefined;
    }
    default:
      return `"${name}" has an unknown transport "${String((c as { transport?: unknown }).transport)}". Use smtp, log, array, sendgrid, mailgun, postmark, resend, failover, or an object with a send() method.`;
  }
}

/** Plain mailer settings (`{ transport, ... }`), as opposed to a transport object. */
function isSettings(
  config: MailerConfig | undefined,
): config is Exclude<MailerConfig, MailTransport> {
  return (
    !!config &&
    typeof (config as { send?: unknown }).send !== "function" &&
    typeof (config as { transport?: unknown }).transport === "string"
  );
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
