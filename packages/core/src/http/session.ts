/**
 * Cookie sessions for server-rendered (MVC) apps: `app.useSession()`.
 *
 * The cookie holds only a random session ID, signed with HMAC-SHA256. The
 * data lives in a {@link SessionStore}: in memory by default, or Redis so
 * every replica sees the same sessions.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SystemUseError } from "../common/exceptions/system-exception";
import {
  createContextKey,
  requestContext,
} from "../observability/request-context";
import { parseWindow } from "../security/rate-limit";
import type { ErrorContext } from "../errors/exception-filter";

// ─── Options ─────────────────────────────────────────────────────────────────

export interface SessionCookieOptions {
  /** Default `/`. */
  path?: string;
  domain?: string;
  /** Default `true`: scripts in the page can't read the cookie. */
  httpOnly?: boolean;
  /** Default `"lax"`. */
  sameSite?: "lax" | "strict" | "none";
  /**
   * Default `"auto"`: `Secure` when the request came over HTTPS
   * (`request.protocol`, which honours `server.trustProxy`).
   */
  secure?: boolean | "auto";
}

export interface SessionOptions {
  /**
   * Signs the session cookie. At least 32 characters; defaults to the
   * `SESSION_SECRET` environment variable. Pass an array to rotate keys:
   * the first signs, all of them verify.
   */
  secret?: string | string[];
  /** Cookie name. Default `megh_session`. */
  cookieName?: string;
  /**
   * How long a session lives after its last change, in milliseconds or as
   * a duration such as `'2h'` or `'7 days'`. Default `'2h'`.
   */
  maxAge?: number | string;
  /** Save the session on every request, so it expires after inactivity. Default `false`. */
  rolling?: boolean;
  cookie?: SessionCookieOptions;
  /** Where session data is kept. Default: a {@link MemorySessionStore}. */
  store?: SessionStore;
  /** Shortcut for `store: new RedisSessionStore(redis)`, with an ioredis client. */
  redis?: RedisSessionClient;
  /**
   * Where to send a browser that hits a route needing a logged-in user.
   * Requests that accept HTML and get a 401 are redirected here instead;
   * JSON and XHR requests keep the 401. A GET remembers its URL for
   * `session.intended()`.
   */
  loginPath?: string;
}

// ─── Stores ──────────────────────────────────────────────────────────────────

export type SessionData = Record<string, unknown>;

/** Keeps session data by ID. Implement it to use another database. */
export interface SessionStore {
  get(id: string): Promise<SessionData | null | undefined>;
  /** Save `data`, replacing what was there, and expire it after `ttlMs`. */
  set(id: string, data: SessionData, ttlMs: number): Promise<void>;
  destroy(id: string): Promise<void>;
  close?(): void | Promise<void>;
}

/**
 * Sessions in this process's memory. Fine for development and a single
 * instance; sessions are lost on restart and not shared between replicas.
 */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<
    string,
    { json: string; expires: number }
  >();
  private readonly sweeper: NodeJS.Timeout;

  constructor(options: { sweepIntervalMs?: number } = {}) {
    this.sweeper = setInterval(
      () => this.sweep(),
      options.sweepIntervalMs ?? 60_000,
    );
    this.sweeper.unref();
  }

  async get(id: string) {
    const entry = this.sessions.get(id);
    if (!entry) return null;
    if (entry.expires <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    // A copy, so changes reach the store only when the session is saved.
    return JSON.parse(entry.json) as SessionData;
  }

  async set(id: string, data: SessionData, ttlMs: number) {
    this.sessions.set(id, {
      json: JSON.stringify(data),
      expires: Date.now() + ttlMs,
    });
  }

  async destroy(id: string) {
    this.sessions.delete(id);
  }

  /** Number of live sessions. */
  get size() {
    this.sweep();
    return this.sessions.size;
  }

  close() {
    clearInterval(this.sweeper);
    this.sessions.clear();
  }

  private sweep() {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (entry.expires <= now) this.sessions.delete(id);
    }
  }
}

/** The part of an ioredis client the Redis store uses. */
export interface RedisSessionClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/** Sessions in Redis, shared by every replica. Pass an ioredis client. */
export class RedisSessionStore implements SessionStore {
  constructor(
    private readonly redis: RedisSessionClient,
    private readonly prefix = "megh:session:",
  ) {
    if (!redis || typeof redis.get !== "function") {
      throw new SystemUseError(
        "[Megh] RedisSessionStore needs an ioredis client, e.g. new RedisSessionStore(new Redis()).",
      );
    }
  }

