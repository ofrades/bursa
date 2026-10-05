import { createFileRoute } from "@tanstack/react-router";
import { getScreenDashboard } from "../server/screen";
import { ScreenDashboard } from "../components/ScreenDashboard";

export const Route = createFileRoute("/screen")({
  loader: () => getScreenDashboard(),
  component: ScreenPage,
});

function ScreenPage() {
  const initial = Route.useLoaderData();
  const isAdmin = Route.useRouteContext().session?.isAdmin ?? false;
  return <ScreenDashboard initial={initial} isAdmin={isAdmin} />;
}
