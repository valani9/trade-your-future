import crypto from "node:crypto";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { config } from "@/lib/config";
import { DEMO_EMAIL, getOrCreateUser } from "./users";

const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

function authSecret(): string {
  const configured = process.env.NEXTAUTH_SECRET;
  if (configured) return configured;
  if ((process.env.DEMO_MODE ?? "true") === "false" && process.env.NODE_ENV === "production") {
    throw new Error("NEXTAUTH_SECRET is required outside demo mode");
  }
  const store = globalThis as { __tyfAuthSecret?: string };
  if (!store.__tyfAuthSecret) store.__tyfAuthSecret = crypto.randomUUID() + crypto.randomUUID();
  return store.__tyfAuthSecret;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: authSecret(),
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/" },
  providers: [
    ...(googleConfigured
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
            authorization: {
              params: {
                scope: "openid email profile https://www.googleapis.com/auth/calendar.readonly",
                access_type: "offline",
                prompt: "consent",
              },
            },
          }),
        ]
      : []),
    Credentials({
      id: "demo",
      name: "Demo",
      credentials: {},
      async authorize() {
        if (!config.demoMode()) return null;
        const user = await getOrCreateUser({
          email: DEMO_EMAIL,
          name: "Alex Rivera",
          isDemo: true,
        });
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;
      const existing = await getOrCreateUser({
        email: user.email,
        name: user.name,
        image: user.image,
        isDemo: false,
      });
      if (account?.provider === "google") {
        const { getDb } = await import("@/lib/db");
        const { users } = await import("@/lib/db/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        await db
          .update(users)
          .set({
            googleAccessToken: account.access_token ?? null,
            googleRefreshToken: account.refresh_token ?? null,
            googleExpiresAt: account.expires_at ? new Date(account.expires_at * 1000) : null,
          })
          .where(eq(users.id, existing.id));
      }
      user.id = existing.id;
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      if (!token.uid && token.email) {
        const { getOrCreateUser: ensure } = await import("./users");
        const u = await ensure({ email: token.email, name: token.name });
        token.uid = u.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
});

export async function requireUser() {
  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return null;
  return { id: uid, name: session.user?.name ?? null, email: session.user?.email ?? null };
}