  async get(id: string) {
    const json = await this.redis.get(this.prefix + id);
    return json ? (JSON.parse(json) as SessionData) : null;
  }

  async set(id: string, data: SessionData, ttlMs: number) {
    await this.redis.set(this.prefix + id, JSON.stringify(data), "PX", ttlMs);
  }

  async destroy(id: string) {
    await this.redis.del(this.prefix + id);
  }
}

// ─── The session ─────────────────────────────────────────────────────────────

/** Where flashed values are kept in the stored data. */
const FLASH_KEY = "__flash";
/** The URL a guest asked for before being sent to log in. */
const INTENDED_KEY = "__intended";
/** Keys starting with this are Megh's own. */
const RESERVED_PREFIX = "__";

const isReserved = (key: string) => key.startsWith(RESERVED_PREFIX);

/**
 * The current visitor's session. Inject it with `@Session()`; views get it
 * as `session`.
 *
 *   session.set("cartId", 42);
 *   session.get<number>("cartId");
 *   session.flash("status", "Saved!");   // readable on the next request only
 *   await session.regenerate();          // on login: a new ID, same data
 *   session.destroy();                   // on logout
 *
 * Changes are saved when the response is sent.
 */
export class MeghSession {
  private values: SessionData;
  /** Flashed by the previous request; readable now, gone after this one. */
  private readonly flashed: SessionData;
  /** Flashed by this request, for the next one. */
  private readonly nextFlash: SessionData = {};
  private _id: string;
  private _dirty = false;
  private _destroyed = false;
  private _isNew: boolean;
  /** The stored ID this session was loaded under, if any. */
  private readonly loadedId: string | null;
  private replacedId: string | null = null;

  /** @internal Created by `useSession()`. */
  constructor(id: string | null, data: SessionData | null) {
    this.loadedId = id;
    this._id = id ?? newSessionId();
    this._isNew = id === null;
    const { [FLASH_KEY]: flash, ...values } = data ?? {};
    this.values = values;
    this.flashed =
      flash && typeof flash === "object" ? { ...(flash as SessionData) } : {};
    // Flashed values are consumed by this request, so the session changes.
    if (Object.keys(this.flashed).length) this._dirty = true;
  }

  /** The session ID. It changes on {@link regenerate}. */
  get id() {
    return this._id;
  }

  /** `true` when the visitor had no valid session before this request. */
  get isNew() {
    return this._isNew;
  }

  /** A value, or a value flashed by the previous request. */
  get<T = unknown>(key: string): T | undefined {
    if (Object.prototype.hasOwnProperty.call(this.values, key)) {
      return this.values[key] as T;
    }
    return this.flashed[key] as T | undefined;
  }

  /** `true` when {@link get} would return something other than `undefined`. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Store a value. It must survive `JSON.stringify`. */
  set(key: string, value: unknown) {
    assertKey(key);
    this.values[key] = value;
    this._dirty = true;
    return this;
  }

  /** Remove a value and return it. */
  pull<T = unknown>(key: string): T | undefined {
    const value = this.get<T>(key);
    this.delete(key);
    return value;
  }

  delete(key: string) {
    if (key in this.values) {
      delete this.values[key];
      this._dirty = true;
    }
    if (key in this.flashed) delete this.flashed[key];
    return this;
  }

  /** Every stored value, plus the values flashed by the previous request. */
  all(): SessionData {
    const all: SessionData = { ...this.flashed, ...this.values };
    for (const key of Object.keys(all)) if (isReserved(key)) delete all[key];
    return all;
  }

  /**
   * The URL a guest asked for before `loginPath` sent them to log in, or
   * `fallback`. It is removed, so it is used once. Always a path on this
   * site, so it's safe to redirect to:
   *
   *   session.regenerate().set("userId", user.id);
   *   return Results.Redirect(session.intended("/dashboard"));
   */
  intended(fallback = "/"): string {
    const url = this.values[INTENDED_KEY];
    if (INTENDED_KEY in this.values) {
      delete this.values[INTENDED_KEY];
      this._dirty = true;
    }
    return typeof url === "string" && isLocalPath(url) ? url : fallback;
  }

  /** @internal Remember the URL to come back to after login. */
  rememberIntended(url: string) {
    if (!isLocalPath(url)) return;
    this.values[INTENDED_KEY] = url;
    this._dirty = true;
  }

  /** Remove every value, keeping the session (and its ID). */
  clear() {
    this.values = {};
    for (const key of Object.keys(this.flashed)) delete this.flashed[key];
    this._dirty = true;
    return this;
  }

