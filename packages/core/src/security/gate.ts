/**
 * Gates: named permission checks, written once and used in controllers
 * (`gate.authorize(...)`) and views (`@can(...)`).
 *
 *   app.defineGate("edit-post", (user: User, post: Post) => user.id === post.authorId);
 *
 *   // controller
 *   gate.authorize("edit-post", post);   // 403 when denied
 *
 *   // view
 *   @can('edit-post', post) <a href="...">Edit</a> @endcan
 */
import { Injectable } from "../di";
import { SystemUseError } from "../common/exceptions/system-exception";
import {
  ForbiddenException,
  UnauthorizedException,
} from "../errors/http-exceptions";
import { requestContext } from "../observability/request-context";

/**
 * A permission check. It gets the authenticated user and the arguments
 * passed to `@can` / `allows`. It must answer synchronously, because views
 * render synchronously: load what it needs before rendering.
 */
export type GateCheck<TUser = any, TArgs extends unknown[] = any[]> = (
  user: TUser,
  ...args: TArgs
) => boolean;

const checks = new Map<string, GateCheck>();

/** @internal Register a gate. `app.defineGate()` calls this. */
export function defineGate(name: string, check: GateCheck) {
  if (typeof name !== "string" || !name) {
    throw new SystemUseError("[Megh] A gate needs a name.");
  }
  if (typeof check !== "function") {
    throw new SystemUseError(
      `[Megh] Gate "${name}" needs a check function, e.g. (user, post) => user.id === post.authorId.`,
    );
  }
  if (checks.has(name)) {
    throw new SystemUseError(`[Megh] Gate "${name}" is already defined.`);
  }
  checks.set(name, check);
}

/** @internal Remove every gate (tests). */
export function clearGates() {
  checks.clear();
}

function run(name: string, user: unknown, args: unknown[]): boolean {
  const check = checks.get(name);
  if (!check) {
    throw new SystemUseError(
      `[Megh] No gate named "${name}". Define it with app.defineGate("${name}", check).`,
    );
  }
  // Guests are denied without calling the check.
  if (user == null) return false;
  const result: unknown = check(user, ...args);
  if (result && typeof (result as Promise<unknown>).then === "function") {
    throw new SystemUseError(
      `[Megh] Gate "${name}" returned a Promise. Gates must answer synchronously; load the data first and pass it in.`,
    );
  }
  return result === true;
}

/**
 * Checks gates for the current request's user (what `useAuthentication()`
 * resolved). Inject it, or use the exported {@link gate}.
 */
@Injectable()
export class Gate {
  /** Does the current user pass `name`? Guests never do. */
  allows(name: string, ...args: unknown[]): boolean {
    return run(name, requestContext.user, args);
  }

  denies(name: string, ...args: unknown[]): boolean {
    return !this.allows(name, ...args);
  }

  /**
   * Throw unless the current user passes `name`: 401 for a guest, 403 for
   * a user who is denied.
   */
  authorize(name: string, ...args: unknown[]): void {
    const user = requestContext.user;
    if (!run(name, user, args)) {
      if (user == null) throw new UnauthorizedException("Unauthorized");
      throw new ForbiddenException("Forbidden");
    }
  }

  /** Check gates for another user, e.g. in a job or an admin screen. */
  forUser(user: unknown) {
    return {
      allows: (name: string, ...args: unknown[]) => run(name, user, args),
      denies: (name: string, ...args: unknown[]) => !run(name, user, args),
    };
  }

  /** Is a gate with this name defined? */
  has(name: string): boolean {
    return checks.has(name);
  }
}

/** The {@link Gate}, for code outside DI. */
export const gate = new Gate();
