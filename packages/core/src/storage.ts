import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Lo mínimo que el sistema necesita del bucket de imágenes. */
export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}`);
  return value;
}

/** Bucket privado de Railway (compatible S3). Lee las variables S3_*. */
export class S3ObjectStore implements ObjectStore {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = requireEnv("S3_BUCKET");
    this.client = new S3Client({
      endpoint: requireEnv("S3_ENDPOINT"),
      region: process.env.S3_REGION || "auto",
      credentials: {
        accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Objeto vacío: ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  /** URL temporal para ver una imagen privada (el dashboard la usará en el hito 5). */
  async signedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSeconds });
  }
}
