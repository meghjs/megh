import { Injectable } from "../di";
import type { Constructor } from "../common/utils/common-utils";
import { resolveRealWithin } from "../common/utils/path-utils";
import {
  DEFAULT_ATTACHMENT_ACCESS,
  mailerProblem,
  type AttachmentAccess,
  resolveMailConfig,
  type FailoverMailerConfig,
  type MailConfig,
  type MailerConfig,
  type ResolvedMailConfig,
} from "./config";
import { MailError } from "./errors";
import { Mailable } from "./mailable";
import {
  MailgunTransport,
  PostmarkTransport,
  ResendTransport,
  SendGridTransport,
} from "./http-transports";
import { MailQueue } from "./queue";
import {
  ArrayTransport,
  FailoverTransport,
  LogTransport,
  SmtpTransport,
} from "./transports";
import type {
  MailAddress,
  MailAddressLike,
  MailAttachment,
  MailMessage,
  MailTransport,
  MailTransportResult,
  QueuedMessage,
  SentMessage,
} from "./types";

type Recipients = { to: MailAddress[]; cc: MailAddress[]; bcc: MailAddress[] };
type AddressInput = MailAddressLike | MailAddressLike[];

/**
 * Sends {@link Mailable}s. Inject it like any service; every instance shares
 * the configuration set by `app.useMail()` (or read from `MEGH_MAIL_*` when
 * `useMail()` was not called).
 *
 * @example
 * constructor(private readonly mailer: Mailer) {}
 *
 * await this.mailer.to(user.email).send(new WelcomeMail(user));
 * await this.mailer.to(user.email).queue(new WelcomeMail(user)); // needs useMail({ queue })
 * await this.mailer.mailer('log').to('dev@x.io').send(new WelcomeMail(user));
 */
@Injectable()
export class Mailer {
  private static config: ResolvedMailConfig | undefined;
  private static readonly transports = new Map<string, MailTransport>();
  private static current: MailFake | null = null;
  private static mailQueue: MailQueue | undefined;

  /** The named mailer to use; `undefined` means the default. */
  private mailerName: string | undefined;

  /**
   * Set the mail configuration, merged over `MEGH_MAIL_*`. Called by
   * `app.useMail()`; call it yourself outside a Megh app.
   *
   * With `queue` set, this also starts the worker that sends queued mail
   * (unless `queue.worker` is `false`).
   *
   * @throws MailError when the configuration is invalid, e.g. in production
   *   with no mailer set.
   */
  static configure(options?: MailConfig): void {
    const config = resolveMailConfig(options);
    Mailer.close().catch(() => {});
    Mailer.config = config;
    if (config.queue) {
      Mailer.mailQueue = new MailQueue(config.queue, (name, message) =>
        Mailer.deliver(name, message),
      );
    }
  }

  /**
   * Record messages instead of sending them, and get assertions on what was
   * sent. Undo it with `restore()` on the result, or {@link Mailer.restore}.
   *
   * @example
   * const mail = Mailer.fake();
   * await service.register(user);
   * mail.assertSent(WelcomeMail, (sent) => sent.hasTo(user.email));
   */
  static fake(): MailFake {
    Mailer.current = new MailFake();
    return Mailer.current;
  }

  /** Stop faking; messages are sent again. */
  static restore(): void {
    Mailer.current = null;
  }

  /**
   * Close the mail queue and every transport's connections. Called when the
   * app closes.
   */
  static async close(): Promise<void> {
    // Detach before awaiting, so a configure() right after starts afresh.
    const queue = Mailer.mailQueue;
    Mailer.mailQueue = undefined;
    const transports = [...Mailer.transports.values()];
    Mailer.transports.clear();
    await Promise.all([queue?.close(), ...transports.map((t) => t.close?.())]);
  }

  /** Forget the configuration and transports, so the environment is read again. */
  static async reset(): Promise<void> {
    await Mailer.close();
    Mailer.config = undefined;
    Mailer.current = null;
  }

