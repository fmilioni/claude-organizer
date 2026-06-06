/**
 * Error raised when a client-supplied input violates a business rule that
 * Zod can't express on its own (e.g. referencing a row that doesn't exist,
 * or an illegal hierarchy move). The API maps it to HTTP 400; it stays a
 * plain `Error` subclass so other callers (the MCP) keep working unchanged.
 */
export class InputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InputError'
  }
}

/**
 * Error raised when a well-formed request conflicts with the current state of
 * the system (e.g. removing the last admin would lock everyone out of the
 * admin-only surface). The API maps it to HTTP 409.
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}
