
import { S3Client } from "bun";

const credentials = {
  accessKeyId: (await Bun.$`op read "op://June/Cloudflare/R2_ACCESS_KEY_ID"`.text()).trim(),
  secretAccessKey: (await Bun.$`op read "op://June/Cloudflare/R2_SECRET_ACCESS_KEY"`.text()).trim(),
  endpoint: (await Bun.$`op read "op://June/Cloudflare/R2_URL"`.text()).trim(),
  region: "auto",
};
console.log(credentials)

const bucket = "test";

const s3 = new S3Client({
  accessKeyId: credentials.accessKeyId,
  secretAccessKey: credentials.secretAccessKey,
  endpoint: credentials.endpoint,
  region: credentials.region,
 // bucket: "internal"
});

const res = await s3.list();
console.log(res);