  /**
   * The same mailer, sending through the named mailer instead of the default.
   *
   * @param name - A key of `mailers` in the configuration, e.g. `smtp` or `log`.
   */
  mailer(name: string): Mailer {
    const scoped = new Mailer();
    scoped.mailerName = name;
    return scoped;
  }

  /** Start a message to these recipients. */
  to(...addresses: AddressInput[]): PendingMail {
    return new PendingMail(this.mailerName).to(...addresses);
  }

  /** Start a message with these carbon-copy recipients. */
  cc(...addresses: AddressInput[]): PendingMail {
    return new PendingMail(this.mailerName).cc(...addresses);
  }

  /** Start a message with these blind-copy recipients. */
  bcc(...addresses: AddressInput[]): PendingMail {
    return new PendingMail(this.mailerName).bcc(...addresses);
  }

  /**
   * Send a mailable to the recipients its `envelope()` names.
   *
   * @returns The mailer used, the built message and the provider's reply.
   * @throws MailError when the message has no sender, no recipients or no body.
   */
  send(mailable: Mailable): Promise<SentMessage> {
    return new PendingMail(this.mailerName).send(mailable);
  }

  /** Queue a mailable for the recipients its `envelope()` names. See {@link PendingMail.queue}. */
  queue(mailable: Mailable): Promise<QueuedMessage> {
    return new PendingMail(this.mailerName).queue(mailable);
  }

  /** Queue a mailable to be sent later. See {@link PendingMail.later}. */
  later(delay: number | Date, mailable: Mailable): Promise<QueuedMessage> {
    return new PendingMail(this.mailerName).later(delay, mailable);
  }

  /** @internal Build and send (or record) one message. */
  static async dispatch(
    mailerName: string | undefined,
    recipients: Recipients,
    mailable: Mailable,
  ): Promise<SentMessage> {
    const { name, config } = Mailer.resolve(mailerName);
    const message = await buildMessage(
      mailable,
      recipients,
      config.from,
      config.attachments,
    );
    if (Mailer.current) {
      Mailer.current.record(new SentMail(name, mailable, message));
      return { mailer: name, message };
    }
    const result = await Mailer.deliver(name, message);
    return { mailer: name, message, ...(result ?? {}) };
  }

  /** @internal Build one message and queue it (or record it). */
  static async dispatchQueued(
    mailerName: string | undefined,
    recipients: Recipients,
    mailable: Mailable,
    delay: number,
  ): Promise<QueuedMessage> {
    const { name, config } = Mailer.resolve(mailerName);
    const message = await buildMessage(
      mailable,
      recipients,
      config.from,
      config.attachments,
    );
    if (Mailer.current) {
      Mailer.current.recordQueued(new SentMail(name, mailable, message, delay));
      return { mailer: name, message, delay };
    }
    if (!Mailer.mailQueue) {
      throw new MailError(
        "Queued mail needs a queue. Pass { queue: true } (or queue options) to app.useMail().",
      );
    }
    const job = await Mailer.mailQueue.enqueue(
      { mailer: name, message },
      delay,
    );
    return {
      mailer: name,
      message,
      delay,
      ...(job.id !== undefined ? { jobId: String(job.id) } : {}),
    };
  }

  /** @internal Send a built message through a named mailer. Used by the queue worker. */
  static deliver(
    name: string,
    message: MailMessage,
  ): Promise<MailTransportResult | void> {
    const { config } = Mailer.resolve(name);
    let transport = Mailer.transports.get(name);
    if (!transport) {
      transport = createTransport(name, config.mailers, config.attachments);
      Mailer.transports.set(name, transport);
    }
    return transport.send(message);
  }

  private static resolve(mailerName: string | undefined): {
    name: string;
    config: ResolvedMailConfig;
  } {
    const config = (Mailer.config ??= resolveMailConfig());
    const name = mailerName ?? config.default;
    if (!config.mailers[name]) {
      throw new MailError(
        `There is no mailer named "${name}". Configured mailers: ${Object.keys(config.mailers).join(", ")}.`,
      );
    }
    return { name, config };
  }
}

