export class ApiError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string, public readonly retryable = false, public readonly details?: unknown) { super(message); }
}
export const badRequest = (code: string, message: string) => new ApiError(400, code, message);
export const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "Authentication is required");
export const forbidden = () => new ApiError(403, "FORBIDDEN", "The action is not permitted");
export const notFound = () => new ApiError(404, "NOT_FOUND", "The resource was not found");
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
