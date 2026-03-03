import * as assert from "assert";
import {
  normalizePayload,
  validateSecureSetupPayload,
  SecureSetupState,
} from "../../ui/secureSetupPanel";

describe("Secure Setup Panel Validation", () => {
  const emptyState: SecureSetupState = {
    endpointUrl: "",
    region: "auto",
    hasAccessKeyId: false,
    hasSecretAccessKey: false,
  };

  it("normalizePayload trims values and defaults region to auto", () => {
    const normalized = normalizePayload({
      endpointUrl: "  https://example.r2.cloudflarestorage.com  ",
      region: "   ",
      accessKeyId: "  access-key  ",
      secretAccessKey: "  secret-key  ",
    });

    assert.strictEqual(
      normalized.endpointUrl,
      "https://example.r2.cloudflarestorage.com"
    );
    assert.strictEqual(normalized.region, "auto");
    assert.strictEqual(normalized.accessKeyId, "access-key");
    assert.strictEqual(normalized.secretAccessKey, "secret-key");
  });

  it("accepts newly provided credentials when no credentials currently exist", () => {
    const payload = normalizePayload({
      endpointUrl: "https://example.r2.cloudflarestorage.com",
      region: "auto",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret-example",
    });

    const error = validateSecureSetupPayload(payload, emptyState);
    assert.strictEqual(error, undefined);
  });

  it("requires both credentials when neither existing nor newly provided", () => {
    const payload = normalizePayload({
      endpointUrl: "https://example.r2.cloudflarestorage.com",
      region: "auto",
      accessKeyId: "",
      secretAccessKey: "",
    });

    const accessKeyError = validateSecureSetupPayload(payload, emptyState);
    assert.strictEqual(accessKeyError, "Access Key ID is required.");

    const withAccessOnly = normalizePayload({
      endpointUrl: "https://example.r2.cloudflarestorage.com",
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
      endpointUrl: "https://example.r2.cloudflarestorage.com",
      accessKeyId: "",
      secretAccessKey: "",
    });

    const error = validateSecureSetupPayload(payload, stateWithStoredSecrets);
    assert.strictEqual(error, undefined);
  });

  it("rejects non-HTTPS endpoint URLs", () => {
    const payload = normalizePayload({
      endpointUrl: "http://example.r2.cloudflarestorage.com",
      region: "auto",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret-example",
    });

    const error = validateSecureSetupPayload(payload, emptyState);
    assert.strictEqual(error, "Endpoint URL must be a valid HTTPS URL.");
  });
});
