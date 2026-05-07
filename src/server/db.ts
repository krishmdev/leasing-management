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

/** Postgres SQLSTATE of a Prisma/pg error, if any (23505 unique, 23P01 exclusion, 40001 serialization). */
export function pgCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const o = err as { code?: unknown; meta?: { driverAdapterError?: { cause?: { originalCode?: string; code?: string } } } };
  const cause = o.meta?.driverAdapterError?.cause;
  if (cause?.originalCode) return cause.originalCode;
  if (typeof cause?.code === "string" && /^[0-9A-Z]{5}$/.test(cause.code) && !cause.code.startsWith("P")) return cause.code;
  if (o.code === "P2002") return "23505";
  if (typeof o.code === "string" && /^[0-9][0-9A-Z]{4}$/.test(o.code)) return o.code; // raw pg errors
  return undefined;
}
