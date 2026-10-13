import type { DeliveryRule } from "@dgm/core/deliveries";

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** Resumen de la regla de entrega vigente, para que el gerente sepa con qué se mide. */
export function RuleNote({ rule }: { rule: DeliveryRule }) {
  const days = [...rule.requiredWeekdays].sort().map((d) => WEEKDAYS[d]).join(", ");
  return (
    <>
      Regla {rule.frequency === "daily" ? "diaria" : "semanal"}: entregar hasta las {rule.deadlineTime.slice(0, 5)} ({rule.timezone}) · días exigidos: {days}
      {rule.holidays.length ? ` · ${rule.holidays.length} feriados` : ""}
    </>
  );
}