function createTransport(
  name: string,
  mailers: Record<string, MailerConfig>,
  access: AttachmentAccess,
): MailTransport {
  const problem = mailerProblem(name, mailers);
  if (problem) throw new MailError(`The mailer ${problem}`);
  const config = mailers[name];
  if ("send" in config && typeof config.send === "function") return config;
  const c = config as Exclude<MailerConfig, MailTransport>;
  switch (c.transport) {
    case "smtp":
      return new SmtpTransport(c, access);
    case "log":
      return new LogTransport();
    case "array":
      return new ArrayTransport();
    case "sendgrid":
      return new SendGridTransport(c);
    case "mailgun":
      return new MailgunTransport(c);
    case "postmark":
      return new PostmarkTransport(c);
    case "resend":
      return new ResendTransport(c);
    case "failover":
      return new FailoverTransport(
        (c as FailoverMailerConfig).mailers,
        (mailer, message) => Mailer.deliver(mailer, message),
      );
  }
}

/**
 * A message being addressed: `mailer.to(...).cc(...).send(mailable)`.
 * Each method adds recipients and returns the same object.
 */
export class PendingMail {
  private readonly recipients: Recipients = { to: [], cc: [], bcc: [] };

  constructor(private readonly mailerName?: string) {}

  /** Add recipients. */
  to(...addresses: AddressInput[]): this {
    this.recipients.to.push(...toAddresses(addresses));
    return this;
  }

  /** Add carbon-copy recipients. */
  cc(...addresses: AddressInput[]): this {
    this.recipients.cc.push(...toAddresses(addresses));
    return this;
  }

  /** Add blind-copy recipients. */
  bcc(...addresses: AddressInput[]): this {
    this.recipients.bcc.push(...toAddresses(addresses));
    return this;
  }

  /**
   * Build the mailable and send it now.
   *
   * @returns The mailer used, the built message and the provider's reply.
   * @throws MailError when the message has no sender, no recipients or no body.
   */
  send(mailable: Mailable): Promise<SentMessage> {
    return Mailer.dispatch(this.mailerName, this.recipients, mailable);
  }

  /**
   * Build the mailable now and send it from the mail queue's worker. The
   * job holds the built message, so the mailable is not needed there; an
   * attachment given by `path` must exist where the worker runs.
   *
   * @returns The mailer, the built message and the job ID.
   * @throws MailError when queueing is off (`useMail({ queue })`), or the
   *   message has no sender, no recipients or no body.
   */
  queue(mailable: Mailable): Promise<QueuedMessage> {
    return Mailer.dispatchQueued(this.mailerName, this.recipients, mailable, 0);
  }

  /**
   * Like {@link PendingMail.queue}, but sent after a delay.
   *
   * @param delay - Milliseconds to wait, or the time to send at. A time in
   *   the past sends straight away.
   */
  async later(
    delay: number | Date,
    mailable: Mailable,
  ): Promise<QueuedMessage> {
    const ms =
      delay instanceof Date ? delay.getTime() - Date.now() : Number(delay);
    if (!Number.isFinite(ms)) {
      throw new MailError("later() needs a number of milliseconds or a Date.");
    }
    return Mailer.dispatchQueued(
      this.mailerName,
      this.recipients,
      mailable,
      Math.max(0, Math.round(ms)),
    );
  }
}

