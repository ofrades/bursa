import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuthenticatedUser, type AuthenticatedUser } from "../lib/auth";

export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthenticatedUser | null> => getAuthenticatedUser(getRequest()),
);
