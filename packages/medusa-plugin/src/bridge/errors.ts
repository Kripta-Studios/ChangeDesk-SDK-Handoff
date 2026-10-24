export class BridgeError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "BridgeError"
    this.status = status
    this.code = code
  }
}