/** @internal Turn a mailable and its recipients into a message. */
export async function buildMessage(
  mailable: Mailable,
  recipients: Recipients,
  defaultFrom?: MailAddressLike,
  access: AttachmentAccess = DEFAULT_ATTACHMENT_ACCESS,
): Promise<MailMessage> {
  const [envelope, content, attachments] = await Promise.all([
    mailable.envelope(),
    mailable.content(),
    mailable.attachments(),
  ]);
  const label = mailable.constructor.name || "Mailable";
  const fromInput = envelope.from ?? defaultFrom;
  if (!fromInput) {
    throw new MailError(
      `${label} has no sender. Set MEGH_MAIL_FROM_ADDRESS in .env, pass from to app.useMail(), or return from in envelope().`,
    );
  }
  const message: MailMessage = {
    from: parseAddress(fromInput),
    to: [...recipients.to, ...toAddresses([envelope.to])],
    cc: [...recipients.cc, ...toAddresses([envelope.cc])],
    bcc: [...recipients.bcc, ...toAddresses([envelope.bcc])],
    replyTo: toAddresses([envelope.replyTo]),
    subject: envelope.subject ?? headline(label),
    attachments: await checkAttachments(attachments ?? [], access, label),
    headers: { ...envelope.headers },
  };
  if (content?.html !== undefined) message.html = content.html;
  if (content?.text !== undefined) message.text = content.text;

  if (!message.to.length && !message.cc.length && !message.bcc.length) {
    throw new MailError(
      `${label} has no recipients. Use mailer.to(...) or return to in envelope().`,
    );
  }
  if (message.html === undefined && message.text === undefined) {
    throw new MailError(`${label}.content() returned neither html nor text.`);
  }
  assertSingleLine(`${label} subject`, message.subject);
  for (const [key, value] of Object.entries(message.headers)) {
    assertSingleLine(`${label} header "${key}"`, `${key}${value}`);
  }
  return message;
}

/**
 * Check each attachment `path` against what the config allows, before any
 * transport reads it. A path can come from user input (`{ path: dto.file }`),
 * and would otherwise read any local file or fetch any URL, including cloud
 * metadata, and mail it out.
 */
async function checkAttachments(
  attachments: MailAttachment[],
  access: AttachmentAccess,
  label: string,
): Promise<MailAttachment[]> {
  return Promise.all(
    attachments.map(async (attachment) => {
      const target = attachment.path;
      if (target === undefined || target === "") return attachment;
      const what = `${label} attachment "${attachment.filename ?? target}"`;
      if (/^data:/i.test(target)) return attachment;
      if (/^[a-z][a-z\d+.-]*:\/\//i.test(target)) {
        if (!access.allowUrlAccess) {
          throw new MailError(
            `${what} is a URL, and URL attachments are off. Pass allowUrlAccess: true to app.useMail() to allow them, or attach the content instead.`,
          );
        }
        if (!/^https?:\/\//i.test(target)) {
          throw new MailError(`${what} must be an http(s) URL.`);
        }
        return attachment;
      }
      if (!access.allowFileAccess) {
        throw new MailError(
          `${what} is a file path, and file attachments are off (allowFileAccess: false). Attach the content instead.`,
        );
      }
      if (access.attachmentRoot === undefined) return attachment;
      let real: string | null;
      try {
        real = await resolveRealWithin(access.attachmentRoot, target);
      } catch {
        throw new MailError(`${what} was not found.`);
      }
      if (!real) {
        throw new MailError(
          `${what} is outside the attachment root (${access.attachmentRoot}).`,
        );
      }
      return { ...attachment, path: real };
    }),
  );
}

/**
 * One address: `local@domain`, with nothing that could split it into
 * several recipients (`,` `;`), close or open an angle-addr (`<` `>`), quote
 * (`"`) or space. Quoted local parts aren't supported.
 */
