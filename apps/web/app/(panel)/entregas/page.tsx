import { DAY_STATUS_LABEL, type DayStatus } from "@dgm/core/deliveries";
import { getDb } from "@dgm/db";
import { RuleNote } from "@/components/rule-note";
import { DAY_STYLE, EmptyState, ExcelButton, MonthNav, PageHeader } from "@/components/ui";
import { deliveriesReport, loadRule } from "@/lib/data";
import { monthFilter, toQuery } from "@/lib/filters";
import { periodName, periodShort } from "@/lib/format";

const LEGEND: DayStatus[] = ["entregado", "atrasado", "falta", "en_revision", "pendiente", "no_exigido"];

export default async function EntregasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const db = getDb();
  const rule = await loadRule(db);
  const { month } = monthFilter(params, rule.timezone);
  const report = await deliveriesReport(db, month);

  return (
    <>
      <PageHeader
        title="Entregas"
        subtitle={<RuleNote rule={rule} />}
        actions={
          <>
            <MonthNav month={month} basePath="/entregas" />
            <ExcelButton view="entregas" query={toQuery({ mes: month })} />
          </>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {LEGEND.map((s) => (
          <span key={s} className={`inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 ${DAY_STYLE[s].cell}`}>
            <span aria-hidden>{DAY_STYLE[s].symbol}</span> {DAY_STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      {report.people.length === 0 ? (
        <EmptyState>No hay intérpretes activos.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-[1] min-w-36 border-b border-slate-200 bg-white px-3 py-2 text-left font-medium">Intérprete</th>
                {report.periods.map((pe) => {
                  const current = pe.start <= report.today && report.today <= pe.end;
                  const label = periodShort(pe);
                  return (
                    <th
                      key={pe.key}
                      title={periodName(pe)}
                      className={`border-b border-slate-200 px-1 py-2 text-center text-xs font-medium ${current ? "bg-slate-900 text-white" : "text-slate-600"}`}
                    >
                      <span className="block capitalize">{label.top}</span>
                      <span className="block whitespace-nowrap tabular-nums">{label.bottom}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {report.people.map((p) => (
                <tr key={p.id}>
                  <th className="sticky left-0 z-[1] border-b border-slate-100 bg-white px-3 py-1.5 text-left font-normal">
                    <span className="block max-w-44 truncate font-medium">{p.fullName}</span>
                    <span className="block text-xs text-slate-500">{p.company ?? p.code}</span>
                  </th>
                  {report.periods.map((pe) => {
                    const status = report.grid.get(p.id)!.get(pe.key)!;
                    return (
                      <td
                        key={pe.key}
                        className={`h-10 border-b border-l border-slate-100 text-center ${pe.kind === "half" ? "min-w-14" : "min-w-8"} ${DAY_STYLE[status].cell}`}
                        title={`${periodName(pe)}: ${DAY_STATUS_LABEL[status]}`}
                      >
                        {DAY_STYLE[status].symbol}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        {rule.frequency === "semimonthly"
          ? "Se muestran los últimos 6 meses. Un acumulado del mes al día 15 cubre la 1ª quincena; el del mes completo cubre las dos. Antes de la fecha de inicio de cada intérprete no se exige nada."
          : "Un screenshot cuenta para todos los días de su rango (Start Date – End Date). Antes de la fecha de inicio de cada intérprete no se exige nada."}
      </p>
    </>
  );
}