  /**
   * Store a value for the next request only: a status message after a
   * redirect, form errors, old input. `get()` reads it there.
   */
  flash(key: string, value: unknown) {
    assertKey(key);
    this.nextFlash[key] = value;
    this._dirty = true;
    return this;
  }

  /** Keep the values flashed by the previous request for one more request. */
  reflash() {
    for (const [key, value] of Object.entries(this.flashed)) {
      if (!(key in this.nextFlash)) this.nextFlash[key] = value;
    }
    this._dirty = true;
    return this;
  }

  /**
   * Move the session to a new ID, keeping its data. Call it when the user
   * logs in, so an ID planted before login (session fixation) is worthless.
   */
  regenerate() {
    if (this.replacedId === null && !this._isNew)
      this.replacedId = this.loadedId;
    this._id = newSessionId();
    this._isNew = true;
    this._dirty = true;
    return this;
  }

  /** End the session: its data is deleted and the cookie cleared. */
  destroy() {
    this._destroyed = true;
    return this;
  }

  /** @internal What to persist when the response is sent. */
  snapshot() {
    const data: SessionData = { ...this.values };
    if (Object.keys(this.nextFlash).length)
      data[FLASH_KEY] = { ...this.nextFlash };
    return {
      data,
      dirty: this._dirty,
      destroyed: this._destroyed,
      loadedId: this.loadedId,
      replacedId: this.replacedId,
    };
  }
}

function assertKey(key: string) {
  if (typeof key !== "string" || !key || isReserved(key)) {
    throw new SystemUseError(
      `[Megh] Invalid session key ${JSON.stringify(key)}. Keys starting with "__" are reserved.`,
    );
  }
}

/** `/path?query`, not `//host` or `/\host`, which browsers treat as another site. */
function isLocalPath(url: string) {
  return /^\/(?![/\\])/.test(url) && !/[\r\n]/.test(url);
}

function newSessionId() {
  return randomBytes(24).toString("base64url");
}

// ─── Access ──────────────────────────────────────────────────────────────────

/** @internal The request-context key holding the session. */
export const SESSION_CONTEXT_KEY =
  createContextKey<MeghSession>("megh:session");

/** The current request's session, or `undefined` without `useSession()` or outside a request. */
export function currentSession(): MeghSession | undefined {
  return requestContext.get(SESSION_CONTEXT_KEY);
}

/** @internal The session `useSession()` attached to a request. */
export function sessionOf(request: unknown): MeghSession | undefined {
  return (request as { session?: MeghSession } | null)?.session;
}

// ─── Cookie signing ──────────────────────────────────────────────────────────

function sign(id: string, secret: string) {
  return createHmac("sha256", secret).update(id).digest("base64url");
}

/** The session ID from a signed cookie value, or `null` if it doesn't verify. */
export function unsignSessionId(
  value: string,
  secrets: string[],
): string | null {
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const id = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  for (const secret of secrets) {
    const expected = Buffer.from(sign(id, secret));
    if (expected.length === given.length && timingSafeEqual(expected, given)) {
      return id;
    }
  }
  return null;
}

function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function appendSetCookie(reply: FastifyReply, cookie: string) {
  const existing = reply.getHeader("set-cookie");
  const list =
    existing === undefined
      ? []
      : Array.isArray(existing)
        ? existing.map(String)
        : [String(existing)];
  reply.header("set-cookie", [...list, cookie]);
}

// ─── Login redirect ──────────────────────────────────────────────────────────

/** A browser navigation or form post, as opposed to an API or XHR call. */
function wantsHtml(request: FastifyRequest) {
  const xrw = request.headers["x-requested-with"];
  if (typeof xrw === "string" && xrw.toLowerCase() === "xmlhttprequest") {
    return false;
  }
  return String(request.headers.accept ?? "").includes("text/html");
}

/**
 * @internal The exception filter `loginPath` installs: a 401 for a browser
 * becomes a redirect to the login page.
 */
export function loginRedirectFilter(loginPath: string) {
  if (typeof loginPath !== "string" || !isLocalPath(loginPath)) {
    throw new SystemUseError(
      `[Megh] Session loginPath must be a path on this site, such as "/login"; got ${JSON.stringify(loginPath)}.`,
    );
  }
  const loginRoute = loginPath.split("?")[0];
  return (_error: unknown, ctx: ErrorContext) => {
    const { request, reply } = ctx;
    if (ctx.response.statusCode !== 401 || !wantsHtml(request))
      return undefined;
    // The login page itself must not loop.
    if (request.url.split("?")[0] === loginRoute) return undefined;
    const isGet = request.method === "GET" || request.method === "HEAD";
    if (isGet) sessionOf(request)?.rememberIntended(request.url);
    // 303 turns a form POST into a GET of the login page.
    return reply.redirect(loginPath, isGet ? 302 : 303);
  };
}

