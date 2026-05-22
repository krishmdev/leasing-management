import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { relationMap } from "../../scripts/gen-relations";
import { RELATIONS } from "@/server/relations.generated";
import { TENANT_MODELS } from "@/server/tenant";

it("relations.generated.ts matches the Prisma schema (run pnpm gen:relations)", () => {
  expect(RELATIONS).toEqual(relationMap(readFileSync("prisma/schema.prisma", "utf8")));
});

it("every model with an agencyId column is treated as a tenant model", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const withAgency = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].filter(([, , body]) => /^\s+agencyId\s/m.test(body)).map(([, n]) => n);
  expect(withAgency.filter((m) => !TENANT_MODELS.has(m))).toEqual([]);
});
