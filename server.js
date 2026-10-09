import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import {
  initializeApp,
  applicationDefault,
  cert
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { fileURLToPath } from "node:url";
import {
  requireAuth,
  requireVerifiedIdentity
} from "./auth.js";

const config = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  appId: process.env.FIREBASE_APP_ID
};

if (Object.values(config).some(value => !value)) {
  throw new Error("Lengkapi konfigurasi publik Firebase di .env.");
}

if (!/^[a-zA-Z0-9.-]+$/.test(config.authDomain)) {
  throw new Error("FIREBASE_AUTH_DOMAIN harus berupa hostname.");
}

const hasEmail = Boolean(process.env.FIREBASE_CLIENT_EMAIL);
const hasKey = Boolean(process.env.FIREBASE_PRIVATE_KEY);

if (hasEmail !== hasKey) {
  throw new Error("Isi FIREBASE_CLIENT_EMAIL dan FIREBASE_PRIVATE_KEY bersama.");
}

const credential = hasEmail
  ? cert({
      projectId: config.projectId,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    })
  : applicationDefault();

initializeApp({
  credential,
  projectId: config.projectId
});

const app = express();
app.disable("x-powered-by");

const proxyCount = Number(process.env.TRUST_PROXY || 0);
if (!Number.isInteger(proxyCount) || proxyCount < 0) {
  throw new Error("TRUST_PROXY harus bilangan bulat nonnegatif.");
}
app.set("trust proxy", proxyCount);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://www.gstatic.com",
        "https://www.google.com",
        "https://www.recaptcha.net"
      ],
      frameSrc: [
        "https://www.google.com",
        "https://www.recaptcha.net",
        `https://${config.authDomain}`
      ],
      connectSrc: [
        "'self'",
        "https://*.googleapis.com",
        "https://www.google.com",
        "https://www.gstatic.com",
        "https://www.recaptcha.net",
        `https://${config.authDomain}`
      ],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https://www.gstatic.com"],
      upgradeInsecureRequests:
        process.env.NODE_ENV === "production" ? [] : null
    }
  }
}));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

// Hanya empat properti publik; tidak pernah mengirim process.env.
app.get("/api/config", (_req, res) => {
  res.set("Cache-Control", "no-store").json(config);
});

app.use("/api", rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Terlalu banyak permintaan. Coba lagi nanti." }
}));

app.get(
  "/api/private",
  requireAuth((token, checkRevoked) =>
    getAuth().verifyIdToken(token, checkRevoked)
  ),
  requireVerifiedIdentity,
  (req, res) => {
    res.set("Cache-Control", "no-store").json({
      message: "API terlindungi berhasil diakses.",
      uid: req.user.uid
    });
  }
);

app.use(express.static(
  fileURLToPath(new URL("./public/", import.meta.url))
));

app.use((_req, res) => {
  res.status(404).json({ error: "Tidak ditemukan." });
});

app.use((_error, _req, res, _next) => {
  res.status(500).json({ error: "Terjadi kesalahan server." });
});

const port = Number(process.env.PORT || 3000);

app.listen(port, "0.0.0.0", () => {
  console.log(`Application running in: http://localhost:${port}`);
});