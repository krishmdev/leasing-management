import { connection } from "next/server";

/** Current time for a dynamic render. Awaiting connection() keeps it out of prerendered output. */
export async function requestTime(): Promise<number> {
  await connection();
  return Date.now();
}
