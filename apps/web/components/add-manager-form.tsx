"use client";

import { useActionState } from "react";
import { addManager, type ManagerState } from "@/app/(panel)/gerentes/actions";

const input = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

export function AddManagerForm() {
  const [state, action, pending] = useActionState<ManagerState, FormData>(addManager, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Correo de Google
        <input className={input} name="email" type="email" required placeholder="nombre@gmail.com" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Nombre
        <input className={input} name="name" placeholder="Opcional" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Rol
        <select className={input} name="role" defaultValue="manager">
          <option value="manager">Gerente</option>
          <option value="admin">Administrador</option>
        </select>
      </label>
      <button disabled={pending} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" type="submit">
        Agregar
      </button>
      {state?.error ? <p className="w-full text-sm text-rose-700">{state.error}</p> : null}
      {state?.done ? <p className="w-full text-sm text-emerald-700">✓ {state.done}</p> : null}
    </form>
  );
}
