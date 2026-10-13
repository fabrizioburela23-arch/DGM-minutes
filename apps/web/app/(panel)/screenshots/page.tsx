import { getDb } from "@dgm/db";
import Link from "next/link";
import { SubmissionCard } from "@/components/submission-card";
import { buttonClass, EmptyState, ExcelButton, inputClass, PageHeader } from "@/components/ui";
import { loadInterpreters, loadRule, loadSubmissions, STATUS_LABEL, type SubmissionStatus } from "@/lib/data";
import { screenshotsFilter, toQuery } from "@/lib/filters";
import { imageUrl } from "@/lib/images";

const PAGE_SIZE = 20;

export default async function ScreenshotsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const db = getDb();
  const rule = await loadRule(db);
  const f = screenshotsFilter(params);
  const people = await loadInterpreters(db);
  const subs = await loadSubmissions(db, {
    interpreterId: f.interpreterId,
    statuses: f.status ? [f.status] : undefined,
    from: f.from,
    to: f.to,
    limit: PAGE_SIZE + 1,
    offset: (f.page - 1) * PAGE_SIZE,
  });
  const hasMore = subs.length > PAGE_SIZE;
  const shown = subs.slice(0, PAGE_SIZE);
  const images = await Promise.all(shown.map((s) => imageUrl(s.storageKey)));
  const filters = { interprete: f.interpreterId?.toString(), estado: f.status, desde: f.from, hasta: f.to };

  return (
    <>
      <PageHeader
        title="Screenshots"
        subtitle="Cada imagen subida a Drive, con lo que leyó la IA."
        actions={<ExcelButton view="screenshots" query={toQuery(filters)} />}
      />

      <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-sm">
          Intérprete
          <select className={inputClass} name="interprete" defaultValue={f.interpreterId ?? ""}>
            <option value="">Todos</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Estado
          <select className={inputClass} name="estado" defaultValue={f.status ?? ""}>
            <option value="">Todos</option>
            {(Object.keys(STATUS_LABEL) as SubmissionStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Desde
          <input className={inputClass} type="date" name="desde" defaultValue={f.from ?? ""} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Hasta
          <input className={inputClass} type="date" name="hasta" defaultValue={f.to ?? ""} />
        </label>
        <button className={buttonClass} type="submit">
          Filtrar
        </button>
        <Link className="px-2 py-2 text-sm text-slate-600 underline" href="/screenshots">
          Limpiar
        </Link>
      </form>

      {shown.length === 0 ? (
        <EmptyState>No hay screenshots con estos filtros.</EmptyState>
      ) : (
        <div className="space-y-3">
          {shown.map((s, i) => (
            <SubmissionCard key={s.id} s={s} image={images[i]} timezone={rule.timezone} review={s.status === "pending" ? "none" : "collapsed"} />
          ))}
        </div>
      )}

      <div className="mt-4 flex justify-between text-sm">
        {f.page > 1 ? (
          <Link className="underline" href={`/screenshots${toQuery(filters, { pagina: String(f.page - 1) })}`}>
            ← Más nuevos
          </Link>
        ) : (
          <span />
        )}
        {hasMore ? (
          <Link className="underline" href={`/screenshots${toQuery(filters, { pagina: String(f.page + 1) })}`}>
            Más antiguos →
          </Link>
        ) : null}
      </div>
    </>
  );
}
