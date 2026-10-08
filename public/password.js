export function passwordCheck(value) {
  const checks = [
    value.length >= 12,
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /[0-9]/.test(value),
    /[^A-Za-z0-9]/.test(value)
  ];

  const valid = checks.every(Boolean) && value.length <= 128;
  const score = checks.filter(Boolean).length;

  return {
    valid,
    score,
    label: !value
      ? "Belum diisi"
      : valid
        ? "Memenuhi aturan"
        : score < 3
          ? "Lemah"
          : "Perlu ditingkatkan"
  };
}