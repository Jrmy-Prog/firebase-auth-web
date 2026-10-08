export function requireAuth(verifyToken) {
  return async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(
      req.headers.authorization || ""
    );

    if (!match) {
      return res.status(401).json({
        error: "Autentikasi diperlukan."
      });
    }

    try {
      // true: periksa pencabutan token dan status pengguna.
      req.user = await verifyToken(match[1], true);
    } catch {
      return res.status(401).json({
        error: "Sesi tidak valid atau kedaluwarsa. Masuk kembali."
      });
    }

    next();
  };
}

export function requireVerifiedIdentity(req, res, next) {
  const user = req.user;

  const verifiedEmail = user.email_verified === true;
  const verifiedPhone =
    user.firebase?.sign_in_provider === "phone" &&
    Boolean(user.phone_number);

  if (!verifiedEmail && !verifiedPhone) {
    return res.status(403).json({
      error: "Verifikasi email terlebih dahulu."
    });
  }

  next();
}