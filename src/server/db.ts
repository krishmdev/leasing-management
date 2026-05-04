import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 10 }) });
}

const g = globalThis as unknown as { __leasingDb?: PrismaClient };

/** Process-wide client. Tests swap it with setDb(). */
export function db(): PrismaClient {
  g.__leasingDb ??= createDb();
  return g.__leasingDb;
}

export function setDb(client: PrismaClient | undefined) {
  g.__leasingDb = client;
}

/** Postgres SQLSTATE of a Prisma/pg error, if any (23505 unique, 23P01 exclusion). */
export function pgCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    const o = e as Record<string, unknown>;
    if (typeof o.code === "string" && /^[0-9A-Z]{5}$/.test(o.code)) return o.code;
    const meta = o.meta as Record<string, unknown> | undefined;
    const driver = meta?.driverAdapterError as Record<string, unknown> | undefined;
    const cause = (driver?.cause ?? o.cause) as Record<string, unknown> | undefined;
    if (cause && typeof cause.originalCode === "string") return cause.originalCode;
    if (cause && typeof cause.code === "string" && /^[0-9A-Z]{5}$/.test(cause.code)) return cause.code;
    if (o.code === "P2002") return "23505";
    e = cause ?? o.cause;
  }
  return undefined;
}
