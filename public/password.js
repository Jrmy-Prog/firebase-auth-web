export function passwordCheck(password) {
  const checks = {
    length: password.length >= 12 && password.length <= 128,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password)
  };

  const valid = Object.values(checks).every(Boolean);

  if (!password) {
    return {
      valid: false,
      score: 0,
      level: "",
      label: "Enter a password"
    };
  }

  const variety = [
    checks.lowercase,
    checks.uppercase,
    checks.number,
    checks.symbol
  ].filter(Boolean).length;

  let score;

  if (password.length < 8) {
    score = 1;
  } else if (password.length < 12) {
    score = 2;
  } else if (variety < 3) {
    score = 3;
  } else if (password.length < 12 || variety < 4) {
    score = 4;
  } else {
    score = 5;
  }

  const level = score <= 2
    ? "weak"
    : score <= 4
      ? "medium"
      : "strong";

  const labels = {
    weak: "Password strength: Weak",
    medium: "Password strength: Medium",
    strong: "Password strength: Strong"
  };

  return {
    valid,
    score,
    level,
    label: labels[level] +
      (valid ? "" : " — Password requirements are not met.")
  };
}