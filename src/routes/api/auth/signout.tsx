import { createFileRoute } from "@tanstack/react-router";
import { clearSessionCookie } from "../../../lib/session";
import { getAuthenticatedUser } from "../../../lib/auth";
import { getDb } from "../../../lib/db";
import { user } from "../../../lib/schema";
import { eq, sql } from "drizzle-orm";

export const Route = createFileRoute("/api/auth/signout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await getAuthenticatedUser(request);
        if (session) {
          await getDb()
            .update(user)
            .set({ sessionVersion: sql`${user.sessionVersion} + 1` })
            .where(eq(user.id, session.sub));
        }
        return new Response(null, {
          status: 302,
          headers: { Location: "/", "Set-Cookie": clearSessionCookie() },
        });
      },
    },
  },
});
