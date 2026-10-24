import type { FastifyInstance } from "fastify";
import { runApiAttack, type BackendSnapshot, type EffectExpectation } from "./backend-oracle.js";

export interface AttackHttpRequest {
  readonly method: "GET" | "POST" | "OPTIONS";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly payload?: unknown;
}

/** Uses the production Fastify router while keeping state capture independent of its response body. */
export function createFastifyAttackHarness(app: FastifyInstance, capture: () => Promise<BackendSnapshot>) {
  return {
    attack(request: AttackHttpRequest, expectation: EffectExpectation) {
      return runApiAttack({
        capture,
        inject: () => app.inject({ method: request.method, url: request.url, ...(request.headers === undefined ? {} : { headers: request.headers }), ...(request.payload === undefined ? {} : { payload: request.payload }) }),
        expectation,
      });
    },
  };
}
