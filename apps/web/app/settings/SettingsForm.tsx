"use client";

import { useActionState } from "react";
import { saveCanvasSettings, type ActionResult } from "@/lib/actions";

export function SettingsForm({ baseUrl, hasToken }: { baseUrl: string; hasToken: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveCanvasSettings, null);
  return (
    <form action={action} className="stack" style={{ gap: 14 }}>
      <label>
        Canvas URL
        <input type="url" name="baseUrl" defaultValue={baseUrl} placeholder="https://yourschool.instructure.com" required inputMode="url" />
        <span className="hint">The address you see when you log in to Canvas.</span>
      </label>
      <label>
        Access token
        <input
          type="password"
          name="token"
          autoComplete="off"
          placeholder={hasToken ? "Saved. Leave blank to keep it" : "Paste your token"}
          required={!hasToken}
        />
      </label>
      <div className="row">
        <button className="btn primary" disabled={pending}>
          {pending ? "Testing…" : "Test and save"}
        </button>
      </div>
      {state && <div className={`notice ${state.ok ? "good" : "bad"}`}>{state.ok ? state.message : state.error}</div>}
    </form>
  );
}
