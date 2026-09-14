"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup, type AuthState } from "./actions";
import type { Copy } from "@/lib/i18n";

const EMPTY: AuthState = {};

export function AuthForm({ mode, t }: { mode: "crear" | "entrar"; t: Copy["access"] }) {
  const isSignup = mode === "crear";
  const [state, action, pending] = useActionState(isSignup ? signup : login, EMPTY);

  return (
    <div>
      <div className="mb-[34px] flex w-fit gap-1 rounded-full bg-line-hair p-1">
        <Link
          href="/acceso"
          data-active={!isSignup}
          className="om-pill border-transparent data-[active=true]:border-ink"
        >
          {t.tabSignIn}
        </Link>
        <Link
          href="/acceso?modo=crear"
          data-active={isSignup}
          className="om-pill border-transparent data-[active=true]:border-ink"
        >
          {t.tabSignUp}
        </Link>
      </div>

      <h1 className="mb-3 text-[clamp(28px,4vw,40px)]">
        {isSignup ? t.titleSignUp : t.titleSignIn}
      </h1>
      <p className="mb-[34px] max-w-[44ch] text-[17px] leading-[1.6] text-muted">
        {isSignup ? t.bodySignUp : t.bodySignIn}
      </p>

      <form action={action} className="flex max-w-[420px] flex-col gap-4">
        {isSignup && (
          <div>
            <label htmlFor="name" className="mb-2 block text-[14px] text-muted">
              {t.labelName}
            </label>
            <input
              id="name"
              name="name"
              required
              maxLength={80}
              autoComplete="name"
              placeholder={t.placeholderName}
              className="om-field"
            />
          </div>
        )}

        <div>
          <label htmlFor="email" className="mb-2 block text-[14px] text-muted">
            {t.labelEmail}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder={t.placeholderEmail}
            className="om-field"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-2 block text-[14px] text-muted">
            {t.labelPassword}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={isSignup ? 8 : undefined}
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder={isSignup ? t.placeholderPasswordSignUp : t.placeholderPasswordSignIn}
            className="om-field"
          />
        </div>

        {isSignup && (
          <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-[1.5] text-muted">
            <input
              type="checkbox"
              name="terms"
              required
              className="mt-[3px] h-4 w-4 accent-clay"
            />
            <span>
              {t.termsBefore}
              <Link href="/terminos">{t.termsLink}</Link>
              {t.termsAfter}
            </span>
          </label>
        )}

        {state.error && (
          <p role="alert" className="text-[15px] leading-[1.5] text-danger">
            {state.error}
          </p>
        )}

        <button type="submit" disabled={pending} className="om-btn om-btn-solid mt-1.5 w-full py-4">
          {pending
            ? isSignup
              ? t.pendingSignUp
              : t.pendingSignIn
            : isSignup
              ? t.submitSignUp
              : t.submitSignIn}
        </button>

        <p className="mt-1.5 text-[14px] text-faint">
          {isSignup ? t.noteSignUp : t.noteSignIn}
        </p>
      </form>
    </div>
  );
}
