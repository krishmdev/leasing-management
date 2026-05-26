export const metadata = { title: "Check your email" };

export default async function CheckEmail({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4">
      <div className="max-w-sm text-center">
        <p className="text-4xl" aria-hidden>✉</p>
        <h1 className="mt-4 text-xl font-semibold">Check your email</h1>
        <p className="mt-2 text-sm text-ink-2">
          We sent a sign-in link{to ? <> to <span className="font-medium text-ink">{to}</span></> : null}. It works once and expires in 15 minutes.
        </p>
      </div>
    </main>
  );
}
