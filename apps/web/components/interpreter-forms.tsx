"use client";

import { useActionState } from "react";
import { importRosterAction, updateInterpreterAction, type RosterState } from "@/app/(panel)/interpretes/actions";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

export function RosterImportForm() {
  const [state, action, pending] = useActionState<RosterState, FormData>(importRosterAction, null);
  return (
    <form action={action} className="space-y-2">
      <textarea
        className={`${input} min-h-32 font-mono text-xs`}
        name="roster"
        placeholder={"Nombre\tEmpresa\tID de Propio\nAna Pérez\tC-tel\t52822\nLuis Gómez\tInterpredia"}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" type="submit">
          Importar
        </button>
        {state?.error ? <p className="text-sm text-rose-700">{state.error}</p> : null}
        {state?.done ? <p className="text-sm text-emerald-700">✓ {state.done}</p> : null}
      </div>
    </form>
  );
}

export type InterpreterFormValues = {
  id: number;
  fullName: string;
  company: string | null;
  portalId: string | null;
  aliases: string[];
  startDate: string | null;
};

export function InterpreterEditForm({ i }: { i: InterpreterFormValues }) {
  const [state, action, pending] = useActionState<RosterState, FormData>(updateInterpreterAction, null);
  return (
    <form action={action} className="grid gap-2 pt-2 sm:grid-cols-2">
      <input type="hidden" name="id" value={i.id} />
      <label className="text-xs text-slate-600">
        Nombre
        <input className={input} name="fullName" defaultValue={i.fullName} required />
      </label>
      <label className="text-xs text-slate-600">
        Empresa
        <input className={input} name="company" defaultValue={i.company ?? ""} placeholder="C-tel, Simplified, Interpredia…" />
      </label>
      <label className="text-xs text-slate-600">
        ID de Propio
        <input className={input} name="portalId" inputMode="numeric" defaultValue={i.portalId ?? ""} />
      </label>
      <label className="text-xs text-slate-600">
        Fecha de inicio
        <input className={input} type="date" name="startDate" defaultValue={i.startDate ?? ""} />
      </label>
      <label className="text-xs text-slate-600 sm:col-span-2">
        Otros nombres con los que sube al Form (separados por coma)
        <input className={input} name="aliases" defaultValue={i.aliases.join(", ")} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={pending} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" type="submit">
          Guardar
        </button>
        {state?.error ? <p className="text-sm text-rose-700">{state.error}</p> : null}
        {state?.done ? <p className="text-sm text-emerald-700">✓ {state.done}</p> : null}
      </div>
    </form>
  );
}
