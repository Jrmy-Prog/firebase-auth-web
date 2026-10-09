const video = document.getElementById("camera-video");
const photo = document.getElementById("camera-photo");
const canvas = document.getElementById("camera-canvas");
const placeholder = document.getElementById("camera-placeholder");

const startButton = document.getElementById("camera-start");
const captureButton = document.getElementById("camera-capture");
const stopButton = document.getElementById("camera-stop");
const downloadLink = document.getElementById("camera-download");
const status = document.getElementById("camera-message");

let stream = null;
let photoUrl = null;
let starting = false;
let generation = 0;

function clearPhoto() {
  if (photoUrl) {
    URL.revokeObjectURL(photoUrl);
    photoUrl = null;
  }

  photo.removeAttribute("src");
  photo.hidden = true;

  downloadLink.removeAttribute("href");
  downloadLink.hidden = true;

  canvas.width = 0;
  canvas.height = 0;
}

function stopCamera() {
  generation += 1;

  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  video.pause();
  video.srcObject = null;
  video.hidden = true;

  captureButton.disabled = true;
  stopButton.disabled = true;
  startButton.disabled = starting;

  placeholder.hidden = !photo.hidden;
}

function resetCamera() {
  stopCamera();
  clearPhoto();

  placeholder.hidden = false;
  status.textContent = "Kamera belum aktif.";
}

// Dipanggil saat pengguna keluar dari akun.
window.addEventListener("account-signed-out", resetCamera);

startButton.addEventListener("click", async () => {
  if (starting) return;

  if (!window.isSecureContext) {
    status.textContent =
      "Kamera membutuhkan HTTPS atau localhost.";
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent =
      "Browser ini tidak mendukung akses kamera.";
    return;
  }

  stopCamera();
  clearPhoto();

  starting = true;
  startButton.disabled = true;
  status.textContent = "Meminta izin kamera…";

  const currentGeneration = generation;

  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    // Abaikan hasil jika pengguna sudah keluar atau meninggalkan halaman.
    if (currentGeneration !== generation) {
      newStream.getTracks().forEach(track => track.stop());
      return;
    }

    stream = newStream;
    video.srcObject = stream;
    video.hidden = false;
    placeholder.hidden = true;

    await video.play();

    if (currentGeneration !== generation) return;

    captureButton.disabled = false;
    stopButton.disabled = false;

    status.textContent =
      "Kamera aktif. Klik “Ambil foto” saat Anda siap.";
  } catch (error) {
    if (currentGeneration !== generation) return;

    stopCamera();

    if (error.name === "NotAllowedError") {
      status.textContent =
        "Izin kamera ditolak. Izinkan kamera melalui pengaturan situs.";
    } else if (error.name === "NotFoundError") {
      status.textContent = "Kamera tidak ditemukan.";
    } else if (error.name === "NotReadableError") {
      status.textContent =
        "Kamera tidak dapat dibuka. Tutup aplikasi lain yang memakai kamera.";
    } else {
      status.textContent =
        "Kamera gagal dibuka. Periksa izin dan perangkat Anda.";
    }
  } finally {
    starting = false;
    startButton.disabled = false;
  }
});

captureButton.addEventListener("click", () => {
  if (!stream || !video.videoWidth || !video.videoHeight) {
    status.textContent =
      "Kamera belum siap. Tunggu sebentar lalu coba lagi.";
    return;
  }

  const context = canvas.getContext("2d");

  if (!context) {
    status.textContent = "Browser tidak dapat memproses foto.";
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  context.drawImage(
    video,
    0,
    0,
    canvas.width,
    canvas.height
  );

  captureButton.disabled = true;
  const currentGeneration = generation;

  canvas.toBlob(blob => {
    if (currentGeneration !== generation) return;

    if (!blob) {
      captureButton.disabled = false;
      status.textContent = "Foto gagal dibuat. Coba lagi.";
      return;
    }

    if (photoUrl) URL.revokeObjectURL(photoUrl);

    photoUrl = URL.createObjectURL(blob);

    photo.src = photoUrl;
    photo.hidden = false;

    downloadLink.href = photoUrl;
    downloadLink.download = "foto-ruang-akun.jpg";
    downloadLink.hidden = false;

    stopCamera();

    status.textContent =
      "Foto berhasil diambil. Kamera dimatikan. Anda dapat mengunduh foto.";
  }, "image/jpeg", 0.9);
});

stopButton.addEventListener("click", () => {
  stopCamera();
  status.textContent = "Kamera sudah dimatikan.";
});

// Kamera dimatikan ketika tab disembunyikan.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (stream || starting)) {
    stopCamera();
    status.textContent =
      "Kamera dimatikan karena halaman tidak aktif.";
  }
});

window.addEventListener("pagehide", resetCamera);