import * as assert from "assert";
import {
  inferR2EndpointUrl,
  normalizePayload,
  validateSecureSetupPayload,
  SecureSetupState,
} from "../../ui/secureSetupPanel";

describe("Secure Setup Panel Validation", () => {
  const emptyState: SecureSetupState = {
    userId: "",
    region: "auto",
    hasAccessKeyId: false,
    hasSecretAccessKey: false,
    hasApiToken: false,
  };

  it("normalizePayload trims values and defaults region to auto", () => {
    const normalized = normalizePayload({
      userId: "  user-123  ",
      region: "   ",
      accessKeyId: "  access-key  ",
      secretAccessKey: "  secret-key  ",
      apiToken: "  token-abc  ",
    });

    assert.strictEqual(normalized.userId, "user-123");
    assert.strictEqual(normalized.region, "auto");
    assert.strictEqual(normalized.accessKeyId, "access-key");
    assert.strictEqual(normalized.secretAccessKey, "secret-key");
    assert.strictEqual(normalized.apiToken, "token-abc");
  });

  it("accepts newly provided credentials when no credentials currently exist", () => {
    const payload = normalizePayload({
      userId: "user-123",
      region: "auto",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret-example",
    });

    const error = validateSecureSetupPayload(payload, emptyState);
    assert.strictEqual(error, undefined);
  });

  it("requires both credentials when neither existing nor newly provided", () => {
    const payload = normalizePayload({
      userId: "user-123",
      region: "auto",
      accessKeyId: "",
      secretAccessKey: "",
    });

    const accessKeyError = validateSecureSetupPayload(payload, emptyState);
    assert.strictEqual(accessKeyError, "Access Key ID is required.");

    const withAccessOnly = normalizePayload({
      userId: "user-123",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "",
    });
    const secretError = validateSecureSetupPayload(withAccessOnly, emptyState);
    assert.strictEqual(secretError, "Secret Access Key is required.");
  });

  it("allows blank credential fields when values already exist in keyring", () => {
    const stateWithStoredSecrets: SecureSetupState = {
      ...emptyState,
      hasAccessKeyId: true,
      hasSecretAccessKey: true,
    };

    const payload = normalizePayload({
      userId: "user-123",
      accessKeyId: "",
      secretAccessKey: "",
    });

    const error = validateSecureSetupPayload(payload, stateWithStoredSecrets);
    assert.strictEqual(error, undefined);
  });

  it("rejects invalid user IDs", () => {
    const payload = normalizePayload({
      userId: "bad user id",
      region: "auto",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret-example",
    });

    const error = validateSecureSetupPayload(payload, emptyState);
    assert.strictEqual(
      error,
      "User ID must contain only letters, numbers, and hyphens."
    );
  });

  it("infers endpoint URL from user ID", () => {
    assert.strictEqual(
      inferR2EndpointUrl("ABC123"),
      "https://abc123.r2.cloudflarestorage.com"
    );
  });
});
