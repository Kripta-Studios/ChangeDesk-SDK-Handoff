import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { parseBendVerdict } from "./verdict.js";
import type { LawVerificationRequest, LawVerificationResult, LawVerifier } from "./types.js";

const execFileAsync = promisify(execFile);
const REVIEWED_FILES = ["model.bend", "LAWS.bend", "PROOF.bend"] as const;
const HASH = /^[a-f0-9]{64}$/u;
const MAX_RECORDED_OUTPUT = 4_000;

export interface BendVerifierConfig {
  readonly binaryPath: string;
  readonly expectedBinarySha256: string;
  readonly executionBinaryPath: string;
  readonly reviewedSourceDir: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly distribution?: string;
  readonly executionPath?: string;
  readonly bendttPath?: string;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function windowsPathToWsl(path: string): string {
  const matched = /^([A-Za-z]):\\(.*)$/u.exec(path);
  if (!matched) throw new TypeError("Expected an absolute Windows path for WSL execution");
  return `/mnt/${matched[1]!.toLowerCase()}/${matched[2]!.replaceAll("\\", "/")}`;
}

function limited(value: string): string {
  return value.length <= MAX_RECORDED_OUTPUT ? value : `${value.slice(0, MAX_RECORDED_OUTPUT)}\n[truncated]`;
}

function sourceIsReviewed(name: string, source: string): boolean {
  if (/@unsafe|\?TODO|import\s+["']|import\s+(?:0x|[^\s]+@)/iu.test(source)) return false;
  if (name === "model.bend") return !/^\s*law\s+/mu.test(source);
  if (name === "LAWS.bend") return /import \.\/model\.bend as Model/u.test(source);
  return /import \.\/LAWS\.bend as Laws/u.test(source);
}

export class BendLawVerifier implements LawVerifier {
  readonly #config: BendVerifierConfig;

  constructor(config: BendVerifierConfig) {
    if (!isAbsolute(config.binaryPath) || !isAbsolute(config.reviewedSourceDir)) throw new TypeError("Bend paths must be absolute");
    if (!HASH.test(config.expectedBinarySha256)) throw new TypeError("Expected Bend binary SHA-256 must be lowercase hex");
    if (config.timeoutMs < 1 || config.timeoutMs > 120_000 || config.maxOutputBytes < 1 || config.maxOutputBytes > 1_000_000) throw new TypeError("Bend limits are outside the reviewed bounds");
    this.#config = Object.freeze({ ...config });
  }

  async verify(request: LawVerificationRequest, signal?: AbortSignal): Promise<LawVerificationResult> {
    const started = performance.now();
    let binarySha256 = "";
    let modelHash: string | undefined;
    let lawsHash: string | undefined;
    let workDir: string | undefined;
    const finish = (partial: Pick<LawVerificationResult, "status" | "exitCode" | "stdout" | "stderr"> & { readonly reason?: string }): LawVerificationResult => ({
      ...partial,
      scope: request.scope,
      verifierVersion: "2.0.39",
      binarySha256,
      ...(modelHash ? { modelHash } : {}),
      ...(lawsHash ? { lawsHash } : {}),
      durationMs: Math.round(performance.now() - started),
      artifactHash: request.artifactHash,
      planHash: request.planHash,
      policyVersion: request.policyVersion,
    });

    if (!HASH.test(request.artifactHash) || !HASH.test(request.planHash) || request.scope.length < 1 || request.scope.length > 120) {
      return finish({ status: "failed", exitCode: null, stdout: "", stderr: "", reason: "invalid_verification_request" });
    }

    try {
      binarySha256 = sha256(await readFile(this.#config.binaryPath));
      if (binarySha256 !== this.#config.expectedBinarySha256) return finish({ status: "failed", exitCode: null, stdout: "", stderr: "", reason: "binary_hash_mismatch" });

      const sources = new Map<string, string>();
      for (const name of REVIEWED_FILES) {
        const source = await readFile(join(this.#config.reviewedSourceDir, name), "utf8");
        if (!sourceIsReviewed(name, source)) return finish({ status: "failed", exitCode: null, stdout: "", stderr: "", reason: `unreviewed_source:${name}` });
        sources.set(name, source);
      }
      modelHash = sha256(sources.get("model.bend")!);
      lawsHash = sha256(sources.get("LAWS.bend")!);

      workDir = await mkdtemp(join(tmpdir(), "changedesk-bend-"));
      for (const name of REVIEWED_FILES) await copyFile(join(this.#config.reviewedSourceDir, name), join(workDir, name));
      const proofPath = windowsPathToWsl(join(workDir, "PROOF.bend"));
      const environment = ["HOME=/tmp", `PATH=${this.#config.executionPath ?? "/usr/bin:/bin"}`];
      if (this.#config.bendttPath) environment.push(`BENDTT=${this.#config.bendttPath}`);
      const args = [
        "-d", this.#config.distribution ?? "Ubuntu-24.04", "--exec",
        "/usr/bin/unshare", "--user", "--map-root-user", "--net",
        "/usr/bin/env", "-i", ...environment,
        this.#config.executionBinaryPath, proofPath, "--verdict",
      ];
      try {
        const output = await execFileAsync("C:\\Windows\\System32\\wsl.exe", args, {
          cwd: workDir,
          encoding: "utf8",
          timeout: this.#config.timeoutMs,
          maxBuffer: this.#config.maxOutputBytes,
          windowsHide: true,
          ...(signal ? { signal } : {}),
          env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" },
        });
        const parsed = parseBendVerdict({ exitCode: 0, stdout: output.stdout, stderr: output.stderr });
        return finish({ ...parsed, exitCode: 0, stdout: limited(output.stdout), stderr: limited(output.stderr) });
      } catch (error) {
        const observed = error as Error & { readonly code?: number | string; readonly killed?: boolean; readonly stdout?: string; readonly stderr?: string };
        const stdout = observed.stdout ?? "";
        const stderr = observed.stderr ?? observed.message;
        const infrastructureFailure = observed.killed || observed.name === "AbortError"
          ? "timeout_or_aborted"
          : observed.code === "ENOENT"
            ? "verifier_missing"
            : /infrastructure|executable not found|needs Lean/iu.test(stderr)
              ? "kernel_unavailable"
              : undefined;
        const exitCode = typeof observed.code === "number" ? observed.code : null;
        const parsed = parseBendVerdict({ exitCode, stdout, stderr, ...(infrastructureFailure ? { infrastructureFailure } : {}) });
        return finish({ ...parsed, exitCode, stdout: limited(stdout), stderr: limited(stderr) });
      }
    } catch (error) {
      return finish({ status: "unavailable", exitCode: null, stdout: "", stderr: limited(error instanceof Error ? error.message : "unknown error"), reason: "verifier_setup_unavailable" });
    } finally {
      if (workDir) {
        try {
          await rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
          // The bounded verifier result remains authoritative; Windows/WSL can
          // briefly retain a 9p handle. OS temp cleanup is the fallback.
        }
      }
    }
  }
}
