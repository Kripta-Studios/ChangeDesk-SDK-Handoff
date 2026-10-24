import { describe, expect, it } from "vitest";
import { parseBendVerdict } from "../../apps/service/src/laws/verdict.js";

describe("Bend verdict parser", () => {
  it("accepts only an unambiguous kernel verdict with exit zero", () => {
    expect(parseBendVerdict({ exitCode: 0, stdout: "ALL PROOFS CHECK\n", stderr: "" })).toEqual({ status: "verified" });
  });

  it.each([
    ["unsafe", "ALL PROOFS CHECK\n1 term annotated as unsafe."],
    ["foreign", "ALL PROOFS CHECK\nforeign definition used"],
    ["ambiguous", "ALL PROOFS CHECK\nSOME PROOFS FAIL"],
    ["missing", "All terms check"],
  ])("rejects %s output even with exit zero", (_name, stdout) => {
    expect(parseBendVerdict({ exitCode: 0, stdout, stderr: "" })).toMatchObject({ status: "failed" });
  });

  it("classifies proof failure separately from unavailable infrastructure", () => {
    expect(parseBendVerdict({ exitCode: 1, stdout: "SOME PROOFS FAIL", stderr: "proof mismatch" })).toMatchObject({ status: "failed" });
    expect(parseBendVerdict({ exitCode: null, stdout: "", stderr: "timeout", infrastructureFailure: "timeout" })).toEqual({ status: "unavailable", reason: "timeout" });
  });
});
