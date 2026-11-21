---
title: Mail
description: Send email with mailable classes, over SMTP or a provider's API, now or from a queue.
---

# Mail

Megh sends email through **mailables**: one class per kind of email, holding
its subject, body and attachments. The injected `Mailer` sends them through a
**mailer**, which is SMTP or a provider's HTTP API. Mail can be sent straight
away or queued.

SMTP goes through [Nodemailer](https://nodemailer.com), an optional peer
dependency:

```sh
npm i nodemailer
```

The SendGrid, Mailgun, Postmark and Resend mailers call the provider's API with
Node's built-in `fetch`, so they need no extra package.

## Turning mail on

```ts [src/app.ts]
app.useMail();
```

`useMail()` reads its settings from `MEGH_MAIL_*` variables in `.env`:

```ini [.env]
MEGH_MAIL_MAILER=smtp
MEGH_MAIL_HOST=smtp.example.com
MEGH_MAIL_PORT=587
MEGH_MAIL_USERNAME=apikey
MEGH_MAIL_PASSWORD=secret
MEGH_MAIL_ENCRYPTION=tls
MEGH_MAIL_FROM_ADDRESS=hello@example.com
MEGH_MAIL_FROM_NAME="Example"
```

Anything passed to `useMail()` overrides `.env`, either as an object or as an
`@AppConfig` class that returns one:

```ts
app.useMail({ from: 'Shop <shop@example.com>' });
app.useMail(MailSettings); // @AppConfig class MailSettings extends MeghConfig<MailConfig>
```

[Setting it up](#setting-it-up) lists the steps for a new project.

### Which mailer is used

`MEGH_MAIL_MAILER` (or `default` in `useMail()`) names the mailer. When it is
not set:

| Situation | Mailer |
| --- | --- |
| `MEGH_MAIL_HOST` is set | `smtp` |
| `NODE_ENV=development` | `log`: messages are written to the log, not sent |
| `NODE_ENV=test` | `array`: messages are kept in memory |
| Otherwise (production) | none. `useMail()` throws at startup |

The last row is deliberate: a production app with no mailer fails when it
starts, instead of dropping mail without anyone noticing.

The default mailer is also checked at startup. A missing host, API key or
domain fails `useMail()` with the setting to fix, for example:

```
[Megh Mail] The default mailer "sendgrid" needs an API key: set MEGH_MAIL_SENDGRID_API_KEY or apiKey.
```

Other mailers are checked the first time they are used.

## Writing a mailable

Generate one with the CLI:

```sh
npx megh make:mail OrderShipped
```

```ts [src/mail/order-shipped.mail.ts]
import { Mailable } from '@meghjs/core';
import { Order } from '../models/order.model';

export class OrderShippedMail extends Mailable {
  constructor(private readonly order: Order) {
    super();
  }

  envelope() {
    return {
      subject: `Order #${this.order.id} has shipped`,
      replyTo: 'support@example.com',
    };
  }

  content() {
    return {
      html: `<p>Your order is on its way. Track it at ${this.order.trackingUrl}.</p>`,
      text: `Your order is on its way. Track it at ${this.order.trackingUrl}.`,
    };
  }

  attachments() {
    return [{ filename: 'invoice.pdf', path: `storage/invoices/${this.order.id}.pdf` }];
  }
}
```

| Method | Returns | Notes |
| --- | --- | --- |
| `envelope()` | `{ subject?, from?, replyTo?, to?, cc?, bcc?, headers? }` | All optional. The subject defaults to the class name as words (`OrderShippedMail` → "Order Shipped Mail"). `from` overrides `MEGH_MAIL_FROM_*`. |
| `content()` | `{ html?, text? }` | Required. Give `html`, `text` or both. |
| `attachments()` | `MailAttachment[]` | Optional. Each is `{ filename?, content?, path?, contentType?, cid? }`. `path` is a file, a `data:` URI, or an `http(s)` URL when `allowUrlAccess` is on. See [Attachment paths](#attachment-paths). |

Each method may be `async`, to load data or render a template.

An address can be written as `'ann@example.com'`, `'Ann <ann@example.com>'` or
`{ name: 'Ann', address: 'ann@example.com' }`. Addresses, subjects and headers
that contain a line break are rejected, so user input cannot inject headers.

Each address must be a single `local@domain`. Megh rejects one that contains
a space, `,`, `;`, `<`, `>` or `"`, such as `'ann@example.com, evil@example.com'`,
so an address taken from user input (a password reset, an invite, a contact
form) can't add a second recipient. Pass several addresses as separate
arguments instead: `to('ann@example.com', 'lee@example.com')`. A display name
with a comma must be quoted (`'"Lee, Ann" <ann@example.com>'`) or given as an
object.

