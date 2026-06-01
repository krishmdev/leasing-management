export default function ScreeningNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#eef3f8] px-4 text-[#0b2239]">
      <div className="max-w-md text-center">
        <p className="font-mono text-sm tracking-widest">MOCKCRA</p>
        <h1 className="mt-3 text-2xl font-semibold">This screening link isn&apos;t valid</h1>
        <p className="mt-2 text-sm text-[#3b5068]">It may have expired. Use the most recent email about your rental screening, or contact the property manager who sent it.</p>
      </div>
    </main>
  );
}
