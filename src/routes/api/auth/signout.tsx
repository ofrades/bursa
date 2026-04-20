import { createFileRoute } from "@tanstack/react-router";
import { clearSessionCookie } from "../../../lib/session";

export const Route = createFileRoute("/api/auth/signout")({
  server: {
    handlers: {
      POST: () =>
        new Response(null, {
          status: 302,
          headers: { Location: "/", "Set-Cookie": clearSessionCookie() },
        }),
    },
  },
});
