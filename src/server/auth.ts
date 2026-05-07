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
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    session: { expiresIn: 60 * 60 * 24 * 7 },
    plugins: [
      // Agencies are created by the platform, not by users.
      organization({ allowUserToCreateOrganization: false }),
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

export function auth(): Auth {
  g.__leasingAuth ??= build();
  return g.__leasingAuth;
}
