import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  reload,
  validatePassword,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import { passwordCheck } from "./password.js";

const $ = id => document.getElementById(id);

let auth;
let verifier;
let confirmation;
let smsReadyAt = 0;
let emailReadyAt = 0;

function message(text) {
  $("message").textContent = text;
}

function safeError(error, context) {
  const code = error?.code;

  if (code === "auth/network-request-failed") {
    return "Koneksi gagal. Periksa internet Anda.";
  }
  if (code === "auth/too-many-requests") {
    return "Terlalu banyak percobaan. Coba lagi nanti.";
  }
  if (context === "signin") {
    // Sama untuk email tidak ada, password salah, dan akun nonaktif.
    return "Email atau password salah (incorrect email or password).";
  }
  if (context === "signup") {
    // Tidak mengungkap apakah email telah terdaftar.
    return "Pendaftaran tidak dapat diselesaikan. Coba masuk atau gunakan email lain.";
  }
  if (context === "sms") {
    return "SMS tidak dapat dikirim. Periksa nomor, reCAPTCHA, atau coba lagi nanti.";
  }
  if (context === "otp") {
    return "Kode tidak valid atau kedaluwarsa. Coba lagi atau minta kode baru.";
  }
  return "Permintaan tidak dapat diselesaikan. Coba lagi nanti.";
}

async function run(element, operation, context) {
  const buttons = [...element.querySelectorAll("button")];
  if (element.matches("button")) buttons.push(element);
  buttons.forEach(button => { button.disabled = true; });

  try {
    await operation();
  } catch (error) {
    message(safeError(error, context));
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

function resetCaptcha() {
  verifier?.clear();
  verifier = undefined;
  $("recaptcha").replaceChildren();
}

function renderAccount(user) {
  $("guest").hidden = Boolean(user);
  $("account").hidden = !user;
  $("result").textContent = "";

  if (!user) return;

  $("identity").textContent = user.email || user.phoneNumber || user.uid;
  $("verified").textContent = user.email
    ? user.emailVerified ? "Email sudah diverifikasi." : "Email belum diverifikasi."
    : "Masuk menggunakan nomor telepon.";

  $("resend").hidden = !user.email || user.emailVerified;
  $("refresh").hidden = !user.email || user.emailVerified;
}

document.querySelectorAll("[data-panel]").forEach(button => {
  button.addEventListener("click", () => {
    for (const id of ["signin", "signup", "phone"]) {
      $(id).hidden = id !== button.dataset.panel;
    }
    message("Silakan lengkapi formulir.");
  });
});

$("new-password").addEventListener("input", event => {
  const result = passwordCheck(event.target.value);
  $("meter").value = result.score;
  $("strength").textContent = result.label;
});

$("signin").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;

  run(form, async () => {
    const data = new FormData(form);
    await signInWithEmailAndPassword(
      auth,
      data.get("email").trim(),
      data.get("password")
    );
    form.reset();
    message("Berhasil masuk.");
  }, "signin");
});

$("signup").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;

  run(form, async () => {
    const data = new FormData(form);
    const password = data.get("password");

    if (!passwordCheck(password).valid) {
      message("Password belum memenuhi aturan.");
      return;
    }
    if (password !== data.get("confirm")) {
      message("Konfirmasi password tidak cocok.");
      return;
    }

    // Memeriksa kebijakan yang dikonfigurasi pada proyek Firebase.
    const policy = await validatePassword(auth, password);
    if (!policy.isValid) {
      message("Password tidak memenuhi kebijakan Firebase.");
      return;
    }

    const { user } = await createUserWithEmailAndPassword(
      auth,
      data.get("email").trim(),
      password
    );

    form.reset();

    try {
       await sendEmailVerification(user);

      localStorage.setItem(
      `verifyEmailNextAt:${user.uid}`,
      String(Date.now() + 60_000)
    );

      message("Akun dibuat. Buka email verifikasi, lalu klik “Saya sudah verifikasi”.");
    } catch {
      message("Akun dibuat, tetapi email belum terkirim. Gunakan tombol kirim email verifikasi.");
    }
  }, "signup");
});

