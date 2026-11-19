import { getUser } from "@/lib/user";
import { disconnectCanvas } from "@/lib/actions";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const user = await getUser();
  const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  return (
    <div className="stack" style={{ gap: 24, maxWidth: 640 }}>
      <h1>Settings</h1>

      <section className="panel stack">
        <div className="spread">
          <h2>Canvas</h2>
          {user.canvasTokenEnc && <span className="chip good">Connected{user.canvasUserName ? ` as ${user.canvasUserName}` : ""}</span>}
        </div>
        <p className="muted small">
          In Canvas, open <b>Account → Settings</b>, scroll to <b>Approved Integrations</b>, and choose <b>+ New Access Token</b>. The
          token is encrypted before it is stored and is only ever sent to your Canvas site. The app only reads from Canvas.
        </p>
        <SettingsForm baseUrl={user.canvasBaseUrl ?? ""} hasToken={!!user.canvasTokenEnc} />
        {user.canvasTokenEnc && (
          <form action={disconnectCanvas}>
            <button className="btn ghost danger sm">Remove saved token</button>
          </form>
        )}
      </section>

      <section className="panel stack">
        <div className="spread">
          <h2>Claude API</h2>
          <span className={hasKey ? "chip good" : "chip warn"}>{hasKey ? "Key found" : "No key"}</span>
        </div>
        <p className="muted small">
          Problem generation uses the Claude API. Put <code>ANTHROPIC_API_KEY=…</code> in <code>apps/web/.env.local</code> and restart{" "}
          <code>npm run dev</code>. Syncing Canvas works without it, but topic outlines and problem sets need it.
        </p>
      </section>
    </div>
  );
}
