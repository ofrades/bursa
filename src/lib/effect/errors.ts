import { Schema } from "effect";

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  {},
) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("NotFoundError", {
  resource: Schema.String,
}) {}

export class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  message: Schema.String,
}) {}

export class NotConfiguredError extends Schema.TaggedError<NotConfiguredError>()(
  "NotConfiguredError",
  { setting: Schema.String },
) {}

/** A third-party call failed; `cause` is the wrapped unknown error. */
export class ExternalServiceError extends Schema.TaggedError<ExternalServiceError>()(
  "ExternalServiceError",
  { service: Schema.String, cause: Schema.Defect() },
) {}

export const ApiError = Schema.Union([
  UnauthorizedError,
  NotFoundError,
  ValidationError,
  NotConfiguredError,
  ExternalServiceError,
]);
export type ApiError = typeof ApiError.Type;
