import type { DayStatus } from "@dgm/core/deliveries";
import Link from "next/link";
import type { SubmissionStatus } from "@/lib/data";
import { STATUS_LABEL } from "@/lib/data";
import { monthName, shiftMonth } from "@/lib/format";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</section>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </Card>
  );
}

export function ExcelButton({ view, query }: { view: string; query: string }) {
  return (
    <a
      href={`/api/excel/${view}${query}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
    >
      <span aria-hidden>⬇</span> Descargar Excel
    </a>
  );
}

export function MonthNav({ month, basePath }: { month: string; basePath: string }) {
  const link = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50";
  return (
    <div className="flex items-center gap-2">
      <Link className={link} href={`${basePath}?mes=${shiftMonth(month, -1)}`} aria-label="Mes anterior">
        ←
      </Link>
      <span className="min-w-36 text-center text-sm font-medium">{monthName(month)}</span>
      <Link className={link} href={`${basePath}?mes=${shiftMonth(month, 1)}`} aria-label="Mes siguiente">
        →
      </Link>
    </div>
  );
}

const STATUS_STYLE: Record<SubmissionStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  read: "bg-emerald-100 text-emerald-800",
  confirmed: "bg-emerald-600 text-white",
  needs_review: "bg-amber-100 text-amber-900",
  duplicate: "bg-purple-100 text-purple-800",
  rejected: "bg-rose-100 text-rose-800",
};

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export const DAY_STYLE: Record<DayStatus, { cell: string; symbol: string }> = {
  entregado: { cell: "bg-emerald-100 text-emerald-800", symbol: "✓" },
  atrasado: { cell: "bg-amber-100 text-amber-900", symbol: "⏱" },
  falta: { cell: "bg-rose-100 text-rose-800", symbol: "✗" },
  en_revision: { cell: "bg-sky-100 text-sky-800", symbol: "?" },
  pendiente: { cell: "bg-white text-slate-400", symbol: "…" },
  no_exigido: { cell: "bg-slate-50 text-slate-300", symbol: "·" },
};

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">{children}</p>;
}

export const inputClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
export const buttonClass = "rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700";
