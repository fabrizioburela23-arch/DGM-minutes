"use client";

import { useActionState, useState } from "react";
import { submitReview, type ReviewState } from "@/app/(panel)/revision/actions";

type Props = {
  submissionId: number;
  minutes: number | null;
  calls: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  canConfirm: boolean;
  interpreterId: number | null;
  /** Intérprete sugerido por el nombre del Form (solo cuando aún no tiene dueño). */
  suggestedId?: number | null;
  people: { id: number; label: string }[];
};

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

export function ReviewForm(p: Props) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(submitReview, null);
  const [correcting, setCorrecting] = useState(false);

  if (state?.done) return <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">✓ {state.done}. Se guardó en el historial.</p>;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="submissionId" value={p.submissionId} />
      {p.interpreterId === null || correcting ? (
        <label className="block text-xs text-slate-600">
          Intérprete{" "}
          {p.interpreterId === null ? (
            p.suggestedId ? (
              <span className="text-amber-700">(sugerido por el nombre del Form; revisa antes de confirmar)</span>
            ) : (
              <span className="text-rose-700">(obligatorio para confirmar)</span>
            )
          ) : null}
          <select className={input} name="interpreterId" defaultValue={p.interpreterId ?? p.suggestedId ?? ""}>
            <option value="">— Elegir —</option>
            {p.people.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {correcting ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-600">
            Minutos
            <input className={input} name="minutes" inputMode="numeric" defaultValue={p.minutes ?? ""} required />
          </label>
          <label className="text-xs text-slate-600">
            Llamadas
            <input className={input} name="calls" inputMode="numeric" defaultValue={p.calls ?? ""} />
          </label>
          <label className="text-xs text-slate-600">
            Desde
            <input className={input} type="date" name="periodStart" defaultValue={p.periodStart ?? ""} required />
          </label>
          <label className="text-xs text-slate-600">
            Hasta
            <input className={input} type="date" name="periodEnd" defaultValue={p.periodEnd ?? ""} required />
          </label>
        </div>
      ) : null}
      <input className={input} name="note" placeholder="Nota (opcional)" maxLength={500} />
      {state?.error ? <p className="text-sm text-rose-700">{state.error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {correcting ? (
          <>
            <button disabled={pending} name="action" value="correct" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              Guardar corrección
            </button>
            <button type="button" onClick={() => setCorrecting(false)} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
              Cancelar
            </button>
          </>
        ) : (
          <>
            {p.canConfirm ? (
              <button disabled={pending} name="action" value="confirm" className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                Confirmar
              </button>
            ) : null}
            <button type="button" onClick={() => setCorrecting(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium">
              Corregir
            </button>
            <button disabled={pending} name="action" value="reject" className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-700 disabled:opacity-50">
              Rechazar
            </button>
          </>
        )}
      </div>
    </form>
  );
}
