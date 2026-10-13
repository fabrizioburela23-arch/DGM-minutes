import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { findManager, type Manager } from "./managers";

/**
 * Solo para pruebas en la computadora del desarrollador: con `next dev` y DEV_LOGIN_EMAIL,
 * se entra como ese correo sin Google. En Railway (`next start`) esto no hace nada.
 */
function devEmail(): string | null {
  return process.env.NODE_ENV === "development" && process.env.DEV_LOGIN_EMAIL ? process.env.DEV_LOGIN_EMAIL : null;
}

/** Correo de la sesión actual (o null si no hay nadie conectado). */
export async function sessionEmail(): Promise<string | null> {
  const dev = devEmail();
  if (dev) return dev;
  const session = await auth();
  return session?.user?.email?.toLowerCase() ?? null;
}

/** Exige un gerente activo. Sin sesión → /login. Con sesión pero sin permiso → /login con aviso. */
export async function requireManager(): Promise<Manager> {
  const email = await sessionEmail();
  if (!email) redirect("/login");
  const manager = await findManager(email);
  if (!manager) redirect("/login?error=AccessDenied");
  return manager;
}

export async function requireAdmin(): Promise<Manager> {
  const manager = await requireManager();
  if (manager.role !== "admin") redirect("/atrasos");
  return manager;
}
