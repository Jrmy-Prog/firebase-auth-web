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
  sendPasswordResetEmail,
  signOut,
  reload,
  validatePassword,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

const $ = id => document.getElementById(id);

let auth;
let verifier;
let confirmation;

let emailReadyAt = 0;
let smsReadyAt = 0;
let resetReadyAt = 0;

function message(text) {
  $("message").textContent = text;
}

function showPanel(selected) {
  for (const id of [
    "signin",
    "signup",
    "phone",
    "reset-password"
  ]) {
    $(id).hidden = id !== selected;
  }
}

function passwordCheck(value) {
  const checks = [
    value.length >= 12,
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /[0-9]/.test(value),
    /[^A-Za-z0-9]/.test(value)
  ];

  return {
    valid: checks.every(Boolean) && value.length <= 128,
    score: checks.filter(Boolean).length
  };
}

function safeError(error, context) {
  if (error.code === "auth/network-request-failed") {
    return "Connection failed. Check your internet connection.";
  }

  if (error.code === "auth/too-many-requests") {
    return "Too many attempts. Try again later.";
  }

  if (context === "signin") {
    return "Incorrect email or password.";
  }

  if (context === "signup") {
    return "Registration was unsuccessful. Try log in using a different email.";
  }

  if (context === "sms") {
    return "The SMS could not be sent. Check the number and reCAPTCHA.";
  }

  if (context === "otp") {
    return "The code is expired. Try again or request a new code.";
  }

  return "The request was unsuccessful. Please try again later.";
}

