import type { DeliveryRule } from "@dgm/core/deliveries";

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** Resumen de la regla de entrega vigente, para que el gerente sepa con qué se mide. */
export function RuleNote({ rule }: { rule: DeliveryRule }) {
  const time = rule.deadlineTime.slice(0, 5);
  const grace =
    rule.deadlineOffsetDays === 0 ? "el mismo día" : rule.deadlineOffsetDays === 1 ? "hasta el día siguiente" : `hasta ${rule.deadlineOffsetDays} días después`;
  if (rule.frequency === "semimonthly") {
    return (
      <>
        Regla quincenal: acumulado del mes al día 15 y al cierre del mes, entregado {grace} del corte a las {time} ({rule.timezone})
      </>
    );
  }
  const days = [...rule.requiredWeekdays].sort().map((d) => WEEKDAYS[d]).join(", ");
  return (
    <>
      Regla {rule.frequency === "daily" ? "diaria" : "semanal"}: entregar {grace} a las {time} ({rule.timezone})
      {rule.frequency === "daily" ? ` · días exigidos: ${days}` : ""}
      {rule.holidays.length ? ` · ${rule.holidays.length} feriados` : ""}
    </>
  );
}
