import { getDb } from "@dgm/db";
import Link from "next/link";
import { buttonClass, Card, EmptyState, ExcelButton, inputClass, PageHeader, Stat } from "@/components/ui";
import { loadRule, minutesReport } from "@/lib/data";
import { minutesFilter, toQuery } from "@/lib/filters";
import { number, periodLabel } from "@/lib/format";

export default async function MinutosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const db = getDb();
  const rule = await loadRule(db);
  const f = minutesFilter(params, rule.timezone);
  const report = await minutesReport(db, f.from, f.to, f.grouping);
  const maxPeriod = Math.max(1, ...report.periods.map((p) => p.minutes));

  return (
    <>
      <PageHeader
        title="Minutos"
        subtitle="Solo cuentan screenshots leídos o confirmados. Lo que está en revisión se muestra aparte."
        actions={<ExcelButton view="minutos" query={toQuery({ desde: f.from, hasta: f.to, agrupar: f.grouping })} />}
      />

      <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-sm">
          Desde
          <input className={inputClass} type="date" name="desde" defaultValue={f.from} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Hasta
          <input className={inputClass} type="date" name="hasta" defaultValue={f.to} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Agrupar por
          <select className={inputClass} name="agrupar" defaultValue={f.grouping}>
            <option value="dia">Día</option>
            <option value="semana">Semana</option>
            <option value="mes">Mes</option>
          </select>
        </label>
        <button className={buttonClass} type="submit">
          Aplicar
        </button>
      </form>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Minutos del equipo" value={number(report.total.minutes)} />
        <Stat label="Llamadas" value={number(report.total.calls)} />
        <Stat label="Screenshots contados" value={number(report.total.deliveries)} />
        <Stat
          label="En revisión (no suma)"
          value={number(report.inReview.minutes)}
          hint={`${report.inReview.deliveries} screenshot(s) de este rango en revisión`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-medium">Ranking</h2>
          {report.ranking.length === 0 ? (
            <EmptyState>Sin minutos en este rango.</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Intérprete</th>
                  <th className="py-1 pr-2 text-right">Minutos</th>
                  <th className="py-1 text-right">Llamadas</th>
                </tr>
              </thead>
              <tbody>
                {report.ranking.map((r, i) => (
                  <tr key={r.interpreter.id} className="border-t border-slate-100">
                    <td className="py-2 pr-2 text-slate-500">{i + 1}</td>
                    <td className="py-2 pr-2">
                      <span className="font-medium">{r.interpreter.fullName}</span>{" "}
                      <span className="text-xs text-slate-500">{r.interpreter.code}</span>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{number(r.minutes)}</td>
                    <td className="py-2 text-right tabular-nums">{number(r.calls)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-medium">Total del equipo por {f.grouping === "dia" ? "día" : f.grouping}</h2>
          {report.periods.length === 0 ? (
            <EmptyState>Sin minutos en este rango.</EmptyState>
          ) : (
            <ul className="space-y-2 text-sm">
              {report.periods.map((p) => (
                <li key={p.key}>
                  <div className="flex justify-between gap-2">
                    <span>{periodLabel(p.key, f.grouping)}</span>
                    <span className="tabular-nums">{number(p.minutes)} min</span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-slate-100">
                    <div className="h-2 rounded bg-slate-800" style={{ width: `${(p.minutes / maxPeriod) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Un screenshot que cubre varios días se cuenta en la fecha final de su rango. Para revisar lo pendiente, abre{" "}
        <Link className="underline" href="/revision">
          Revisión
        </Link>
        .
      </p>
    </>
  );
}
