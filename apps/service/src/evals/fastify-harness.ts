import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { runApiAttack, type BackendSnapshot, type EffectExpectation, type OracleResult } from "./backend-oracle.js";

export interface AttackHttpRequest {
  readonly method: "GET" | "POST" | "OPTIONS";
  readonly url: string;
  readonly headers?: InjectOptions["headers"];
  readonly payload?: InjectOptions["payload"];
}

export interface FastifyAttackResult {
  readonly response: LightMyRequestResponse;
  readonly before: BackendSnapshot;
  readonly after: BackendSnapshot;
  readonly oracle: OracleResult;
}

export interface FastifyAttackHarness {
  attack(request: AttackHttpRequest, expectation: EffectExpectation): Promise<FastifyAttackResult>;
}

/** Uses the production Fastify router while keeping state capture independent of its response body. */
export function createFastifyAttackHarness(app: FastifyInstance, capture: () => Promise<BackendSnapshot>): FastifyAttackHarness {
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
