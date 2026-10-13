import { asc, getDb, managers } from "@dgm/db";
import { AddManagerForm } from "@/components/add-manager-form";
import { Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { setManagerActive } from "./actions";

export default async function GerentesPage() {
  const me = await requireAdmin();
  const rows = await getDb().select().from(managers).orderBy(asc(managers.email));

  return (
    <>
      <PageHeader title="Gerentes" subtitle="Correos de Google que pueden entrar al panel. Solo los administradores ven esta página." />
      <Card className="mb-5">
        <h2 className="mb-3 font-medium">Agregar gerente</h2>
        <AddManagerForm />
        <p className="mt-3 text-xs text-slate-500">
          Mientras el login de Google esté en modo de prueba, el correo también debe estar en la lista de usuarios de prueba de Google Cloud.
        </p>
      </Card>
      <Card>
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((m) => (
            <li key={m.email} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className={m.active ? "font-medium" : "font-medium text-slate-400 line-through"}>{m.email}</p>
                <p className="text-xs text-slate-500">
                  {m.role === "admin" ? "Administrador" : "Gerente"}
                  {m.name ? ` · ${m.name}` : ""}
                  {m.active ? "" : " · sin acceso"}
                </p>
              </div>
              {m.email === me.email ? (
                <span className="text-xs text-slate-400">Tú</span>
              ) : (
                <form action={setManagerActive}>
                  <input type="hidden" name="email" value={m.email} />
                  <input type="hidden" name="active" value={String(!m.active)} />
                  <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50" type="submit">
                    {m.active ? "Quitar acceso" : "Devolver acceso"}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
