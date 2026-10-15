import { getDb } from "@dgm/db";
import { SubmissionCard } from "@/components/submission-card";
import { EmptyState, PageHeader } from "@/components/ui";
import { INBOX, loadInterpreters, loadRule, loadSubmissions } from "@/lib/data";
import { imageUrl } from "@/lib/images";
import { suggestByName } from "@dgm/core/names";

export default async function RevisionPage() {
  const db = getDb();
  const rule = await loadRule(db);
  const subs = await loadSubmissions(db, { statuses: INBOX, activeOnly: true, order: "oldest", limit: 50 });
  const images = await Promise.all(subs.map((s) => imageUrl(s.storageKey)));
  const roster = await loadInterpreters(db, { activeOnly: true });
  const people = roster.map((p) => ({ id: p.id, label: `${p.fullName}${p.company ? ` · ${p.company}` : ""}` }));

  return (
    <>
      <PageHeader
        title="Bandeja de revisión"
        subtitle="Screenshots que la IA no pudo dar por buenos, o duplicados. Confirma, corrige o rechaza; cada decisión queda registrada con tu correo."
      />
      {subs.length === 0 ? (
        <EmptyState>No hay nada pendiente de revisión. ✓</EmptyState>
      ) : (
        <div className="space-y-3">
          {subs.map((s, i) => (
            <SubmissionCard key={s.id} s={s} image={images[i]} timezone={rule.timezone} people={people} suggestedId={s.interpreterId ? null : (suggestByName(s.uploaderName, roster)?.id ?? null)} review="open" />
          ))}
        </div>
      )}
    </>
  );
}