### Inline images

Give the attachment a `cid` and use it in the HTML:

```ts
content() {
  return { html: `<img src="cid:logo"> Welcome!` };
}

attachments() {
  return [{ filename: 'logo.png', path: 'public/logo.png', cid: 'logo' }];
}
```

### Attachment paths

An attachment's `path` is read when the message is sent. If any part of it
comes from user input (`{ path: dto.file }`), a client could make the app
read `/etc/passwd` or fetch `http://169.254.169.254/` (cloud metadata) and
mail the result out. Megh checks every path when the message is built, for
every mailer, SMTP included:

| Option on `useMail()` | Default | |
|---|---|---|
| `allowUrlAccess` | `false` | Allow `http(s)://` paths. Other schemes are always refused. |
| `allowFileAccess` | `true` | Allow local file paths. |
| `attachmentRoot` | | Only read files inside this folder. Relative paths resolve against it, and symlinks can't lead out. |

```ts
app.useMail({
  attachmentRoot: 'storage/invoices', // invoice.pdf → storage/invoices/invoice.pdf
  allowUrlAccess: true,               // only if every URL is yours
});
```

A refused path throws `MailError` before anything is sent. `content` (a
string or `Buffer`) and `data:` URIs are always allowed, so the safest way to
attach something from user input is to read it yourself and pass `content`.

## Sending

Inject `Mailer` like any service:

```ts [src/services/order.service.ts]
import { AppService, Mailer } from '@meghjs/core';
import { OrderShippedMail } from '../mail/order-shipped.mail';

@AppService
export class OrderService {
  constructor(private readonly mailer: Mailer) {}

  async ship(order: Order) {
    // ...
    await this.mailer.to(order.customerEmail).send(new OrderShippedMail(order));
  }
}
```

`to()`, `cc()` and `bcc()` each take one or more addresses and can be chained:

```ts
await this.mailer
  .to(order.customerEmail)
  .cc('sales@example.com')
  .bcc(['audit@example.com', 'archive@example.com'])
  .send(new OrderShippedMail(order));
```

Recipients returned by `envelope()` are added to these. `send()` resolves to
`{ mailer, message, messageId?, response? }`: the mailer used, the built
message, and the provider's message ID and raw reply.

To use a mailer other than the default, name it:

```ts
await this.mailer.mailer('postmark').to(user.email).send(new ReceiptMail(user));
```

## Mailers

| Mailer | Settings in `.env` | `useMail({ mailers })` options |
| --- | --- | --- |
| `smtp` | `MEGH_MAIL_HOST`, `MEGH_MAIL_PORT`, `MEGH_MAIL_USERNAME`, `MEGH_MAIL_PASSWORD`, `MEGH_MAIL_ENCRYPTION` | `host`, `port`, `username`, `password`, `encryption`, `options` |
| `sendgrid` | `MEGH_MAIL_SENDGRID_API_KEY` | `apiKey`, `endpoint`, `timeout` |
| `mailgun` | `MEGH_MAIL_MAILGUN_API_KEY`, `MEGH_MAIL_MAILGUN_DOMAIN`, `MEGH_MAIL_MAILGUN_ENDPOINT` | `apiKey`, `domain`, `endpoint`, `timeout` |
| `postmark` | `MEGH_MAIL_POSTMARK_TOKEN`, `MEGH_MAIL_POSTMARK_MESSAGE_STREAM` | `token`, `messageStream`, `endpoint`, `timeout` |
| `resend` | `MEGH_MAIL_RESEND_API_KEY` | `apiKey`, `endpoint`, `timeout` |
| `failover` | `MEGH_MAIL_FAILOVER=sendgrid,smtp` | `mailers: string[]` |
| `log` | | |
| `array` | | |

