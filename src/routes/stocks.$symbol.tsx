import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/stocks/$symbol")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$symbol", params: { symbol: params.symbol } });
  },
  component: () => null,
});
