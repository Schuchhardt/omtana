"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, signup, type AuthState } from "./actions";

const EMPTY: AuthState = {};

export function AuthForm({ mode }: { mode: "crear" | "entrar" }) {
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
          Entrar
        </Link>
        <Link
          href="/acceso?modo=crear"
          data-active={isSignup}
          className="om-pill border-transparent data-[active=true]:border-ink"
        >
          Crear cuenta
        </Link>
      </div>

      <h1 className="mb-3 text-[clamp(28px,4vw,40px)]">
        {isSignup ? "Tu biblioteca empieza acá" : "Bienvenido de vuelta"}
      </h1>
      <p className="mb-[34px] max-w-[44ch] text-[17px] leading-[1.6] text-muted">
        {isSignup
          ? "Creamos la cuenta para que lo que generes te siga. El catálogo público no necesita cuenta."
          : "Entra para volver a tu biblioteca y a tus personalizaciones del mes."}
      </p>

      <form action={action} className="flex max-w-[420px] flex-col gap-4">
        {isSignup && (
          <div>
            <label htmlFor="name" className="mb-2 block text-[14px] text-muted">
              Nombre
            </label>
            <input
              id="name"
              name="name"
              required
              maxLength={80}
              autoComplete="name"
              placeholder="Cómo quieres que te llamemos"
              className="om-field"
            />
          </div>
        )}

        <div>
          <label htmlFor="email" className="mb-2 block text-[14px] text-muted">
            Correo
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="tu@correo.com"
            className="om-field"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-2 block text-[14px] text-muted">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={isSignup ? 8 : undefined}
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder={isSignup ? "Mínimo 8 caracteres" : "Tu contraseña"}
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
              Acepto los <Link href="/terminos">términos y condiciones</Link> y el uso de
              mis intenciones para generar meditaciones.
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
              ? "Creando tu cuenta…"
              : "Entrando…"
            : isSignup
              ? "Crear cuenta gratis"
              : "Entrar"}
        </button>

        <p className="mt-1.5 text-[14px] text-faint">
          {isSignup
            ? "Solo correo y contraseña. No pedimos tarjeta para el plan Free."
            : "¿Olvidaste la contraseña? Escríbenos a hola@omtana.com."}
        </p>
      </form>
    </div>
  );
}
