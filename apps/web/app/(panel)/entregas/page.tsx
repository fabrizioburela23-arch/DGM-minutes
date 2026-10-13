import { DAY_STATUS_LABEL, type DayStatus } from "@dgm/core/deliveries";
import { getDb } from "@dgm/db";
import { RuleNote } from "@/components/rule-note";
import { DAY_STYLE, EmptyState, ExcelButton, MonthNav, PageHeader } from "@/components/ui";
import { deliveriesReport, loadRule } from "@/lib/data";
import { monthFilter, toQuery } from "@/lib/filters";
import { shortDate } from "@/lib/format";

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
                {report.days.map((d) => (
                  <th
                    key={d}
                    className={`border-b border-slate-200 px-1 py-2 text-center text-xs font-medium ${d === report.today ? "bg-slate-900 text-white" : "text-slate-600"}`}
                  >
                    <span className="block capitalize">{shortDate(d).split(" ")[0].replace(".", "")}</span>
                    <span className="block tabular-nums">{Number(d.slice(8))}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.people.map((p) => (
                <tr key={p.id}>
                  <th className="sticky left-0 z-[1] border-b border-slate-100 bg-white px-3 py-1.5 text-left font-normal">
                    <span className="block font-medium">{p.code}</span>
                    <span className="block max-w-40 truncate text-xs text-slate-500">{p.fullName}</span>
                  </th>
                  {report.days.map((d) => {
                    const status = report.grid.get(p.id)!.get(d)!;
                    return (
                      <td
                        key={d}
                        className={`h-10 min-w-8 border-b border-l border-slate-100 text-center ${DAY_STYLE[status].cell}`}
                        title={`${shortDate(d)}: ${DAY_STATUS_LABEL[status]}`}
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
        Un screenshot cuenta para todos los días de su rango (Start Date – End Date). Antes de la fecha de inicio de cada intérprete no se exige nada.
      </p>
    </>
  );
}
