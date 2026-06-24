function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

export default function handler(req: any, res: any) {
  const rawUrl = typeof req?.url === "string" ? req.url : "";
  const path = rawUrl.split("?")[0] || "/";
  res.statusCode = 404;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>404 - Research Network</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #121212;
      --muted: #62615f;
      --line: #d8d4cb;
      --paper: #f7f4ed;
      --panel: #fffdf8;
      --accent: #0f6f68;
      --accent-2: #c45a2c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 28px;
      background:
        linear-gradient(90deg, rgba(18,18,18,.035) 1px, transparent 1px),
        linear-gradient(rgba(18,18,18,.035) 1px, transparent 1px),
        radial-gradient(circle at 80% 20%, rgba(196,90,44,.18), transparent 30%),
        var(--paper);
      background-size: 42px 42px, 42px 42px, auto, auto;
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(920px, 100%);
      border: 1px solid var(--line);
      background: rgba(255,253,248,.94);
      box-shadow: 0 24px 70px rgba(18,18,18,.13);
      padding: clamp(28px, 6vw, 64px);
    }
    .eyebrow {
      margin: 0 0 22px;
      color: var(--accent-2);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      max-width: 720px;
      font-size: clamp(42px, 8vw, 96px);
      line-height: .92;
      letter-spacing: 0;
    }
    .copy {
      margin: 26px 0 0;
      max-width: 640px;
      color: var(--muted);
      font-size: clamp(17px, 2vw, 21px);
      line-height: 1.58;
    }
    code {
      padding: 2px 6px;
      border: 1px solid var(--line);
      background: #fff;
      font-size: .88em;
      word-break: break-all;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 34px;
    }
    a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      padding: 10px 16px;
      border: 1px solid var(--ink);
      color: var(--ink);
      background: transparent;
      text-decoration: none;
      font-weight: 760;
    }
    a.primary {
      background: var(--ink);
      color: #fffdf8;
    }
    .meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1px;
      margin-top: 44px;
      border: 1px solid var(--line);
      background: var(--line);
    }
    .meta div {
      min-height: 84px;
      padding: 16px;
      background: var(--panel);
    }
    .meta b {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
    }
    .meta span {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    @media (max-width: 640px) {
      body { padding: 16px; }
      main { padding: 28px; }
      .meta { grid-template-columns: 1fr; }
      a { width: 100%; justify-content: center; }
    }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">404 / testnet route</p>
    <h1>This page is not part of the current Research Network build.</h1>
    <p class="copy">The path <code>${escapeHtml(path)}</code> is not a live product route. This testnet build keeps only the current public index, Account, and author workbench surfaces.</p>
    <div class="actions" aria-label="Navigation">
      <a class="primary" href="/">Open Research Network</a>
      <a href="/search.html">Search live assets</a>
      <a href="/account.html">Open Account</a>
    </div>
    <section class="meta" aria-label="Route details">
      <div><b>Status</b><span>HTTP 404. Unknown paths are intentionally not proxied to unrelated content.</span></div>
      <div><b>Live Index</b><span>Research assets are loaded from the indexed Sui/Walrus graph through the app.</span></div>
      <div><b>Author Tools</b><span>Publishing, GitHub scope, and zkLogin identity stay in Account and Workbench.</span></div>
    </section>
  </main>
</body>
</html>
`);
}
