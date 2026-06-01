import Link from "next/link";
import { Card } from "@/components/ui";

export default function DeskNotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-lg p-6">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-1 text-sm text-ink-2">That record doesn&apos;t exist at this agency, or it was removed under the retention policy.</p>
      <Link href="../" className="mt-4 inline-flex min-h-8 items-center rounded-md border border-line-strong px-3 text-sm">Back</Link>
    </Card>
  );
}
