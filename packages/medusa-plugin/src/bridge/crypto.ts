import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from "node:crypto"
import canonicalize from "canonicalize"
import { BridgeError } from "./errors.ts"

export type Clock = () => number

const encode = (value: Uint8Array | string) =>
  Buffer.from(value).toString("base64url")

const decode = (value: string) => Buffer.from(value, "base64url")

export const stableJson = (value: unknown): string => {
  const result = canonicalize(value)
  if (result === undefined) throw new BridgeError(400, "invalid_value", "Value is not valid I-JSON")
  return result
}

export const sha256Json = (value: unknown) =>
  createHash("sha256")
    .update("changedesk\0bridge-arguments\0", "utf8")
    .update("1", "utf8")
    .update("\0", "utf8")
    .update(stableJson(value), "utf8")
    .digest("hex")

export const sha256ProtectedState = (value: unknown) =>
  createHash("sha256")
    .update("changedesk\0medusa-protected-state\0", "utf8")
    .update("1", "utf8")
    .update("\0", "utf8")
    .update(stableJson(value), "utf8")
    .digest("hex")

export const importPrivateKey = (pem: string): KeyObject => createPrivateKey(pem)
export const importPublicKey = (pem: string): KeyObject => createPublicKey(pem)

export const signEnvelope = <T extends object>(claims: T, privateKey: KeyObject) => {
  const payload = Buffer.from(stableJson(claims), "utf8")
  return `${encode(payload)}.${encode(sign(null, payload, privateKey))}`
}

export const verifyEnvelope = <T extends object>(
  envelope: string,
  publicKey: KeyObject
): T => {
  const parts = envelope.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new BridgeError(401, "invalid_signature", "Malformed signed envelope")
  }
  const payload = decode(parts[0])
  const signature = decode(parts[1])
  if (!verify(null, payload, publicKey, signature)) {
    throw new BridgeError(401, "invalid_signature", "Signature verification failed")
  }
  try {
    return JSON.parse(payload.toString("utf8")) as T
  } catch {
    throw new BridgeError(401, "invalid_claims", "Signed claims are not JSON")
  }
}

export const newJti = () => randomUUID()
