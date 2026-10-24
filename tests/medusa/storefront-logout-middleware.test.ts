import { describe, expect, it } from "vitest";
import { storefrontLogoutMiddlewares } from "../../packages/medusa-plugin/src/storefront/logout-middleware.ts";

describe("Medusa storefront native logout middleware (unit composition)", () => {
  const compose = () => {
    const effects: string[] = [];
    const authenticate = (actorTypes: string[], methods: string[]) => (
      request: { auth_context?: { actor_type?: string }; sessionAuthenticated?: boolean },
      _response: unknown,
      next: (error?: Error) => void,
    ) => {
      const actorType = request.auth_context?.actor_type;
      if (!methods.includes("session") || !request.sessionAuthenticated || !actorType || !actorTypes.includes(actorType)) return next(new Error("unauthorized"));
      effects.push(`authenticated:${actorType}`);
      return next();
    };
    const revoke = (request: { auth_context?: { actor_type?: string } }, _response: unknown, next: (error?: Error) => void) => {
      if (request.auth_context?.actor_type === "user") effects.push("staff-revoked");
      else effects.push("customer-native-destroy-next");
      return next();
    };
    return { effects, middlewares: storefrontLogoutMiddlewares(authenticate(["user", "customer"], ["session"]), revoke) };
  };

  it.each([
    ["customer", ["authenticated:customer", "customer-native-destroy-next"]],
    ["user", ["authenticated:user", "staff-revoked"]],
  ] as const)("accepts an authenticated %s session and applies the correct hook", (actorType, expected) => {
    const { effects, middlewares } = compose();
    const request = { auth_context: { actor_type: actorType }, sessionAuthenticated: true };
    for (const middleware of middlewares) {
      let failure: Error | undefined;
      middleware(request, {}, (error) => { failure = error; });
      expect(failure).toBeUndefined();
    }
    expect(effects).toEqual(expected);
  });

  it("rejects an anonymous request before invoking the logout hook", () => {
    const { effects, middlewares } = compose();
    let failure: Error | undefined;
    middlewares[0]!({}, {}, (error) => { failure = error; });
    expect(failure?.message).toBe("unauthorized");
    expect(effects).toEqual([]);
  });
});
