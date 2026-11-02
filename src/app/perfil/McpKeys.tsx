"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createMcpKey, disconnectApp, revokeMcpKey } from "./actions";
import type { Copy } from "@/lib/i18n";

export interface ConnectedApp {
  id: string;
  name: string;
  /** "conectada octubre de 2026 · administración": se arma en el servidor. */
  detail: string;
}

export interface McpKeyItem {
  id: string;
  name: string;
  prefix: string;
  revoked: boolean;
  /** "último uso octubre de 2026", "sin usar", "revocada": se arma en el servidor. */
  detail: string;
}

/**
 * Las llaves con las que un asistente usa el MCP de esta cuenta. La llave
 * nueva se muestra una sola vez, con el comando para conectarla.
 */
export function McpKeys({
  keys,
  apps = [],
  endpoint,
  t,
}: {
  keys: McpKeyItem[];
  apps?: ConnectedApp[];
  endpoint: string;
  t: Copy["profile"]["mcp"];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [revoking, setRevoking] = useState<string | null>(null);

  const command = fresh
    ? `claude mcp add --transport http omtana ${endpoint} --header "Authorization: Bearer ${fresh}"`
    : null;

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await createMcpKey(name);
      if ("error" in result) {
        setError(result.error ?? t.createError);
        return;
      }
      setFresh(result.key);
      setCopied(false);
      setName("");
      router.refresh();
    });
  }

  function disconnect(id: string) {
    setRevoking(id);
    startTransition(async () => {
      await disconnectApp(id);
      setRevoking(null);
      router.refresh();
    });
  }

  function revoke(id: string) {
    setRevoking(id);
    startTransition(async () => {
      await revokeMcpKey(id);
      setRevoking(null);
      router.refresh();
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="om-card mt-[14px] px-7 py-[30px]">
      <div className="om-label mb-3">{t.title}</div>
      <p className="mb-6 max-w-[720px] text-[15px] leading-[1.6] text-muted">{t.intro}</p>

      <div className="mb-6">
        <div className="mb-[6px] text-[13px] text-faint">{t.endpoint}</div>
        <code className="block overflow-x-auto rounded-card border border-line px-4 py-3 text-[14px]">{endpoint}</code>
        <p className="mt-3 max-w-[720px] text-[14px] leading-[1.55] text-muted">{t.oauthHowTo}</p>
      </div>

      <div className="mb-8">
        <div className="mb-2 text-[15px]">{t.appsTitle}</div>
        {apps.length === 0 ? (
          <p className="text-[14px] text-faint">{t.appsEmpty}</p>
        ) : (
          <ul className="flex flex-col">
            {apps.map((app, i) => (
              <li key={app.id} className={`flex flex-wrap items-center gap-3 py-3 ${i ? "border-t border-line-hair" : ""}`}>
                <div className="mr-auto min-w-0">
                  <div className="text-[15px]">{app.name}</div>
                  <div className="mt-[2px] text-[13px] text-faint">{app.detail}</div>
                </div>
                <button
                  type="button"
                  onClick={() => disconnect(app.id)}
                  disabled={pending}
                  className="cursor-pointer text-[14px] text-danger"
                >
                  {revoking === app.id ? t.disconnecting : t.disconnect}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-3 text-[15px]">{t.keysTitle}</div>

      {fresh && (
        <div className="mb-6 rounded-card border border-clay/50 px-4 py-4">
          <div className="mb-1 text-[15px]">{t.newKeyTitle}</div>
          <p className="mb-3 text-[13px] leading-[1.5] text-faint">{t.newKeyNote}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-card border border-line px-3 py-2 text-[13px]">
              {fresh}
            </code>
            <button type="button" onClick={() => copy(fresh)} className="om-btn om-btn-ghost om-btn-sm">
              {copied ? t.copied : t.copy}
            </button>
          </div>
          {command && (
            <>
              <div className="mb-[6px] mt-4 text-[13px] text-faint">{t.howTo}</div>
              <code className="block overflow-x-auto whitespace-pre rounded-card border border-line px-3 py-2 text-[12px]">
                {command}
              </code>
            </>
          )}
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder={t.namePlaceholder}
          aria-label={t.namePlaceholder}
          className="min-w-[220px] flex-1 rounded-card border border-line-field bg-transparent px-4 py-[11px] text-[15px]"
        />
        <button type="button" onClick={create} disabled={pending} className="om-btn om-btn-solid px-5 py-[11px] text-[15px]">
          {pending && !revoking ? t.creating : t.create}
        </button>
      </div>
      {error && <p className="mb-4 text-[14px] text-danger">{error}</p>}

      {keys.length === 0 ? (
        <p className="text-[14px] text-faint">{t.empty}</p>
      ) : (
        <ul className="flex flex-col">
          {keys.map((key, i) => (
            <li key={key.id} className={`flex flex-wrap items-center gap-3 py-3 ${i ? "border-t border-line-hair" : ""}`}>
              <div className="mr-auto min-w-0">
                <div className={`text-[15px] ${key.revoked ? "text-faint line-through" : ""}`}>{key.name}</div>
                <div className="mt-[2px] text-[13px] text-faint">
                  <code>{key.prefix}…</code> · {key.detail}
                </div>
              </div>
              {!key.revoked && (
                <button
                  type="button"
                  onClick={() => revoke(key.id)}
                  disabled={pending}
                  className="cursor-pointer text-[14px] text-danger"
                >
                  {revoking === key.id ? t.revoking : t.revoke}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
