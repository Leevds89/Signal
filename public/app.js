const socket = io();

const state = {
  activeParticipants: 0,
  peakParticipants: 0,
  totalJoins: 0,
  lastJoinAt: null,
  totalSubmissions: 0,
  lastSubmissionAt: null,
  intensity: 0,
};

const ui = {
  activeCount: document.getElementById("activeCount"),
  peakCount: document.getElementById("peakCount"),
  joinCount: document.getElementById("joinCount"),
  submissionCount: document.getElementById("submissionCount"),
  intensityValue: document.getElementById("intensityValue"),
  meterFill: document.getElementById("meterFill"),
  statusText: document.getElementById("statusText"),
  lastPulse: document.getElementById("lastPulse"),
  lastSubmissionAt: document.getElementById("lastSubmissionAt"),
  selfState: document.getElementById("selfState"),
  heroJoinButton: document.getElementById("heroJoinButton"),
  soundButton: document.getElementById("soundButton"),
  connectionText: document.getElementById("connectionText"),
  connectionDot: document.getElementById("connectionDot"),
  leadForm: document.getElementById("leadForm"),
  formMessage: document.getElementById("formMessage"),
  submitButton: document.getElementById("submitButton"),
};

const canvas = document.getElementById("signalCanvas");
const ctx = canvas.getContext("2d");

let localJoined = false;
let soundEnabled = false;
let pulseEnergy = 0;
let audioContext;
let droneOscillator;
let droneFilter;
let masterGain;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getIntensity(activeParticipants) {
  return clamp(activeParticipants / 24, 0, 1);
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function describeStatus() {
  if (!state.activeParticipants) {
    return "The room is quiet. Start the signal and invite another screen in.";
  }

  if (state.activeParticipants === 1) {
    return localJoined
      ? "You are carrying the field right now."
      : "One participant is holding the field steady.";
  }

  const base = `${state.activeParticipants} active listeners are shaping the field right now.`;
  return localJoined ? `${base} You are part of the pressure.` : base;
}

function syncUi() {
  state.intensity = getIntensity(state.activeParticipants);

  ui.activeCount.textContent = String(state.activeParticipants);
  ui.peakCount.textContent = String(state.peakParticipants);
  ui.joinCount.textContent = String(state.totalJoins);
  ui.submissionCount.textContent = String(state.totalSubmissions);
  ui.intensityValue.textContent = `${Math.round(state.intensity * 100)}%`;
  ui.meterFill.style.width = `${state.intensity * 100}%`;
  ui.statusText.textContent = describeStatus();
  ui.lastPulse.textContent = state.lastJoinAt
    ? formatTime(state.lastJoinAt)
    : "No joins yet";
  ui.lastSubmissionAt.textContent = state.lastSubmissionAt
    ? formatTime(state.lastSubmissionAt)
    : "No submissions yet";
  ui.selfState.textContent = localJoined ? "Transmitting" : "Observing";
  ui.heroJoinButton.disabled = localJoined;
  ui.heroJoinButton.textContent = localJoined
    ? "Inside the Signal"
    : "Join the Signal";

  updateAudioFromState();
}

async function ensureAudio() {
  if (!window.AudioContext && !window.webkitAudioContext) {
    throw new Error("This browser does not support Web Audio.");
  }

  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();

    droneOscillator = audioContext.createOscillator();
    droneOscillator.type = "sawtooth";
    droneOscillator.frequency.value = 55;

    droneFilter = audioContext.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 140;
    droneFilter.Q.value = 3;

    masterGain = audioContext.createGain();
    masterGain.gain.value = 0;

    droneOscillator.connect(droneFilter);
    droneFilter.connect(masterGain);
    masterGain.connect(audioContext.destination);
    droneOscillator.start();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}

function setSoundButtonLabel() {
  ui.soundButton.textContent = soundEnabled ? "Mute Sound" : "Enable Sound";
}

function updateAudioFromState() {
  if (!soundEnabled || !audioContext || !masterGain || !droneFilter) {
    return;
  }

  const now = audioContext.currentTime;
  const targetGain = 0.02 + state.intensity * 0.09;
  const targetFilter = 140 + state.intensity * 1600;
  const targetPitch = 55 + state.intensity * 35;

  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.linearRampToValueAtTime(targetGain, now + 0.22);
  droneFilter.frequency.cancelScheduledValues(now);
  droneFilter.frequency.linearRampToValueAtTime(targetFilter, now + 0.22);
  droneOscillator.frequency.cancelScheduledValues(now);
  droneOscillator.frequency.linearRampToValueAtTime(targetPitch, now + 0.22);
}

async function toggleSound() {
  if (!soundEnabled) {
    try {
      await ensureAudio();
      soundEnabled = true;
      updateAudioFromState();
    } catch (error) {
      ui.statusText.textContent = "Sound could not start in this browser.";
      console.error(error);
    }
  } else {
    soundEnabled = false;

    if (audioContext && masterGain) {
      const now = audioContext.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.linearRampToValueAtTime(0, now + 0.18);
    }
  }

  setSoundButtonLabel();
}

function triggerPulseSound() {
  if (!soundEnabled || !audioContext) {
    return;
  }

  const now = audioContext.currentTime;
  const pulse = audioContext.createOscillator();
  const pulseGain = audioContext.createGain();

  pulse.type = "triangle";
  pulse.frequency.setValueAtTime(120 + state.intensity * 210, now);
  pulseGain.gain.setValueAtTime(0.0001, now);
  pulseGain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
  pulseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

  pulse.connect(pulseGain);
  pulseGain.connect(audioContext.destination);
  pulse.start(now);
  pulse.stop(now + 0.3);
}

async function joinSignal() {
  if (localJoined) {
    return;
  }

  localJoined = true;
  syncUi();

  if (!soundEnabled) {
    try {
      await ensureAudio();
      soundEnabled = true;
      setSoundButtonLabel();
    } catch (error) {
      console.error(error);
    }
  }

  updateAudioFromState();
  socket.emit("joinSignal");
}

async function fetchSiteSnapshot() {
  try {
    const response = await fetch("/api/site");
    const snapshot = await response.json();
    Object.assign(state, snapshot);
    syncUi();
  } catch (error) {
    console.error(error);
  }
}

async function handleLeadSubmit(event) {
  event.preventDefault();

  const formData = new FormData(ui.leadForm);
  const payload = {
    name: String(formData.get("name") || ""),
    email: String(formData.get("email") || ""),
    company: String(formData.get("company") || ""),
    projectType: String(formData.get("projectType") || ""),
    timeline: String(formData.get("timeline") || ""),
    budgetRange: String(formData.get("budgetRange") || ""),
    message: String(formData.get("message") || ""),
    wantsDemo: formData.get("wantsDemo") === "on",
  };

  ui.submitButton.disabled = true;
  ui.formMessage.textContent = "Sending your brief...";

  try {
    const response = await fetch("/api/submissions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Could not send the brief.");
    }

    ui.leadForm.reset();
    ui.formMessage.textContent = result.message;

    if (result.snapshot) {
      Object.assign(state, result.snapshot);
      syncUi();
    }
  } catch (error) {
    ui.formMessage.textContent = error.message;
  } finally {
    ui.submitButton.disabled = false;
  }
}