// ─── Install ─────────────────────────────────────────────────────────────────

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function resolveSecrets(secret: SessionOptions["secret"]): string[] {
  const given = secret ?? process.env.SESSION_SECRET;
  const secrets = (Array.isArray(given) ? given : given ? [given] : []).filter(
    (s) => typeof s === "string",
  );
  if (!secrets.length) {
    throw new SystemUseError(
      "[Megh] useSession() needs a secret: pass { secret } or set SESSION_SECRET.",
    );
  }
  if (secrets.some((s) => s.length < 32)) {
    throw new SystemUseError(
      "[Megh] The session secret must be at least 32 characters.",
    );
  }
  return secrets;
}

function resolveMaxAge(maxAge: number | string): number {
  try {
    return parseWindow(maxAge);
  } catch {
    throw new SystemUseError(
      `[Megh] Invalid session maxAge ${JSON.stringify(maxAge)}. Use milliseconds or a duration such as '2h' or '7 days'.`,
    );
  }
}

/**
 * Load the session in `onRequest` and save it in `onSend`. Returns the
 * store, so the app can close it on shutdown when it created it.
 */
export function installSession(
  app: FastifyInstance,
  options: SessionOptions = {},
): { store: SessionStore; ownsStore: boolean } {
  const secrets = resolveSecrets(options.secret);
  const name = options.cookieName ?? "megh_session";
  if (!COOKIE_NAME.test(name)) {
    throw new SystemUseError(`[Megh] Invalid session cookie name "${name}".`);
  }
  const ttlMs = resolveMaxAge(options.maxAge ?? "2h");
  if (options.loginPath !== undefined) loginRedirectFilter(options.loginPath); // validate early
  const cookie = options.cookie ?? {};
  if (cookie.sameSite === "none" && cookie.secure === false) {
    throw new SystemUseError(
      "[Megh] A session cookie with sameSite: 'none' must be secure.",
    );
  }
  const ownsStore = !options.store;
  const store =
    options.store ??
    (options.redis
      ? new RedisSessionStore(options.redis)
      : new MemorySessionStore());

  const serialize = (
    request: FastifyRequest,
    value: string,
    maxAgeMs: number,
  ) => {
    const secure =
      (cookie.secure ?? "auto") === "auto"
        ? request.protocol === "https" || cookie.sameSite === "none"
        : cookie.secure === true;
    const parts = [
      `${name}=${encodeURIComponent(value)}`,
      `Path=${cookie.path ?? "/"}`,
      `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    ];
    if (maxAgeMs === 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    if (cookie.domain) parts.push(`Domain=${cookie.domain}`);
    if (cookie.httpOnly ?? true) parts.push("HttpOnly");
    const sameSite = cookie.sameSite ?? "lax";
    parts.push(`SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`);
    if (secure) parts.push("Secure");
    return parts.join("; ");
  };

  app.decorateRequest("session", undefined as unknown as MeghSession);

  app.addHook("onRequest", async (request) => {
    const raw = readCookie(request.headers.cookie, name);
    const id = raw ? unsignSessionId(raw, secrets) : null;
    const data = id ? await store.get(id) : null;
    const session = data
      ? new MeghSession(id, data)
      : new MeghSession(null, null);
    (request as unknown as { session: MeghSession }).session = session;
    if (requestContext.active) requestContext.set(SESSION_CONTEXT_KEY, session);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const session = sessionOf(request);
    if (!session) return payload;
    const state = session.snapshot();
    const hadCookie = state.loadedId !== null;

    if (state.replacedId) await store.destroy(state.replacedId);

    const empty = Object.keys(state.data).length === 0;
    if (state.destroyed || (empty && !session.isNew && state.dirty)) {
      if (state.loadedId) await store.destroy(state.loadedId);
      if (session.id !== state.loadedId) await store.destroy(session.id);
      if (hadCookie || state.replacedId)
        appendSetCookie(reply, serialize(request, "", 0));
      return payload;
    }
    // A new visitor with nothing stored gets no cookie.
    if (empty && session.isNew) return payload;
    if (state.dirty || session.isNew || options.rolling) {
      await store.set(session.id, state.data, ttlMs);
      appendSetCookie(
        reply,
        serialize(
          request,
          `${session.id}.${sign(session.id, secrets[0])}`,
          ttlMs,
        ),
      );
    }
    return payload;
  });

  return { store, ownsStore };
}