### SMTP encryption

| `MEGH_MAIL_ENCRYPTION` | Meaning | Usual port |
| --- | --- | --- |
| `ssl` | TLS from the first byte | 465 |
| `tls` | STARTTLS, and refuse to send without it | 587 |
| `none` | Plain, upgraded with STARTTLS when the server offers it | 25 or 1025 |

Left unset, port 465 means `ssl` and any other port means `none`. Extra
[Nodemailer transport options](https://nodemailer.com/smtp/) (pooling, timeouts,
DKIM) go in `options`:

```ts
app.useMail({
  mailers: { smtp: { transport: 'smtp', options: { pool: true, maxConnections: 5 } } },
});
```

### Regional endpoints

EU accounts use a different API host:

```ini
MEGH_MAIL_MAILGUN_ENDPOINT=https://api.eu.mailgun.net
```

```ts
app.useMail({
  mailers: { sendgrid: { transport: 'sendgrid', endpoint: 'https://api.eu.sendgrid.com' } },
});
```

A mailer passed to `useMail()` is merged over the same mailer from `.env`, so
this keeps `MEGH_MAIL_SENDGRID_API_KEY`. A mailer with a different `transport`
replaces it instead.

### Failover

A `failover` mailer tries each mailer in order until one sends. Each failure is
logged as a warning:

```ini
MEGH_MAIL_MAILER=failover
MEGH_MAIL_FAILOVER=sendgrid,smtp
```

When every mailer fails, the error lists each reason. At startup, a failover
default checks that every mailer in its list is configured, so a wrong backup
key is caught before an outage.

### Your own mailer

Any object with a `send(message)` method is a mailer:

```ts
import { MailMessage, MailTransport } from '@meghjs/core';

class SparkPostTransport implements MailTransport {
  async send(message: MailMessage) {
    const res = await fetch('https://api.sparkpost.com/api/v1/transmissions', {
      method: 'POST',
      headers: { Authorization: process.env.SPARKPOST_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify(toSparkPost(message)),
    });
    return { messageId: (await res.json()).results.id };
  }
}

app.useMail({ default: 'sparkpost', mailers: { sparkpost: new SparkPostTransport() } });
```

`message` is fully built: `from`, `to`, `cc`, `bcc` and `replyTo` as
`{ name?, address }` objects, plus `subject`, `html`, `text`, `attachments` and
`headers`. An optional `close()` method is called when the app shuts down.

### Errors

