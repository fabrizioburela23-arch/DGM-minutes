import { DAY_STATUS_LABEL } from "@dgm/core/deliveries";
import type { AnyDb } from "@dgm/db";
import ExcelJS from "exceljs";
import { deliveriesReport, lateReport, loadInterpreters, loadRule, loadSubmissions, minutesReport, STATUS_LABEL } from "./data";
import { monthFilter, minutesFilter, screenshotsFilter, type RawParams } from "./filters";
import { dateTime, driveLink, periodLabel } from "./format";

export type ExcelView = "atrasos" | "minutos" | "entregas" | "screenshots";
export const EXCEL_VIEWS: ExcelView[] = ["atrasos", "minutos", "entregas", "screenshots"];

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width?: number }[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ ...c, width: c.width ?? Math.max(12, c.header.length + 2) }));
  ws.getRow(1).font = { bold: true };
  return ws;
}

/** Arma el Excel de una vista con los mismos filtros que la página. */
export async function buildWorkbook(db: AnyDb, view: ExcelView, params: RawParams, now = new Date()): Promise<{ buffer: ArrayBuffer; fileName: string }> {
  const rule = await loadRule(db);
  const wb = new ExcelJS.Workbook();
  wb.creator = "DGM Minutos";
  wb.created = now;
  let suffix: string;

  if (view === "atrasos") {
    const { month } = monthFilter(params, rule.timezone);
    suffix = month;
    const { rows } = await lateReport(db, month, now);
    const ws = sheet(wb, "Atrasos", [
      { header: "Código", key: "code" },
      { header: "Intérprete", key: "name", width: 28 },
      { header: "Días de atraso hoy", key: "behind" },
      { header: "Atrasado desde", key: "since" },
      { header: "Última entrega", key: "last" },
      { header: "Faltas en el mes", key: "falta" },
      { header: "Atrasadas en el mes", key: "atrasado" },
      { header: "En revisión", key: "revision" },
      { header: "Entregadas a tiempo", key: "entregado" },
      { header: "Días con falta o atraso", key: "incidents", width: 50 },
    ]);
    for (const r of rows) {
      ws.addRow({
        code: r.interpreter.code,
        name: r.interpreter.fullName,
        behind: r.daysBehind,
        since: r.behindSince ?? "",
        last: r.lastDelivery ?? "",
        falta: r.month.falta,
        atrasado: r.month.atrasado,
        revision: r.month.en_revision,
        entregado: r.month.entregado,
        incidents: r.incidents.map((i) => `${i.date} (${i.status})`).join(", "),
      });
    }
  } else if (view === "entregas") {
    const { month } = monthFilter(params, rule.timezone);
    suffix = month;
    const report = await deliveriesReport(db, month, now);
    const ws = sheet(wb, "Entregas", [
      { header: "Código", key: "code" },
      { header: "Intérprete", key: "name", width: 28 },
      ...report.days.map((d) => ({ header: d, key: d, width: 12 })),
    ]);
    for (const p of report.people) {
      const row: Record<string, string> = { code: p.code, name: p.fullName };
      for (const d of report.days) row[d] = DAY_STATUS_LABEL[report.grid.get(p.id)!.get(d)!];
      ws.addRow(row);
    }
  } else if (view === "minutos") {
    const f = minutesFilter(params, rule.timezone, now);
    suffix = `${f.from}_${f.to}`;
    const report = await minutesReport(db, f.from, f.to, f.grouping);
    const ranking = sheet(wb, "Ranking", [
      { header: "Puesto", key: "pos" },
      { header: "Código", key: "code" },
      { header: "Intérprete", key: "name", width: 28 },
      { header: "Minutos", key: "minutes" },
      { header: "Llamadas", key: "calls" },
      { header: "Entregas", key: "deliveries" },
    ]);
    report.ranking.forEach((r, i) =>
      ranking.addRow({ pos: i + 1, code: r.interpreter.code, name: r.interpreter.fullName, minutes: r.minutes, calls: r.calls, deliveries: r.deliveries }),
    );
    ranking.addRow({});
    ranking.addRow({ name: "Total del equipo", minutes: report.total.minutes, calls: report.total.calls, deliveries: report.total.deliveries }).font = { bold: true };
    ranking.addRow({ name: "En revisión (no suma)", minutes: report.inReview.minutes, deliveries: report.inReview.deliveries });

    const keys = report.periods.map((p) => p.key);
    const pivot = sheet(wb, "Por periodo", [
      { header: "Código", key: "code" },
      { header: "Intérprete", key: "name", width: 28 },
      ...keys.map((k) => ({ header: periodLabel(k, f.grouping), key: k, width: 18 })),
      { header: "Total", key: "total" },
    ]);
    for (const r of report.ranking) {
      const cells = report.pivot.get(r.interpreter.id);
      const row: Record<string, string | number> = { code: r.interpreter.code, name: r.interpreter.fullName, total: r.minutes };
      for (const k of keys) row[k] = cells?.get(k) ?? 0;
      pivot.addRow(row);
    }
    const totals: Record<string, string | number> = { name: "Total del equipo", total: report.total.minutes };
    for (const p of report.periods) totals[p.key] = p.minutes;
    pivot.addRow(totals).font = { bold: true };

    const notes = wb.addWorksheet("Notas");
    notes.addRow([`Rango: ${f.from} a ${f.to}`]);
    notes.addRow(["Solo cuentan lecturas leídas o confirmadas. Lo que está en revisión se muestra aparte y no suma."]);
    notes.addRow(["Un screenshot que cubre varios días se cuenta en la fecha final de su rango."]);
  } else {
    const f = screenshotsFilter(params);
    suffix = [f.from, f.to].filter(Boolean).join("_") || "todo";
    const people = await loadInterpreters(db);
    const subs = await loadSubmissions(db, { interpreterId: f.interpreterId, statuses: f.status ? [f.status] : undefined, from: f.from, to: f.to });
    const ws = sheet(wb, "Screenshots", [
      { header: "Entrega", key: "id" },
      { header: "Código", key: "code" },
      { header: "Intérprete", key: "name", width: 28 },
      { header: "Archivo", key: "file", width: 28 },
      { header: "Subido", key: "uploaded", width: 20 },
      { header: "Estado", key: "status", width: 18 },
      { header: "Desde", key: "start" },
      { header: "Hasta", key: "end" },
      { header: "Minutos", key: "minutes" },
      { header: "Llamadas", key: "calls" },
      { header: "ID en Propio", key: "portal" },
      { header: "Confianza", key: "confidence" },
      { header: "Modelo", key: "model", width: 20 },
      { header: "Motivo de revisión", key: "reason", width: 50 },
      { header: "Enlace en Drive", key: "link", width: 50 },
    ]);
    for (const s of subs) {
      ws.addRow({
        id: s.id,
        code: s.interpreterCode,
        name: people.find((p) => p.id === s.interpreterId)?.fullName ?? "",
        file: s.fileName,
        uploaded: dateTime(s.uploadedAt, rule.timezone),
        status: STATUS_LABEL[s.status],
        start: s.periodStart ?? "",
        end: s.periodEnd ?? "",
        minutes: s.minutes ?? "",
        calls: s.calls ?? "",
        portal: s.portalInterpreterId ?? "",
        confidence: s.confidence ?? "",
        model: s.model ?? "",
        reason: s.reviewReason ?? "",
        link: { text: "Abrir", hyperlink: driveLink(s.driveFileId) },
      });
    }
    ws.getColumn("confidence").numFmt = "0%";
  }

  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return { buffer, fileName: `dgm-${view}-${suffix}.xlsx` };
}
