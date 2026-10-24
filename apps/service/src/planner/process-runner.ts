import { spawn } from "node:child_process";

export interface ProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly env?: Readonly<Record<string, string>>;
}
export interface ProcessResult { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string; readonly timedOut: boolean; readonly overflowed: boolean; }
export interface ProcessRunner { run(request: ProcessRequest, signal?: AbortSignal): Promise<ProcessResult>; }

export class FixedArgvProcessRunner implements ProcessRunner {
  run(request: ProcessRequest, signal?: AbortSignal): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(request.executable, [...request.args], {
        cwd: request.cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        env: request.env ? { ...request.env } : undefined,
      });
      let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), timedOut = false, overflowed = false, settled = false;
      const terminate = () => {
        if (child.pid && process.platform === "win32") {
          const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
          killer.unref();
        }
        child.kill("SIGKILL");
      };
      const timeout = setTimeout(() => { timedOut = true; terminate(); }, request.timeoutMs);
      const abort = () => terminate(); signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => { stdout = Buffer.concat([stdout, chunk]); if (stdout.length > request.maxStdoutBytes) { overflowed = true; terminate(); } });
      child.stderr.on("data", (chunk: Buffer) => { stderr = Buffer.concat([stderr, chunk]); if (stderr.length > request.maxStderrBytes) { overflowed = true; terminate(); } });
      child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timeout); signal?.removeEventListener("abort", abort); reject(error); } });
      child.on("close", (exitCode) => { if (!settled) { settled = true; clearTimeout(timeout); signal?.removeEventListener("abort", abort); resolve({ exitCode, stdout: stdout.subarray(0, request.maxStdoutBytes).toString("utf8"), stderr: stderr.subarray(0, request.maxStderrBytes).toString("utf8"), timedOut, overflowed }); } });
      child.stdin.end(request.stdin);
    });
  }
}