async function run(element, operation, context) {
  const buttons = element.matches("button")
    ? [element]
    : [...element.querySelectorAll("button")];

  buttons.forEach(button => {
    button.disabled = true;
  });

  try {
    await operation();
  } catch (error) {
    message(safeError(error, context));
  } finally {
    buttons.forEach(button => {
      button.disabled = false;
    });
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
  $("welcome").hidden = Boolean(user);
  $("result").textContent = "";

  document.querySelector("main").classList.toggle(
    "dashboard-mode",
    Boolean(user)
  );

  if (!user) {
    window.dispatchEvent (new Event("account-signed-out"));
    $("dashboard").hidden = true;
    $("verification-panel").hidden = true;
    showPanel("signin");
    return;
  }

  const phoneLogin =
    !user.email &&
    user.providerData.some(
      provider => provider.providerId === "phone"
    );

  const verified = user.emailVerified || phoneLogin;
  const contact = user.email || user.phoneNumber || "Pengguna";

  $("identity").textContent = contact;
  $("profile-contact").textContent = contact;

  $("verified").textContent = verified
    ? "✓ Terverifikasi"
    : "Waiting for email verification...";

  $("verification-description").textContent = phoneLogin
    ? "Anda masuk menggunakan nomor telepon."
    : "Alamat email Anda sudah diverifikasi.";

  $("verification-panel").hidden = verified;
  $("dashboard").hidden = !verified;

  $("resend").hidden = !user.email || user.emailVerified;
  $("refresh").hidden = !user.email || user.emailVerified;
}

let resendTimer;

function startResendCountdown() {
  clearInterval(resendTimer);

  const button = document.getElementById("resend");

  function update() {
    const remaining = Math.max(
      0,
      Math.ceil((emailReadyAt - Date.now()) / 1000)
    );

    if (remaining > 0) {
      button.disabled = true;
      button.textContent =
        "Resend in " + remaining + " seconds";
    } else {
      button.disabled = false;
      button.textContent = "";
      clearInterval(resendTimer);
    }
  }

  update();

  if (emailReadyAt > Date.now()) {
    resendTimer = setInterval(update, 1000);
  }
}

function bindEvents() {
  document.querySelectorAll("[data-panel]").forEach(button => {
    button.addEventListener("click", () => {
      showPanel(button.dataset.panel);
      message("Please fill out the form.");
    });
  });

  $("new-password").addEventListener("input", event => {
    const value = event.target.value;
    const result = passwordCheck(value);

    $("password-meter").value = result.score;

    $("password-strength").textContent = !value
      ? "Please fill the password"
      : result.valid
        ? ""
        : "The password does not yet meet all the requirements.";
  });

  // MASUK → DASHBOARD ATAU PANEL VERIFIKASI
  $("signin").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;

    run(form, async () => {
      const data = new FormData(form);

      const { user } = await signInWithEmailAndPassword(
        auth,
        data.get("email").trim(),
        data.get("password")
      );

      renderAccount(user);
      form.reset();

      message(user.emailVerified
        ? "Welcome to the Ruang Akun."
        : "Verify your email to access the dashboard.");
    }, "signin");
  });

  // DAFTAR
  $("signup").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;

    run(form, async () => {
      const data = new FormData(form);
      const password = data.get("password");

      if (!passwordCheck(password).valid) {
        message("The password does not meet the requirements.");
        return;
      }

      if (password !== data.get("confirm")) {
        message("Password confirmation does not match.");
        return;
      }

      const policy = await validatePassword(auth, password);

      if (!policy.isValid) {
        message("The password does not meet the Firebase policy.");
        return;
      }

      const { user } = await createUserWithEmailAndPassword(
        auth,
        data.get("email").trim(),
        password
      );

      form.reset();
      $("password-meter").value = 0;
      $("password-strength").textContent = "Not yet filled in";

      renderAccount(user);

      try {
        await sendEmailVerification(user);
        emailReadyAt = Date.now() + 60000;

        message(
          "Account created. Open the verification email, then click. " +
          "“I have verified”."
        );
      } catch {
        message(
          "The account was created, but the email has not been sent. " +
          "Use the button to send the verification email."
        );
      }
    }, "signup");
  });

  // KIRIM ULANG EMAIL VERIFIKASI
  $("resend").addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;

  const button = $("resend");

  if (Date.now() < emailReadyAt) {
    startResendCountdown();
    return;
  }

  button.disabled = true;
  button.textContent = "Sending...";

  try {
    await sendEmailVerification(user);

    // Mulai masa tunggu setelah pengiriman berhasil.
    emailReadyAt = Date.now() + 60000;

    message("A verification email has been sent. Please also check your spam folder.");
  } catch (error) {
    console.error("Failed to send verification code. Please try again.:", error.code);
    message(safeError(error, "verification"));
  } finally {
    // Fungsi ini mengatur teks sekaligus status tombol.
    startResendCountdown();
  }
});

  // PERIKSA VERIFIKASI → BUKA DASHBOARD
  $("refresh").addEventListener("click", event => {
    run(event.currentTarget, async () => {
      const user = auth.currentUser;
      if (!user) return;

      await reload(user);
      await user.getIdToken(true);

      renderAccount(user);

      message(user.emailVerified
        ? "Email verified. Welcome to the dashboard!"
        : "Email not yet verified. Open the link in your email.");
    }, "verification");
  });

  // BUKA FORM RESET PASSWORD
  $("forgot-password").addEventListener("click", () => {
    showPanel("reset-password");
    message("Enter your email to reset your password.");
  });

  $("back-to-signin").addEventListener("click", () => {
    showPanel("signin");
    message("Please come in");
  });

  // KIRIM EMAIL RESET PASSWORD
  $("reset-password").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;

    run(form, async () => {
      if (Date.now() < resetReadyAt) {
        message("Tunggu 60 detik sebelum meminta tautan lagi.");
        return;
      }

      const email = new FormData(form).get("email").trim();

      try {
        await sendPasswordResetEmail(auth, email);
      } catch (error) {
        // Respons sama untuk email yang tidak terdaftar.
        if (error.code !== "auth/user-not-found") {
          throw error;
        }
      }

      resetReadyAt = Date.now() + 60000;
      form.reset();

      message(
        "If the email is registered, a password reset link..." +
        "It will be sent. Please also check your spam folder."
      );
    }, "reset");
  });

  // KIRIM SMS
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

      if (
        !/^\+[1-9]\d{7,14}$/.test(phone) ||
        !data.get("consent")
      ) {
        message("Periksa nomor internasional dan persetujuan SMS.");
        return;
      }

      confirmation = undefined;
      $("confirm-sms").hidden = true;
      resetCaptcha();

      verifier = new RecaptchaVerifier(auth, "recaptcha", {
        size: "normal"
      });

      try {
        await verifier.render();

        confirmation = await signInWithPhoneNumber(
          auth,
          phone,
          verifier
        );

        smsReadyAt = Date.now() + 60000;
        $("confirm-sms").hidden = false;
        message("SMS code sent. Enter the six-digit code.");
      } finally {
        resetCaptcha();
      }
    }, "sms");
  });

  // VERIFIKASI SMS
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

      const { user } = await confirmation.confirm(code);

      confirmation = undefined;
      form.reset();
      $("confirm-sms").hidden = true;

      renderAccount(user);
      message("Selamat datang di Ruang Akun.");
    }, "otp");
  });

  // AKSES API BACKEND
  $("private").addEventListener("click", event => {
    run(event.currentTarget, async () => {
      const user = auth.currentUser;
      if (!user) return;

      const token = await user.getIdToken();

      const response = await fetch("/api/private", {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });

      const data = await response.json();

      if (!response.ok) {
        message(data.error || "Akses ditolak.");
        return;
      }

      $("result").textContent = JSON.stringify(data, null, 2);
      message("Server menerima sesi Anda.");
    }, "api");
  });

  // KELUAR → KEMBALI KE FORM MASUK
  $("logout").addEventListener("click", event => {
    run(event.currentTarget, async () => {
      await signOut(auth);

      confirmation = undefined;
      resetCaptcha();

      $("confirm-sms").hidden = true;

      for (const id of [
        "signin",
        "signup",
        "reset-password",
        "send-sms",
        "confirm-sms"
      ]) {
        $(id).reset();
      }

      $("password-meter").value = 0;
      $("password-strength").textContent = "Please fill the password";

      renderAccount(null);
      message("You have logged out.");
    }, "logout");
  });
}

