'use client'

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="login-page" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
      <section className="login-card" style={{ maxWidth: 460, textAlign: 'center' }}>
        <h1 style={{ marginBottom: 8 }}>Connection interrupted</h1>
        <p className="subtle" style={{ marginBottom: 20 }}>
          Your session is still saved. Please retry the request.
        </p>
        <button type="button" className="btn btn-primary" onClick={reset}>Try again</button>
      </section>
    </main>
  )
}
