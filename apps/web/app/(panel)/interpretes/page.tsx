import { getDb } from "@dgm/db";
import { InterpreterEditForm, RosterImportForm } from "@/components/interpreter-forms";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { loadInterpreters } from "@/lib/data";
import { requireAdmin } from "@/lib/session";
import { setInterpreterActive } from "./actions";

export default async function InterpretesPage() {
  await requireAdmin();
  const people = await loadInterpreters(getDb());
  const active = people.filter((p) => p.active);
  const inactive = people.filter((p) => !p.active);

  const row = (p: (typeof people)[number]) => (
    <li key={p.id} className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={p.active ? "font-medium" : "font-medium text-slate-400 line-through"}>{p.fullName}</p>
          <p className="text-xs text-slate-500">
            {p.company ?? "Sin empresa"} · {p.portalId ? `ID de Propio ${p.portalId}` : <span className="text-amber-700">sin ID de Propio</span>}
            {p.aliases.length ? ` · también «${p.aliases.join("», «")}»` : ""}
          </p>
        </div>
        <form action={setInterpreterActive}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="active" value={String(!p.active)} />
          <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50" type="submit">
            {p.active ? "Dar de baja" : "Reactivar"}
          </button>
        </form>
      </div>
      <details>
        <summary className="cursor-pointer pt-1 text-xs text-slate-600">Editar</summary>
        <InterpreterEditForm i={{ id: p.id, fullName: p.fullName, company: p.company, portalId: p.portalId, aliases: p.aliases, startDate: p.startDate }} />
      </details>
    </li>
  );

  return (
    <>
      <PageHeader
        title="Intérpretes"
        subtitle="Cada screenshot se asigna por el ID de Propio que aparece en la imagen. Sin ID, se usa el nombre del Form; al confirmar uno en Revisión, el sistema aprende el ID."
      />
      <Card className="mb-5">
        <h2 className="mb-1 font-medium">Importar lista</h2>
        <p className="mb-3 text-sm text-slate-600">
          Copia desde la hoja las columnas Nombre, Empresa e ID de Propio (en ese orden) y pégalas aquí. Agrega a los nuevos y completa empresa o ID de los que ya están; no borra a nadie.
        </p>
        <RosterImportForm />
      </Card>
      <Card>
        <h2 className="mb-1 font-medium">Activos ({active.length})</h2>
        {active.length === 0 ? <EmptyState>Todavía no hay intérpretes. Importa la lista arriba.</EmptyState> : <ul className="divide-y divide-slate-100 text-sm">{active.map(row)}</ul>}
        {inactive.length ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-slate-600">Dados de baja ({inactive.length})</summary>
            <ul className="divide-y divide-slate-100 text-sm">{inactive.map(row)}</ul>
          </details>
        ) : null}
      </Card>
    </>
  );
}
