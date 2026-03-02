#!/usr/bin/env bun

function mustEnv(name: string): string {
  const value = Bun.env[name];
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
}

function b64url(input: Uint8Array): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function signRs256(message: string, privateKeyPem: string): Promise<string> {
  const { createPrivateKey } = await import("node:crypto");
  const keyObj = createPrivateKey(privateKeyPem);
  const pkcs8Der = new Uint8Array(keyObj.export({ format: "der", type: "pkcs8" }) as Buffer);

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(message),
  );

  return b64url(new Uint8Array(signature));
}

function normalizePem(input: string): string {
  let value = input.trim();

  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  value = value.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  value = value.replace(/^\uFEFF/, "");

  value = value
    .replace(/\s*-----BEGIN/g, "-----BEGIN")
    .replace(/END RSA PRIVATE KEY-----\s*/g, "END RSA PRIVATE KEY-----")
    .replace(/-----BEGIN RSA PRIVATE KEY-----\s*/g, "-----BEGIN RSA PRIVATE KEY-----\n")
    .replace(/\s*-----END RSA PRIVATE KEY-----/g, "\n-----END RSA PRIVATE KEY-----");

  return `${value.trim()}\n`;
}

async function mintGithubInstallationToken(opts: {
  appId: string;
  installationId: string;
  privateKeyPem: string;
  jwtExpiryMinutes?: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const requestedMinutes = opts.jwtExpiryMinutes ?? 9;
  const jwtMinutes = Math.min(requestedMinutes, 10);

  const header = b64url(
    new TextEncoder().encode(
      JSON.stringify({ alg: "RS256", typ: "JWT" }),
    ),
  );

  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iat: now - 60,
        exp: now + jwtMinutes * 60,
        iss: Number(opts.appId),
      }),
    ),
  );

  const unsigned = `${header}.${payload}`;
  const signature = await signRs256(unsigned, opts.privateKeyPem);
  const jwt = `${unsigned}.${signature}`;

  const response = await fetch(
    `https://api.github.com/app/installations/${opts.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub token mint failed: ${response.status} ${response.statusText}\n${text}`);
  }

  const json = await response.json() as { token?: string };
  if (!json.token) {
    throw new Error("GitHub response missing token");
  }

  return json.token;
}

async function main(): Promise<void> {
  const appId = mustEnv("GH_BOT_APP_ID");
  const installationId = mustEnv("GH_BOT_INSTALLATION_ID");
  const privateKeyPem = normalizePem(mustEnv("GH_BOT_PRIVATE_KEY"));

  const token = await mintGithubInstallationToken({
    appId,
    installationId,
    privateKeyPem,
  });

  process.stdout.write(token);
}

main().catch((error: unknown) => {
  console.error(String((error as Error)?.stack ?? error));
  process.exit(1);
});