async function initialize() {
  try {
    const response = await fetch("/api/config", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Configuration is not available.");
    }

    const config = await response.json();

    auth = getAuth(initializeApp(config));
    auth.languageCode = "en";

    await setPersistence(auth, browserSessionPersistence);

    function startResendCountdown() {
    clearInterval(resendTimer);

  const button = document.getElementById("resend");

  function updateCountdown() {
    const remaining = Math.max(
      0,
      Math.ceil((emailReadyAt - Date.now()) / 1000)
    );

    button.disabled = remaining > 0;

    button.textContent = remaining > 0
      ? "Resend in " + remaining + " Seconds"
      : "Send verification email again";

    if (remaining === 0) {
      clearInterval(resendTimer);
    }
  }

  updateCountdown();

  if (emailReadyAt > Date.now()) {
    resendTimer = setInterval(updateCountdown, 1000);
  }
}

async function initialize() {

}

initialize();

  bindEvents();

    onAuthStateChanged(auth, user => {
      renderAccount(user);

      if (!user) {
        message("Please log in or create an account.");
      } else if (user.email && !user.emailVerified) {
        message("Verify your email to access the dashboard.");
      } else {
        message("Verify your email to access the dashboard.");
      }
    }, () => {
      message("Sesi tidak dapat dimuat. Muat ulang halaman.");
    });
  } catch (error) {
    console.error("Aplikasi gagal dimuat:", error);

    message(
      "Aplikasi belum siap. Periksa konfigurasi Firebase " +
      "atau error pada Console browser."
    );
  }
}

initialize();