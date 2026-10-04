import {
  FilesetResolver,
  PoseLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs";

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const cameraSelect = document.getElementById("camera");
const startButton = document.getElementById("start-button");
const stopButton = document.getElementById("stop-button");
const formStatus = document.getElementById("form-status");
const feedback = document.getElementById("feedback");
const rating = document.getElementById("rating");

const ctx = canvas.getContext("2d", { alpha: true });

let stream = null;
let poseLandmarker = null;
let animationFrame = null;
let lastAnalysisTime = 0;
let previousPose = null;
let lastMessage = "";
let lastScore = 0;

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";

const MIN_VISIBILITY = 0.55;
const ANALYSIS_INTERVAL = 90;

function setStatus(message, active = false) {
  formStatus.textContent = message;
  formStatus.classList.toggle("active", active);
}

function setFeedback(message, score = lastScore) {
  if (message !== lastMessage) {
    feedback.textContent = message;
    lastMessage = message;
  }

  const roundedScore = Math.max(0, Math.min(100, Math.round(score)));

  if (roundedScore !== lastScore) {
    rating.textContent = roundedScore;
    lastScore = roundedScore;
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function angleFromVertical(top, bottom) {
  const dx = top.x - bottom.x;
  const dy = top.y - bottom.y;
  return Math.abs(Math.atan2(dx, -dy) * (180 / Math.PI));
}

function averageVisibility(landmarks, indices) {
  let total = 0;

  for (const index of indices) {
    total += landmarks[index].visibility ?? 1;
  }

  return total / indices.length;
}

function getPoseFeedback(landmarks) {
  const important = [
    0,   // nose
    11, 12, // shoulders
    23, 24, // hips
    25, 26, // knees
    27, 28  // ankles
  ];

  const visibility = averageVisibility(landmarks, important);

  if (visibility < MIN_VISIBILITY) {
    return {
      score: 30,
      message: "Move back a little so your full body stays in frame."
    };
  }

  const shoulderCenter = midpoint(landmarks[11], landmarks[12]);
  const hipCenter = midpoint(landmarks[23], landmarks[24]);

  const horizontalCenter = Math.abs(hipCenter.x - 0.5);
  const torsoTilt = angleFromVertical(shoulderCenter, hipCenter);

  const shoulderTilt = Math.abs(
    Math.atan2(
      landmarks[12].y - landmarks[11].y,
      landmarks[12].x - landmarks[11].x
    ) * (180 / Math.PI)
  );

  const movement =
    previousPose === null
      ? 0
      : distance(hipCenter, previousPose);

  previousPose = hipCenter;

  let score = 100;
  const messages = [];

  if (horizontalCenter > 0.20) {
    score -= 20;
    messages.push("Move closer to the centre of the frame.");
  }

  if (torsoTilt > 24) {
    score -= 25;
    messages.push("Try to keep your torso more upright.");
  } else if (torsoTilt > 16) {
    score -= 10;
    messages.push("Keep your torso a little more upright.");
  }

  if (shoulderTilt > 13) {
    score -= 12;
    messages.push("Keep your shoulders level.");
  }

  if (movement > 0.065) {
    score -= 8;
    messages.push("Slow the movement down and stay controlled.");
  }

  if (messages.length === 0) {
    if (movement < 0.006) {
      messages.push("Good starting position. Begin your next rep.");
    } else {
      messages.push("Looking good. Keep the movement controlled.");
    }
  }

  return {
    score: Math.max(0, score),
    message: messages[0]
  };
}

function drawPose(landmarks) {
  if (!ctx) {
    return;
  }

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const connections = [
    [11, 12],
    [11, 23],
    [12, 24],
    [23, 24],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
    [23, 25],
    [25, 27],
    [24, 26],
    [26, 28]
  ];

  ctx.lineWidth = Math.max(2, canvas.width / 420);
  ctx.strokeStyle = "rgba(67, 139, 234, 0.9)";
  ctx.fillStyle = "rgba(85, 152, 241, 0.95)";

  for (const [aIndex, bIndex] of connections) {
    const a = landmarks[aIndex];
    const b = landmarks[bIndex];

    if (
      (a.visibility ?? 1) < MIN_VISIBILITY ||
      (b.visibility ?? 1) < MIN_VISIBILITY
    ) {
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
    ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
    ctx.stroke();
  }

  for (const landmark of landmarks) {
    if ((landmark.visibility ?? 1) < MIN_VISIBILITY) {
      continue;
    }

    ctx.beginPath();
    ctx.arc(
      landmark.x * canvas.width,
      landmark.y * canvas.height,
      Math.max(3, canvas.width / 260),
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
}

async function initializePoseLandmarker() {
  if (poseLandmarker) {
    return;
  }

  setStatus("Loading pose tracking...");

  const vision = await FilesetResolver.forVisionTasks(WASM_URL);

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.55,
    minPosePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55
  });
}

async function populateCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");

  cameraSelect.innerHTML = "";

  cameras.forEach((camera, index) => {
    const option = document.createElement("option");
    option.value = camera.deviceId;
    option.textContent = camera.label || `Camera ${index + 1}`;
    cameraSelect.appendChild(option);
  });

  if (cameras.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No camera found";
    cameraSelect.appendChild(option);
  }
}

async function startCamera() {
  try {
    startButton.disabled = true;

    await initializePoseLandmarker();

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    const selectedCamera = cameraSelect.value;

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: selectedCamera ? { exact: selectedCamera } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      },
      audio: false
    });

    video.srcObject = stream;

    await video.play();

    await populateCameras();

    setStatus("Camera live. Tracking body position.", true);
    setFeedback("Stand where your whole body is visible, then start your movement.", 72);

    previousPose = null;
    lastAnalysisTime = 0;

    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(analyzeFrame);
  } catch (error) {
    console.error(error);

    setStatus("Could not start the camera.");
    setFeedback(
      "Camera access was blocked or unavailable. Check your browser permissions.",
      0
    );
  } finally {
    startButton.disabled = false;
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  video.srcObject = null;
  cancelAnimationFrame(animationFrame);

  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  previousPose = null;
  setStatus("Camera not started");
  setFeedback("Start the camera to receive live form feedback.", 0);
}

function analyzeFrame(timestamp) {
  animationFrame = requestAnimationFrame(analyzeFrame);

  if (
    !poseLandmarker ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    timestamp - lastAnalysisTime < ANALYSIS_INTERVAL
  ) {
    return;
  }

  lastAnalysisTime = timestamp;

  try {
    const result = poseLandmarker.detectForVideo(video, timestamp);
    const landmarks = result.landmarks?.[0];

    if (!landmarks) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setFeedback("I can't see your full body yet. Step back or adjust the camera.", 35);
      return;
    }

    drawPose(landmarks);

    const { score, message } = getPoseFeedback(landmarks);
    setFeedback(message, score);
  } catch (error) {
    console.error("Pose analysis error:", error);
  }
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);

cameraSelect.addEventListener("change", async () => {
  if (stream) {
    await startCamera();
  }
});

navigator.mediaDevices?.addEventListener?.("devicechange", populateCameras);

setStatus("Camera not started");
setFeedback("Start the camera to receive live form feedback.", 0);

populateCameras().catch((error) => {
  console.error("Could not list cameras:", error);
  setStatus("Camera list unavailable");
});