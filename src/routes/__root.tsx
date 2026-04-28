import type { ReactNode } from "react";
import { useState } from "react";
import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "../components/ui/button";
import { getSession } from "../server/session";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Bursa — Shared AI Stock Analysis" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "alternate icon", href: "/favicon.ico" },
      { rel: "manifest", href: "/manifest.json" },
    ],
  }),
  beforeLoad: async () => {
    const session = await getSession();
    return {
      session,
      walletBalance: session?.walletBalance ?? 0,
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
      <div style={{ fontSize: 64, fontWeight: 700, color: "var(--fg-subtle)" }}>404</div>
      <p style={{ color: "var(--fg-muted)" }}>Page not found</p>
      <Button asChild size="sm">
        <a href="/">Go home</a>
      </Button>
    </div>
  ),
});

function RootComponent() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RootDocument>
        <Outlet />
      </RootDocument>
    </QueryClientProvider>
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