const ADDR_SPEC =
  /^[^\s@,;<>"()[\]\\]{1,64}@[^\s@,;<>"()[\]\\.]+(\.[^\s@,;<>"()[\]\\.]+)*$/u;

/**
 * Normalize one address. Rejects line breaks, which could inject headers,
 * and anything that isn't a single `local@domain` address: the HTTP
 * transports pass addresses on as-is, so `"a@x.io, b@evil.io"` would
 * otherwise reach two recipients.
 */
export function parseAddress(input: MailAddressLike): MailAddress {
  const parsed: MailAddress =
    typeof input === "string" ? parseAddressString(input) : { ...input };
  parsed.address = parsed.address?.trim();
  assertSingleLine(
    "An email address",
    (parsed.address ?? "") + (parsed.name ?? ""),
  );
  if (!parsed.address || !ADDR_SPEC.test(parsed.address)) {
    throw new MailError(
      `"${typeof input === "string" ? input : input.address}" is not a single email address.`,
    );
  }
  if (!parsed.name) delete parsed.name;
  return parsed;
}

function parseAddressString(value: string): MailAddress {
  const match = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  if (!match) return { address: value };
  const quoted = /^"(.*)"$/.exec(match[1]);
  // An unquoted name with `,` `;` `<` `>` is a list of addresses, not one.
  if (!quoted && /[,;<>]/.test(match[1])) {
    throw new MailError(`"${value}" is not a single email address.`);
  }
  const name = (quoted ? quoted[1] : match[1]).trim();
  return name ? { name, address: match[2] } : { address: match[2] };
}

function toAddresses(inputs: Array<AddressInput | undefined>): MailAddress[] {
  return inputs
    .flatMap((i) => (i === undefined ? [] : Array.isArray(i) ? i : [i]))
    .map(parseAddress);
}

function assertSingleLine(what: string, value: string) {
  if (/[\r\n]/.test(value))
    throw new MailError(`${what} must not contain line breaks.`);
}

/** `WelcomeMail` → "Welcome Mail", `OTPCodeMail` → "OTP Code Mail". */
function headline(name: string) {
  return name
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

/** One message recorded by {@link MailFake}, with helpers for assertions. */
export class SentMail<T extends Mailable = Mailable> {
  constructor(
    /** The mailer it would have gone through. */
    readonly mailer: string,
    readonly mailable: T,
    readonly message: MailMessage,
    /** For queued mail: milliseconds until it would be sent. */
    readonly delay = 0,
  ) {}

  /** Whether `address` is among the `to` recipients (case-insensitive). */
  hasTo(address: MailAddressLike): boolean {
    return includes(this.message.to, address);
  }

  /** Whether `address` is among the `cc` recipients. */
  hasCc(address: MailAddressLike): boolean {
    return includes(this.message.cc, address);
  }

  /** Whether `address` is among the `bcc` recipients. */
  hasBcc(address: MailAddressLike): boolean {
    return includes(this.message.bcc, address);
  }

  /** Whether the message comes from `address`. */
  hasFrom(address: MailAddressLike): boolean {
    return includes([this.message.from], address);
  }
}

function includes(list: MailAddress[], address: MailAddressLike) {
  const wanted = parseAddress(address).address.toLowerCase();
  return list.some((a) => a.address.toLowerCase() === wanted);
}

type Filter<T extends Mailable> = (sent: SentMail<T>) => boolean;
type Kind = "sent" | "queued";

/**
 * Returned by {@link Mailer.fake}: what would have been sent or queued, and
 * assertions that throw a descriptive error when they fail (any test runner
 * works).
 */
export class MailFake {
  /** Every message sent with `send()`, oldest first. */
  readonly sent: SentMail[] = [];
  /** Every message queued with `queue()` or `later()`, oldest first. */
  readonly queued: SentMail[] = [];

  /** @internal */
  record(mail: SentMail): void {
    this.sent.push(mail);
  }

  /** @internal */
  recordQueued(mail: SentMail): void {
    this.queued.push(mail);
  }

  /** The sent messages of one mailable class, optionally filtered. */
  sentOf<T extends Mailable>(
    type: Constructor<T>,
    filter?: Filter<T>,
  ): SentMail<T>[] {
    return pick(this.sent, type, filter);
  }

  /** The queued messages of one mailable class, optionally filtered. */
  queuedOf<T extends Mailable>(
    type: Constructor<T>,
    filter?: Filter<T>,
  ): SentMail<T>[] {
    return pick(this.queued, type, filter);
  }

  /**
   * Assert that a mailable of this class was sent with `send()`.
   *
   * @param filterOrTimes - A check a match must pass, or the exact number
   *   of times it must have been sent.
   */
  assertSent<T extends Mailable>(
    type: Constructor<T>,
    filterOrTimes?: Filter<T> | number,
  ): void {
    this.expect("sent", type, filterOrTimes);
  }

  /** Assert that no mailable of this class (matching `filter`, if given) was sent. */
  assertNotSent<T extends Mailable>(
    type: Constructor<T>,
    filter?: Filter<T>,
  ): void {
    this.expectNone("sent", type, filter);
  }

  /**
   * Assert that a mailable of this class was queued with `queue()` or `later()`.
   *
   * @param filterOrTimes - A check a match must pass (`sent.delay` holds the
   *   delay in milliseconds), or the exact number of times it must have been
   *   queued.
   */
  assertQueued<T extends Mailable>(
    type: Constructor<T>,
    filterOrTimes?: Filter<T> | number,
  ): void {
    this.expect("queued", type, filterOrTimes);
  }

  /** Assert that no mailable of this class (matching `filter`, if given) was queued. */
  assertNotQueued<T extends Mailable>(
    type: Constructor<T>,
    filter?: Filter<T>,
  ): void {
    this.expectNone("queued", type, filter);
  }

  /** Assert that nothing was sent with `send()`. */
  assertNothingSent(): void {
    if (this.sent.length)
      throw new Error(`Expected no mail to be sent.${this.summary("sent")}`);
  }

  /** Assert that nothing was queued. */
  assertNothingQueued(): void {
    if (this.queued.length)
      throw new Error(
        `Expected no mail to be queued.${this.summary("queued")}`,
      );
  }

  /** Assert how many messages were sent with `send()` in all. */
  assertSentCount(count: number): void {
    if (this.sent.length !== count) {
      throw new Error(
        `Expected ${count} message(s) to be sent, but ${this.sent.length} were.${this.summary("sent")}`,
      );
    }
  }

  /** Stop faking; same as {@link Mailer.restore}. */
  restore(): void {
    Mailer.restore();
  }

  private expect<T extends Mailable>(
    kind: Kind,
    type: Constructor<T>,
    filterOrTimes?: Filter<T> | number,
  ): void {
    const list = this[kind];
    if (typeof filterOrTimes === "number") {
      const count = pick(list, type).length;
      if (count !== filterOrTimes) {
        throw new Error(
          `Expected ${type.name} to be ${kind} ${filterOrTimes} time(s), but it was ${kind} ${count} time(s).${this.hint(kind, type)}`,
        );
      }
      return;
    }
    if (!pick(list, type, filterOrTimes).length) {
      const why =
        filterOrTimes && pick(list, type).length ? " matching the check" : "";
      throw new Error(
        `Expected ${type.name} to be ${kind}${why}, but it was not.${this.summary(kind)}${this.hint(kind, type)}`,
      );
    }
  }

  private expectNone<T extends Mailable>(
    kind: Kind,
    type: Constructor<T>,
    filter?: Filter<T>,
  ): void {
    const count = pick(this[kind], type, filter).length;
    if (count)
      throw new Error(
        `Expected ${type.name} not to be ${kind}, but it was ${kind} ${count} time(s).`,
      );
  }

  /** Point out a mailable that was queued when `sent` was expected, or the reverse. */
  private hint(kind: Kind, type: Constructor<Mailable>) {
    const other: Kind = kind === "sent" ? "queued" : "sent";
    if (!pick(this[other], type).length) return "";
    const assertion = other === "sent" ? "assertSent" : "assertQueued";
    return ` It was ${other} instead; use ${assertion}().`;
  }

  private summary(kind: Kind) {
    const list = this[kind];
    if (!list.length) return ` Nothing was ${kind}.`;
    const counts = new Map<string, number>();
    for (const s of list) {
      const n = s.mailable.constructor.name;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const label = kind === "sent" ? "Sent" : "Queued";
    return ` ${label}: ${[...counts].map(([n, c]) => `${n} (${c})`).join(", ")}.`;
  }
}

function pick<T extends Mailable>(
  list: SentMail[],
  type: Constructor<T>,
  filter?: Filter<T>,
): SentMail<T>[] {
  const ofType = list.filter(
    (s) => s.mailable instanceof type,
  ) as SentMail<T>[];
  return filter ? ofType.filter(filter) : ofType;
}