$("resend").addEventListener("click", event => {
  run(event.currentTarget, async () => {
    const user = auth.currentUser;

    if (!user) {
      message("Anda belum masuk.");
      return;
    }

    const key = `verifyEmailNextAt:${user.uid}`;
    const nextAt = Number(localStorage.getItem(key) || 0);
    const remaining = Math.ceil((nextAt - Date.now()) / 1000);

    if (remaining > 0) {
      message(`Tunggu ${remaining} detik sebelum mengirim ulang.`);
      return;
    }

    try {
      await sendEmailVerification(user);
      localStorage.setItem(key, String(Date.now() + 60_000));
      message("Email verifikasi dikirim. Periksa juga folder spam.");
    } catch (error) {
      console.error("Kode error:", error.code);
      console.error("Pesan error:", error.message);
      message("Email gagal dikirim. Periksa Console untuk detail error.");
    }
  }, "verification");
});

$("refresh").addEventListener("click", event => {
  run(event.currentTarget, async () => {
    const user = auth.currentUser;
    if (!user) return;

    await reload(user);
    await user.getIdToken(true);
    renderAccount(user);
    message(user.emailVerified
      ? "Email sudah diverifikasi."
      : "Email belum diverifikasi. Buka tautan pada email.");
  }, "verification");
});

$("send-sms").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;

  run(form, async () => {
    if (Date.now() < smsReadyAt) {
      message("Tunggu 60 detik sebelum meminta kode baru.");
      return;
    }

    const data = new FormData(form);
    const phone = data.get("phone").trim();

    if (!/^\+[1-9]\d{7,14}$/.test(phone) || !data.get("consent")) {
      message("Gunakan nomor format internasional dan setujui pengiriman SMS.");
      return;
    }

    // Kode lama tidak dipakai setelah permintaan baru dimulai.
    confirmation = undefined;
    $("confirm-sms").hidden = true;
    resetCaptcha();

    verifier = new RecaptchaVerifier(auth, "recaptcha", {
      size: "normal"
    });

    try {
      await verifier.render();
      confirmation = await signInWithPhoneNumber(auth, phone, verifier);
      smsReadyAt = Date.now() + 60_000;
      $("confirm-sms").hidden = false;
      message("Kode SMS dikirim. Masukkan enam digit kode.");
    } finally {
      resetCaptcha();
    }
  }, "sms");
});

$("confirm-sms").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;

  run(form, async () => {
    if (!confirmation) {
      message("Minta kode SMS terlebih dahulu.");
      return;
    }

    const code = new FormData(form).get("code").trim();
    if (!/^\d{6}$/.test(code)) {
      message("Masukkan enam digit kode.");
      return;
    }

    await confirmation.confirm(code);
    confirmation = undefined;
    form.reset();
    $("confirm-sms").hidden = true;
    message("Berhasil masuk dengan nomor telepon.");
  }, "otp");
});

$("private").addEventListener("click", event => {
  run(event.currentTarget, async () => {
    const user = auth.currentUser;
    if (!user) return;

    // Token berada dalam memori; tidak ditampilkan atau dicatat.
    const token = await user.getIdToken();
    const response = await fetch("/api/private", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok) {
      message(data.error || "API tidak dapat diakses.");
      return;
    }

    $("result").textContent = JSON.stringify(data, null, 2);
    message("API menerima identitas terverifikasi Anda.");
  }, "api");
});

$("logout").addEventListener("click", event => {
  run(event.currentTarget, async () => {
    await signOut(auth);
    confirmation = undefined;
    resetCaptcha();
    $("confirm-sms").hidden = true;
    message("Anda sudah keluar.");
  }, "logout");
});

async function initialize() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) throw new Error("Config unavailable");

    const config = await response.json();
    auth = getAuth(initializeApp(config));
    auth.languageCode = "id";

    await setPersistence(auth, browserSessionPersistence);

    onAuthStateChanged(auth, user => {
      renderAccount(user);
    });

    message("Silakan masuk atau buat akun.");
  } catch {
    message("Aplikasi belum siap. Periksa konfigurasi Firebase dan koneksi internet.");
  }
}

initialize();