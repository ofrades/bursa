import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ScreenDashboard as ScreenDashboardData } from "../../server/screen";
import { ScreenDashboard } from "../../components/ScreenDashboard";

const { dashboard } = vi.hoisted(() => ({
  dashboard: {
    run: null,
    latest: null,
    previousRunAt: null,
    rows: [],
    entered: [],
    exited: [],
    changes: {},
  } as ScreenDashboardData,
}));
vi.mock("../../server/screen", () => ({
  getScreenDashboard: vi.fn(),
  advanceScreenRun: vi.fn(),
  classifyScreenSurvivors: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ Link: "a" }));

function renderPage() {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ScreenDashboard, { initial: dashboard, isAdmin: false }),
    ),
  );
}

describe("remote screen dashboard", () => {
  it("explains the manual broker check and corrected-methodology empty state", () => {
    const html = renderPage();
    expect(html).toContain("Before buying in Trade Republic");
    expect(html).toContain("not EPS-revision breadth");
    expect(html).toContain("No completed run for the corrected methodology yet");
  });
  it("keeps a failed refresh separate from completed results", () => {
    dashboard.latest = {
      status: "failed",
      processedCount: 371,
      universeCount: 371,
      runAt: "2026-10-05T06:00:00Z",
    };
    expect(renderPage()).toContain("Latest run failed");
    dashboard.latest = null;
  });
});
