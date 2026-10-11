import express from "express";
import nodemailer from "nodemailer";
import rateLimit from "express-rate-limit";
import {
  randomInt,
  randomBytes,
  createHmac,
  timingSafeEqual
} from "node:crypto";
import { getAuth } from "firebase-admin/auth";

export function createEmailPasscodeRouter() {
  const router = express.Router();
  const challenges = new Map();
  const hashKey = randomBytes(32);

  const cooldown = 5 * 60 * 1000;
  const lifetime = 5 * 60 * 1000;

  const mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: "Too many requests. Please try again later."
    }
  }));

  function normalizeEmail(value) {
    if (typeof value !== "string") return null;

    const email = value.trim().toLowerCase();

    return email.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? email
      : null;
  }

  function hashCode(email, code) {
    return createHmac("sha256", hashKey)
      .update(`${email}:${code}`)
      .digest();
  }

  // Remove expired records without a background timer.
  function cleanup() {
    const now = Date.now();

    for (const [email, record] of challenges) {
      if (now >= Math.max(record.expiresAt, record.nextSendAt)) {
        challenges.delete(email);
      }
    }
  }

  router.post("/request", async (req, res) => {
    cleanup();

    const email = normalizeEmail(req.body?.email);

    if (!email) {
      return res.status(400).json({
        message: "Enter a valid email address."
      });
    }

    // Same response for registered and unregistered addresses.
    const reply = {
      message:
        "If this email can sign in, a passcode will be sent. Check your inbox and spam folder.",
      retryAfterSeconds: 300
    };

    const previous = challenges.get(email);

    if (previous && Date.now() < previous.nextSendAt) {
      return res.json(reply);
    }

    // Bound memory use in this local demonstration.
    if (challenges.size >= 10000) {
      return res.status(503).json({
        message: "Please try again later."
      });
    }

    const code = String(randomInt(0, 1000000)).padStart(6, "0");

    const record = {
      hash: hashCode(email, code),
      attempts: 0,
      expiresAt: Date.now() + lifetime,
      nextSendAt: Date.now() + cooldown,
      uid: null
    };

    // Set before awaiting to prevent concurrent resend requests.
    challenges.set(email, record);

    try {
      const user = await getAuth().getUserByEmail(email);

      if (!user.disabled) {
        record.uid = user.uid;

        await mailer.sendMail({
          from: process.env.SMTP_FROM,
          to: email,
          subject: "Your Ruang Akun sign-in passcode",
          text:
            `Your sign-in passcode is: ${code}\n\n` +
            "This code expires in 5 minutes.\n" +
            "Do not share this code with anyone.\n" +
            "If you did not request it, ignore this email."
        });
      }
      } catch (error) {
    if (error.code !== "auth/user-not-found") {
    record.uid = null;

    console.error("PASSCODE_ERROR_V3", {
      code: error.code,
      message: error.message
    });
  }
}
   

    return res.json(reply);
  });

  router.post("/verify", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = req.body?.code;

    const invalid = () => res.status(400).json({
      message: "Invalid or expired passcode. Request a new code."
    });

    if (!email || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return invalid();
    }

    const record = challenges.get(email);

    if (
      !record ||
      Date.now() >= record.expiresAt ||
      record.attempts >= 5
    ) {
      return invalid();
    }

    record.attempts += 1;

    const matches = timingSafeEqual(
      record.hash,
      hashCode(email, code)
    );

    if (!matches || !record.uid) {
      return invalid();
    }

    // Consume before awaiting so the code cannot be used twice.
    const uid = record.uid;
    record.uid = null;
    record.attempts = 5;

    try {
      const user = await getAuth().getUser(uid);

      if (user.disabled || user.email?.toLowerCase() !== email) {
        return invalid();
      }

      // Successful passcode proves access to this email inbox.
      if (!user.emailVerified) {
        await getAuth().updateUser(uid, {
          emailVerified: true
        });
      }

      const token = await getAuth().createCustomToken(uid);

      return res.json({ token });


    } catch (error) {
  console.error("PASSCODE_VERIFY_ERROR", {
    code: error.code,
    message: error.message
  });

  return res.status(503).json({
    message: "Unable to sign in. Please request a new code."
  });
  }
});
  return router;
}