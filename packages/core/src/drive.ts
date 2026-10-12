import { drive as googleDrive, type drive_v3 } from "@googleapis/drive";
import { JWT } from "google-auth-library";

export type DriveFolder = { id: string; name: string };
export type DriveImage = { id: string; name: string; mimeType: string; createdTime: string | null };

/** Lo mínimo que el worker necesita de Drive. Permite probar con una versión simulada. */
export interface DriveSource {
  listSubfolders(parentId: string): Promise<DriveFolder[]>;
  listImages(folderId: string): Promise<DriveImage[]>;
  download(fileId: string): Promise<Buffer>;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|heic)$/i;

/** Acepta el JSON de la cuenta de servicio tal cual o codificado en base64. */
export function parseServiceAccountJson(raw: string): { client_email: string; private_key: string } {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const parsed = JSON.parse(text) as { client_email?: string; private_key?: string };
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no tiene client_email o private_key");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

export function isImageFile(file: { name: string; mimeType: string }): boolean {
  return file.mimeType.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name);
}

/** Drive real, solo lectura, con la cuenta de servicio. */
export class GoogleDriveSource implements DriveSource {
  private api: drive_v3.Drive;

  constructor(serviceAccountJson: string) {
    const creds = parseServiceAccountJson(serviceAccountJson);
    const auth = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    });
    this.api = googleDrive({ version: "v3", auth });
  }

  private async listAll(q: string, fields: string): Promise<drive_v3.Schema$File[]> {
    const files: drive_v3.Schema$File[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.api.files.list({
        q,
        fields: `nextPageToken, files(${fields})`,
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      files.push(...(res.data.files ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return files;
  }

  async listSubfolders(parentId: string): Promise<DriveFolder[]> {
    const files = await this.listAll(`'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`, "id, name");
    return files.map((f) => ({ id: f.id!, name: f.name ?? "" }));
  }

  async listImages(folderId: string): Promise<DriveImage[]> {
    const files = await this.listAll(
      `'${folderId}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`,
      "id, name, mimeType, createdTime",
    );
    return files
      .map((f) => ({ id: f.id!, name: f.name ?? "", mimeType: f.mimeType ?? "", createdTime: f.createdTime ?? null }))
      .filter(isImageFile);
  }

  async download(fileId: string): Promise<Buffer> {
    const res = await this.api.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
    return Buffer.from(res.data as ArrayBuffer);
  }
}
