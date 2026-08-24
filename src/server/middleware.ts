import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuthenticatedUser } from "../lib/auth";

type AuthContext = {
  session: import("../lib/auth").AuthenticatedUser | null;
  walletBalance: number;
  isAdmin: boolean;
};

export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await getAuthenticatedUser(getRequest());
  if (!session)
    return next({ context: { session: null, walletBalance: 0, isAdmin: false } as AuthContext });
  const { walletBalance, isAdmin } = session;

  return next({
    context: {
      session,
      walletBalance,
      isAdmin,
    } as AuthContext,
  });
});