When a provider refuses a message, `send()` throws a `MailTransportError` with
`provider`, `status` (the HTTP status) and `body` (the provider's response).
Mistakes in a mailable, such as no recipients, no sender or no body, throw a
`MailError` that names the class.

## Queueing mail

Sending inside a request makes the client wait for the mail server. Queue the
mail instead, and a worker sends it in the background. Queueing uses
[Megh's queue](/advanced/queue), so it needs `bullmq` and Redis (or the
`memory` driver):

```ts [src/app.ts]
app.useMail({ queue: true });
```

```ts
await this.mailer.to(user.email).queue(new WelcomeMail(user));
await this.mailer.to(user.email).later(60_000, new ReminderMail(user)); // in a minute
await this.mailer.to(user.email).later(new Date('2026-12-24T09:00:00Z'), new GreetingMail(user));
```

`queue()` and `later()` resolve to `{ mailer, message, jobId, delay }`.

The message is **built when you queue it**, and the job holds that built
message. The worker only delivers it, through the mailer named when it was
queued. Two consequences:

- A mistake in the mailable throws from `queue()`, in your request, not later
  in the worker.
- An attachment given by `path` is read when the mail is sent, so the file must
  exist where the worker runs. `Buffer` attachments travel inside the job.

### Queue options

```ts
app.useMail({
  queue: {
    name: 'mail', // the default
    adapter: { connection: { host: '127.0.0.1', port: 6379 } },
    driver: 'bullmq', // or 'memory' / 'sync'; defaults to MEGH_QUEUE_DRIVER
    worker: { concurrency: 5 }, // or false: see below
    jobOptions: { attempts: 5 },
  },
});
```

By default a job is tried 3 times, 10 then 20 seconds apart. Sent jobs are
removed, since they hold email addresses. Failed jobs are kept, so you can
inspect them.

The worker starts as soon as `useMail({ queue })` runs, so mail queued before a
restart is still sent. In a process that should only queue mail, while another
process sends it, pass `worker: false`.

Calling `queue()` without the `queue` option throws, instead of quietly
creating a queue.

## Testing

`Mailer.fake()` records mail instead of sending it, and gives you assertions.
The mailable is still built, so a broken one fails the test.

```ts
import { Mailer } from '@meghjs/core';

it('sends a welcome mail', async () => {
  const mail = Mailer.fake();

  await signup.register('ann@example.com');

  mail.assertSent(WelcomeMail, (sent) => sent.hasTo('ann@example.com'));
  mail.assertNotSent(PasswordResetMail);
  mail.restore();
});
```

| Assertion | Passes when |
| --- | --- |
| `assertSent(Type, check?)` | A `Type` was sent with `send()` (and passed `check`) |
| `assertSent(Type, n)` | A `Type` was sent exactly `n` times |
| `assertNotSent(Type, check?)` | No `Type` (passing `check`) was sent |
| `assertNothingSent()` | Nothing was sent |
| `assertSentCount(n)` | `n` messages were sent in all |
| `assertQueued(Type, check? \| n)` | A `Type` was queued with `queue()` or `later()` |
| `assertNotQueued(Type, check?)` | No `Type` (passing `check`) was queued |
| `assertNothingQueued()` | Nothing was queued |

The `check` receives a `SentMail`:

- `sent.mailable`: your instance.
- `sent.message`: the built message.
- `sent.delay`: for queued mail, the delay in milliseconds.
- `sent.hasTo(address)`, `hasCc()`, `hasBcc()` and `hasFrom()`: compare
  addresses case-insensitively.

`sent`, `queued`, `sentOf(Type, check?)` and `queuedOf(Type, check?)` give you
the recorded mail itself.

A failed assertion explains itself, and points out mail that was queued when
you expected it sent, or the reverse:

```
Expected WelcomeMail to be sent, but it was not. Nothing was sent. It was queued instead; use assertQueued().
```

## Setting it up

1. Install the SMTP transport: `npm i nodemailer`. The API mailers don't need
   it.
2. Call `app.useMail()` in `src/app.ts`.
3. Generate a mailable: `npx megh make:mail Welcome`.
4. Add the mail settings to `.env`:

```ini [.env]
# Mail: app.useMail(). With no MEGH_MAIL_MAILER, mail goes to the log in
# development, and the app will not start in production until one is set.
# MEGH_MAIL_MAILER=smtp
# MEGH_MAIL_HOST=127.0.0.1
# MEGH_MAIL_PORT=1025
# MEGH_MAIL_USERNAME=
# MEGH_MAIL_PASSWORD=
# MEGH_MAIL_ENCRYPTION=tls
# Or an API mailer: sendgrid, mailgun, postmark or resend.
# MEGH_MAIL_SENDGRID_API_KEY=
MEGH_MAIL_FROM_ADDRESS=hello@example.com
MEGH_MAIL_FROM_NAME="Shop"
```

`npm run start:dev` then writes every mail to the console. To see real
messages during development, run a local mail catcher such as
[Mailpit](https://mailpit.axllent.org) and point SMTP at it:

```ini
MEGH_MAIL_HOST=127.0.0.1
MEGH_MAIL_PORT=1025
```

Mailpit's inbox is at `http://localhost:8025`.
