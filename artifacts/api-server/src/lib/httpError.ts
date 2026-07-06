/**
 * Error type for failures whose message is deliberately written for the
 * client (Security Phase G).
 *
 * The global error handler (and per-route catch blocks) forward `message`
 * to the HTTP response ONLY for errors that are marked safe — either an
 * instance of this class or a 4xx status. Unexpected errors (DB drivers,
 * Drizzle, third-party SDKs) can carry SQL text or internals in `message`
 * and must never reach a client.
 *
 * Usage:
 *   throw new ExposableHttpError(404, "Package order not found");
 */
export class ExposableHttpError extends Error {
  readonly status: number;
  /** http-errors convention: marks the message as client-safe. */
  readonly expose = true;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ExposableHttpError";
    this.status = status;
  }
}
