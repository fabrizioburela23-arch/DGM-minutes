import { APP_NAME } from "@dgm/core";
import { getDb } from "@dgm/db";
import { signOut } from "@/auth";
import { Nav } from "@/components/nav";
import { countSubmissions, INBOX } from "@/lib/data";
import { requireManager } from "@/lib/session";
import { loadWorkerHealth } from "@/lib/worker-health";
import { WorkerBanner, WorkerFooter } from "@/components/worker-status";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const manager = await requireManager();
  const [inbox, health] = await Promise.all([countSubmissions(getDb(), INBOX), loadWorkerHealth(getDb())]);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  const items = [
    { href: "/atrasos", label: "Atrasos" },
    { href: "/minutos", label: "Minutos" },
    { href: "/entregas", label: "Entregas" },
    { href: "/screenshots", label: "Screenshots" },
    { href: "/revision", label: "Revisión", badge: inbox },
    ...(manager.role === "admin" ? [{ href: "/gerentes", label: "Gerentes" }] : []),
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 pt-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="font-semibold">{APP_NAME}</p>
            <form action={logout} className="flex items-center gap-2 text-sm text-slate-600">
              <span className="hidden sm:inline">{manager.email}</span>
              <button className="rounded-lg px-2 py-1 hover:bg-slate-200" type="submit">
                Salir
              </button>
            </form>
          </div>
          <Nav items={items} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <WorkerBanner health={health} />
        {children}
      </main>
      <WorkerFooter health={health} />
    </div>
  );
}
