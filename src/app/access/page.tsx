export default function Access() {
  return (
    <main>
      <h1>YouTube Intelligence</h1>
      <section className="panel research-panel">
        <h2>Open your private workspace</h2>
        <form action="/api/access" method="post">
          <label>
            Workspace access code
            <input
              type="password"
              name="code"
              required
              autoComplete="current-password"
            />
          </label>
          <button className="primary">Continue</button>
        </form>
        <p>Use the access code configured for this deployment.</p>
      </section>
    </main>
  );
}
