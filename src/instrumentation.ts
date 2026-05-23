export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.EGRESS_CANARY === "1") {
    const { recordEgressCanary } = await import("@/server/egress");
    await recordEgressCanary("web");
  }
}
