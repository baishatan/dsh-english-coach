/**
 * One failure shape for every command. The agent reads `code` and `field` to
 * fix its call; the panel renders `message`. Commands never throw across the
 * tool boundary — they resolve to `{ ok: false, ... }`.
 */
export class CommandError extends Error {
  constructor(code, message, field) {
    super(message)
    this.name = 'CommandError'
    this.code = code
    this.field = field
    this.isCommandError = true
  }
}

export function fail(code, message, field) {
  throw new CommandError(code, message, field)
}
