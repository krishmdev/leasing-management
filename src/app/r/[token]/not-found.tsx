export default function ReferenceNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">This reference link has expired or was already used</h1>
        <p className="mt-2 text-sm text-ink-2">Reference links work once and for 14 days. If you still want to give a reference, reply to the email you received and the leasing office will send a new one.</p>
      </div>
    </main>
  );
}