socket.on("connect", () => {
  ui.connectionText.textContent = "Connected";
  ui.connectionDot.classList.add("live");

  if (localJoined) {
    socket.emit("joinSignal");
  }
});

socket.on("disconnect", () => {
  ui.connectionText.textContent = "Reconnecting";
  ui.connectionDot.classList.remove("live");
});

socket.on("state", (nextState) => {
  Object.assign(state, nextState);
  syncUi();
});

socket.on("site", (snapshot) => {
  Object.assign(state, snapshot);
  syncUi();
});

socket.on("pulse", ({ joinedAt }) => {
  state.lastJoinAt = joinedAt;
  ui.lastPulse.textContent = formatTime(joinedAt);
  pulseEnergy = 1;
  triggerPulseSound();
});

ui.heroJoinButton.addEventListener("click", joinSignal);
ui.soundButton.addEventListener("click", toggleSound);
ui.leadForm.addEventListener("submit", handleLeadSubmit);
window.addEventListener("resize", resizeCanvas);

function drawSignal(timestamp) {
  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const time = timestamp * 0.001;
  const baseRadius = Math.min(width, height) * 0.14;
  const activeGlow = 0.18 + state.intensity * 0.42 + pulseEnergy * 0.28;

  ctx.clearRect(0, 0, width, height);

  const halo = ctx.createRadialGradient(
    centerX,
    centerY,
    20,
    centerX,
    centerY,
    baseRadius * 4.5,
  );
  halo.addColorStop(0, `rgba(186, 255, 87, ${activeGlow})`);
  halo.addColorStop(0.45, `rgba(255, 141, 77, ${activeGlow * 0.32})`);
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);

  for (let index = 0; index < 5; index += 1) {
    const ringRadius =
      baseRadius + index * 44 + Math.sin(time * 1.2 - index) * 10 + pulseEnergy * 22;
    ctx.beginPath();
    ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
    ctx.lineWidth = 1 + index * 0.25;
    ctx.strokeStyle = `rgba(244, 234, 217, ${0.08 + state.intensity * 0.1})`;
    ctx.setLineDash([14 + index * 8, 18 + index * 4]);
    ctx.stroke();
  }

  ctx.setLineDash([]);

  ctx.beginPath();
  for (let x = 0; x <= width; x += 8) {
    const wave =
      Math.sin(x * 0.018 + time * 2.2) * (14 + state.intensity * 42) +
      Math.cos(x * 0.007 - time * 1.1) * (8 + pulseEnergy * 18);
    const y = centerY + height * 0.22 + wave;

    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.strokeStyle = `rgba(186, 255, 87, ${0.2 + state.intensity * 0.28})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  const particles = 12 + Math.round(state.intensity * 18);
  for (let index = 0; index < particles; index += 1) {
    const angle = time * (0.25 + index * 0.013) + index;
    const radius = baseRadius * 0.8 + (index % 6) * 36 + pulseEnergy * 10;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle * 1.15) * radius * 0.66;
    const size = 2 + (index % 3) + state.intensity * 2;

    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = index % 2
      ? `rgba(255, 141, 77, ${0.26 + state.intensity * 0.35})`
      : `rgba(186, 255, 87, ${0.26 + state.intensity * 0.4})`;
    ctx.fill();
  }

  pulseEnergy *= 0.96;
  requestAnimationFrame(drawSignal);
}

resizeCanvas();
setSoundButtonLabel();
syncUi();
fetchSiteSnapshot();
requestAnimationFrame(drawSignal);
