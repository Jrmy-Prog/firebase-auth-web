import test from "node:test";
import assert from "node:assert/strict";
import { requireAuth, requireVerifiedIdentity } from "../auth.js";
import { passwordCheck } from "../public/password.js";

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("menolak request tanpa bearer token", async () => {
  const res = response();
  let called = false;

  await requireAuth(async () => {
    throw new Error("verifier tidak boleh dipanggil");
  })({ headers: {} }, res, () => { called = true; });

  assert.equal(res.statusCode, 401);
  assert.equal(called, false);
});

test("menolak token invalid atau dicabut", async () => {
  const res = response();

  await requireAuth(async () => {
    throw new Error("revoked");
  })(
    { headers: { authorization: "Bearer invalid" } },
    res,
    () => assert.fail("Tidak boleh lolos")
  );

  assert.equal(res.statusCode, 401);
});

test("verifier wajib memeriksa revocation", async () => {
  const req = { headers: { authorization: "Bearer token" } };
  let passed = false;

  await requireAuth(async (token, revoked) => {
    assert.equal(token, "token");
    assert.equal(revoked, true);
    return { uid: "user-1" };
  })(req, response(), () => { passed = true; });

  assert.equal(passed, true);
  assert.equal(req.user.uid, "user-1");
});

test("email belum diverifikasi ditolak", () => {
  const res = response();
  requireVerifiedIdentity(
    { user: { email_verified: false } },
    res,
    () => assert.fail("Tidak boleh lolos")
  );
  assert.equal(res.statusCode, 403);
});

test("email terverifikasi dan login telepon diterima", () => {
  for (const user of [
    { email_verified: true },
    { phone_number: "+6281234567890", firebase: { sign_in_provider: "phone" } }
  ]) {
    let passed = false;
    requireVerifiedIdentity(
      { user },
      response(),
      () => { passed = true; }
    );
    assert.equal(passed, true);
  }
});

test("nomor telepon saja tidak melewati aturan provider", () => {
  const res = response();
  requireVerifiedIdentity(
    { user: { phone_number: "+6281234567890" } },
    res,
    () => assert.fail("Tidak boleh lolos")
  );
  assert.equal(res.statusCode, 403);
});

test("validasi batas dan komposisi password", () => {
  assert.equal(passwordCheck("short").valid, false);
  assert.equal(passwordCheck("abcdefghijklmnop").valid, false);
  assert.equal(passwordCheck("Contoh-Panjang92!").valid, true);
  assert.equal(passwordCheck("Aa1!" + "x".repeat(125)).valid, false);
});