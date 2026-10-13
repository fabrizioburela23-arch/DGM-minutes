import { APP_NAME } from "@dgm/core";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { findManager } from "@/lib/managers";
import { sessionEmail } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const email = await sessionEmail();
  if (email && (await findManager(email))) redirect("/atrasos");

  async function login() {
    "use server";
    await signIn("google", { redirectTo: "/atrasos" });
  }
  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  const denied = error === "AccessDenied" || Boolean(email);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-5 px-4 py-16">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">DGM Interpreters</p>
        <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
        <p className="mt-2 text-slate-600">Panel de gerentes: atrasos, minutos, entregas y screenshots.</p>
      </div>

      {denied ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <p className="font-medium">Sin acceso</p>
          <p className="mt-1">
            {email ? `El correo ${email}` : "Ese correo"} no está autorizado. Pide a un administrador de DGM que lo agregue como gerente.
          </p>
        </div>
      ) : error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">No se pudo iniciar sesión. Intenta de nuevo.</p>
      ) : null}

      {email ? (
        <form action={logout}>
          <button className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 font-medium hover:bg-slate-50" type="submit">
            Usar otra cuenta
          </button>
        </form>
      ) : (
        <form action={login}>
          <button className="w-full rounded-lg bg-slate-900 px-4 py-3 font-medium text-white hover:bg-slate-700" type="submit">
            Entrar con Google
          </button>
        </form>
      )}
    </main>
  );
}
