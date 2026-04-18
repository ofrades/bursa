import type { ReactNode } from "react";
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Button } from "../components/ui/button";
import { getSession } from "../server/session";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Bursa — AI-Powered Weekly Analysis" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  beforeLoad: async () => {
    const session = await getSession();
    return {
      session,
      analysisCredits: session?.analysisCredits ?? 0,
      isAdmin: session?.isAdmin ?? false,
    };
  },
  component: RootComponent,
  notFoundComponent: () => (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 64, fontWeight: 700, color: "var(--fg-subtle)" }}>
        404
      </div>
      <p style={{ color: "var(--fg-muted)" }}>Page not found</p>
      <Button asChild size="sm">
        <a href="/">Go home</a>
      </Button>
    </div>
  ),
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
