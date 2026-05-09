export function SearchBar({ agencySlug, beds, maxRent }: { agencySlug: string; beds?: number; maxRent?: number }) {
  return (
    <form action={`/${agencySlug}/listings`} method="get" className="flex flex-col gap-2 rounded-2xl bg-surface p-2 shadow-lg ring-1 ring-black/5 sm:flex-row sm:items-center" role="search">
      <label className="flex flex-1 flex-col px-3 py-1.5">
        <span className="text-xs font-medium text-muted">Bedrooms</span>
        <select name="beds" defaultValue={beds ?? ""} className="bg-transparent text-sm font-medium focus:outline-none">
          <option value="">Any</option>
          <option value="0">Studio</option>
          <option value="1">1 bedroom</option>
          <option value="2">2 bedrooms</option>
          <option value="3">3+ bedrooms</option>
        </select>
      </label>
      <span aria-hidden className="hidden h-8 w-px bg-line sm:block" />
      <label className="flex flex-1 flex-col px-3 py-1.5">
        <span className="text-xs font-medium text-muted">Max rent</span>
        <select name="maxRent" defaultValue={maxRent ?? ""} className="bg-transparent text-sm font-medium focus:outline-none">
          <option value="">No limit</option>
          {[2500, 3000, 3500, 4000, 4500].map((v) => (
            <option key={v} value={v}>${v.toLocaleString()}</option>
          ))}
        </select>
      </label>
      <button className="h-11 rounded-xl bg-brand px-6 text-sm font-semibold text-brand-ink hover:opacity-90">Search homes</button>
    </form>
  );
}
