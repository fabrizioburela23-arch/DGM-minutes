import { getDb } from "@dgm/db";
import Link from "next/link";
import { Card, EmptyState, ExcelButton, MonthNav, PageHeader, Stat } from "@/components/ui";
import { lateReport, loadRule } from "@/lib/data";
import { monthFilter, toQuery } from "@/lib/filters";
import { mediumDate, shortDate } from "@/lib/format";
import { RuleNote } from "@/components/rule-note";

export default async function AtrasosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const db = getDb();
  const rule = await loadRule(db);
  const { month } = monthFilter(params, rule.timezone);
  const { today, rows } = await lateReport(db, month);
  const behind = rows.filter((r) => r.daysBehind > 0);

  return (
    <>
      <PageHeader
        title="Atrasos"
        subtitle={<RuleNote rule={rule} />}
        actions={
          <>
            <MonthNav month={month} basePath="/atrasos" />
            <ExcelButton view="atrasos" query={toQuery({ mes: month })} />
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Con atraso hoy" value={behind.length} hint={`de ${rows.length} intérpretes activos`} />
        <Stat label="Faltas en el mes" value={rows.reduce((n, r) => n + r.month.falta, 0)} />
        <Stat label="Entregas tarde" value={rows.reduce((n, r) => n + r.month.atrasado, 0)} />
        <Stat label="En revisión" value={rows.reduce((n, r) => n + r.month.en_revision, 0)} />
      </div>

      {rows.length === 0 ? (
        <EmptyState>No hay intérpretes activos.</EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.interpreter.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {r.interpreter.fullName} <span className="text-sm font-normal text-slate-500">{r.interpreter.code}</span>
                  </p>
                  <p className="text-sm text-slate-600">
                    Última entrega: {r.lastDelivery ? mediumDate(r.lastDelivery) : "ninguna registrada"}
                  </p>
                </div>
                <div
                  className={`rounded-lg px-3 py-1.5 text-right ${r.daysBehind > 0 ? "bg-rose-100 text-rose-900" : "bg-emerald-50 text-emerald-800"}`}
                >
                  <p className="text-lg font-semibold tabular-nums">{r.daysBehind}</p>
                  <p className="text-xs">{r.daysBehind === 1 ? "día de atraso" : "días de atraso"}</p>
                </div>
              </div>
              {r.behindSince ? <p className="mt-2 text-sm text-rose-800">Sin entregar desde el {mediumDate(r.behindSince)}.</p> : null}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                <span>A tiempo: {r.month.entregado}</span>
                <span>Tarde: {r.month.atrasado}</span>
                <span>Faltas: {r.month.falta}</span>
                <span>En revisión: {r.month.en_revision}</span>
              </div>
              {r.incidents.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.incidents.map((i) => (
                    <span
                      key={i.date}
                      className={`rounded px-1.5 py-0.5 text-xs ${i.status === "falta" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-900"}`}
                      title={i.status === "falta" ? "Falta" : "Entregó tarde"}
                    >
                      {shortDate(i.date)} {i.status === "falta" ? "✗" : "⏱"}
                    </span>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500">
        Hoy es {mediumDate(today)}. Ver el detalle día por día en <Link className="underline" href={`/entregas?mes=${month}`}>Entregas</Link>.
      </p>
    </>
  );
}
