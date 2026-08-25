import { Effect } from "effect";
import {
  ApiError,
  ExternalServiceError,
  NotConfiguredError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "./errors";

const statusFor = (error: ApiError): number => {
  switch (true) {
    case error instanceof UnauthorizedError:
      return 401;
    case error instanceof ValidationError:
      return 400;
    case error instanceof NotFoundError:
      return 404;
    case error instanceof NotConfiguredError:
      return 500;
    case error instanceof ExternalServiceError:
      return 502;
    default:
      return 500;
  }
};

/** Run an API effect and turn typed failures into JSON responses. */
export function toResponse<A>(
  effect: Effect.Effect<A, ApiError, never>,
  success: (value: A) => Response,
): Promise<Response> {
  return Effect.runPromise(
    effect.pipe(
      Effect.map(success),
      Effect.catch((error) =>
        Effect.succeed(Response.json({ error: error._tag }, { status: statusFor(error) })),
      ),
      Effect.catchDefect(() =>
        Effect.succeed(Response.json({ error: "InternalError" }, { status: 500 })),
      ),
    ),
  );
}
