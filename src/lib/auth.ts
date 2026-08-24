import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { getSessionFromRequest } from "./session";
import { user } from "./schema";

export type AuthenticatedUser = {
  sub: string;
  email: string;
  name: string;
  image: string | null;
  walletBalance: number;
  isAdmin: boolean;
  sessionVersion: number;
};

export async function getAuthenticatedUser(request: Request): Promise<AuthenticatedUser | null> {
  const session = await getSessionFromRequest(request);
  if (!session) return null;

  const [row] = await getDb()
    .select({
      email: user.email,
      name: user.name,
      image: user.image,
      walletBalance: user.walletBalance,
      role: user.role,
      sessionVersion: user.sessionVersion,
    })
    .from(user)
    .where(eq(user.id, session.sub))
    .limit(1);

  if (!row || row.sessionVersion !== session.ver) return null;
  const isAdmin = row.role === "admin";
  return {
    sub: session.sub,
    email: row.email,
    name: row.name,
    image: row.image,
    walletBalance: isAdmin ? 999_999_00 : row.walletBalance,
    isAdmin,
    sessionVersion: row.sessionVersion,
  };
}
