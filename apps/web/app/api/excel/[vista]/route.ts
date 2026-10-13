import { getDb } from "@dgm/db";
import { buildWorkbook, EXCEL_VIEWS, type ExcelView } from "@/lib/excel";
import { findManager } from "@/lib/managers";
import { sessionEmail } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ vista: string }> }) {
  const email = await sessionEmail();
  if (!email || !(await findManager(email))) return new Response("Sin acceso", { status: 401 });

  const { vista } = await params;
  if (!EXCEL_VIEWS.includes(vista as ExcelView)) return new Response("Vista desconocida", { status: 404 });

  const { buffer, fileName } = await buildWorkbook(getDb(), vista as ExcelView, new URL(request.url).searchParams);
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
