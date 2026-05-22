import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink, organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { uuidv7 } from "@/lib/ids";
import { db } from "@/server/db";
import { transport } from "@/server/email/transport";
import { magicLinkEmail } from "@/server/email/templates";

function build() {
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL ?? process.env.APP_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: prismaAdapter(db(), { provider: "postgresql" }),
    advanced: { database: { generateId: () => uuidv7() } },
    // Staff accounts are provisioned (see prisma/seed/agencies.ts), never self-registered.
    emailAndPassword: { enabled: true, minPasswordLength: 10, disableSignUp: true },
    session: { expiresIn: 60 * 60 * 24 * 7 },
    plugins: [
      // Agencies are created by the platform, not by users.
      // Membership and role changes go through audited domain code; the plugin's own mutation
      // endpoints are blocked in app/api/auth/[...all]/route.ts.
      organization({ allowUserToCreateOrganization: false, disableOrganizationDeletion: true }),
      magicLink({
        expiresIn: 60 * 15,
        // Magic links go out directly rather than through the outbox: the user asked for one
        // just now and can ask again, and the link itself is single-use.
        sendMagicLink: async ({ email, url }) => {
          await transport().send(magicLinkEmail({ to: email, url }), { idempotencyKey: `auth:magic:${uuidv7()}` });
        },
      }),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof build>;
const g = globalThis as unknown as { __leasingAuth?: Auth };

/** Creates a staff user with a password, bypassing the disabled sign-up endpoint. */
export async function provisionUser(email: string, name: string, password: string) {
  const ctx = await auth().$context;
  const hash = await ctx.password.hash(password);
  const id = uuidv7();
  await db().$transaction([
    db().user.create({ data: { id, email: email.toLowerCase(), name, emailVerified: true } }),
    db().account.create({ data: { id: uuidv7(), userId: id, accountId: id, providerId: "credential", password: hash } }),
  ]);
  return db().user.findUniqueOrThrow({ where: { id } });
}

export function auth(): Auth {
  g.__leasingAuth ??= build();
  return g.__leasingAuth;
}
