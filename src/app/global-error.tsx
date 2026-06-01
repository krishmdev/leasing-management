"use client";

// Replaces the root layout when the layout itself fails (for example the database is down while
// an agency layout loads its theme), so it carries its own html, body and inline styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#f6f4ef", color: "#1c1b19" }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "1rem" }}>
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>This page couldn&apos;t load</h1>
            <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, color: "#4a4843" }}>
              Something went wrong on our side. Nothing you entered was lost. Try again in a minute.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{ marginTop: 20, minHeight: 40, padding: "0 16px", borderRadius: 6, border: 0, background: "#1c1b19", color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" }}
            >
              Try again
            </button>
            {error.digest && <p style={{ marginTop: 16, fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#77746c" }}>Reference {error.digest}</p>}
          </div>
        </main>
      </body>
    </html>
  );
}
