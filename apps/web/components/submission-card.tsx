import { ReviewForm } from "@/components/review-form";
import { Card, StatusBadge } from "@/components/ui";
import type { SubmissionView } from "@/lib/data";
import { dateTime, driveLink, number, range } from "@/lib/format";

/** Tarjeta de un screenshot: imagen, lo que leyó la IA, confianza, enlace a Drive y (opcional) acciones de revisión. */
export function SubmissionCard({
  s,
  image,
  timezone,
  review,
  people,
}: {
  s: SubmissionView;
  image: string | null;
  timezone: string;
  review: "open" | "collapsed" | "none";
  people: { id: number; label: string }[];
}) {
  const portalMismatch = s.expectedPortalId && s.portalInterpreterId && s.expectedPortalId !== s.portalInterpreterId;
  const canConfirm = s.minutes !== null && Boolean(s.periodStart && s.periodEnd);
  const form = (
    <ReviewForm
      submissionId={s.id}
      minutes={s.minutes}
      calls={s.calls}
      periodStart={s.periodStart}
      periodEnd={s.periodEnd}
      canConfirm={canConfirm}
      interpreterId={s.interpreterId}
      people={people}
    />
  );

  return (
    <Card className="flex flex-col gap-3 sm:flex-row">
      <a
        href={image ?? driveLink(s.driveFileId)}
        target="_blank"
        rel="noreferrer"
        className="flex h-48 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 sm:h-auto sm:w-64"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={`Screenshot ${s.fileName}`} className="h-full w-full object-contain" loading="lazy" />
        ) : (
          <span className="p-4 text-center text-xs text-slate-500">Vista previa no disponible. Abrir en Drive.</span>
        )}
      </a>

      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">
            {s.interpreterName ?? <span className="text-rose-700">Sin identificar</span>}{" "}
            {s.uploaderName ? <span className="text-sm font-normal text-slate-500">· en el Form: «{s.uploaderName}»</span> : null}
          </p>
          <StatusBadge status={s.status} />
        </div>
        <p className="text-xs text-slate-500">
          #{s.id} · {s.fileName} · subido {dateTime(s.uploadedAt, timezone)}
        </p>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">Minutos</dt>
            <dd className="font-semibold tabular-nums">{s.minutes === null ? "—" : number(s.minutes)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Llamadas</dt>
            <dd className="tabular-nums">{s.calls === null ? "—" : number(s.calls)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Rango</dt>
            <dd>{range(s.periodStart, s.periodEnd)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">ID en Propio</dt>
            <dd className={portalMismatch ? "font-medium text-rose-700" : ""}>
              {s.portalInterpreterId ?? "—"}
              {portalMismatch ? ` (esperado ${s.expectedPortalId})` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Confianza</dt>
            <dd>{s.confidence === null ? "—" : `${Math.round(s.confidence * 100)}%`}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Leído por</dt>
            <dd className="truncate">{s.model === "manual" ? "Gerente (corrección)" : (s.model ?? "Aún sin leer")}{s.escalated ? " · escalado" : ""}</dd>
          </div>
        </dl>

        {s.reviewReason ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Motivo: {s.reviewReason}</p> : null}

        <a className="inline-block text-xs text-sky-700 underline" href={driveLink(s.driveFileId)} target="_blank" rel="noreferrer">
          Abrir el archivo en Drive
        </a>

        {review === "open" ? <div className="border-t border-slate-100 pt-3">{form}</div> : null}
        {review === "collapsed" ? (
          <details className="border-t border-slate-100 pt-2">
            <summary className="cursor-pointer text-xs text-slate-600">Corregir o rechazar</summary>
            <div className="pt-2">{form}</div>
          </details>
        ) : null}
      </div>
    </Card>
  );
}
