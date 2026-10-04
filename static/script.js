// ======================================================
// HTML ELEMENTS
// ======================================================

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { alpha: true });

const cameraSelect = document.getElementById("camera");
const startButton = document.getElementById("start-button");
const stopButton = document.getElementById("stop-button");

const formStatus = document.getElementById("form-status");
const repCountDisplay = document.getElementById("rep-count");
const ratingDisplay = document.getElementById("rating");

video.muted = true;
video.autoplay = true;
video.playsInline = true;
video.setAttribute("playsinline", "");
video.setAttribute("webkit-playsinline", "");

// ======================================================
// STATE
// ======================================================

const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

const POSE_PACKAGES = [
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21",
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18",
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision",
];

const LEFT_HIP = 23;
const LEFT_KNEE = 25;
const LEFT_ANKLE = 27;
const RIGHT_HIP = 24;
const RIGHT_KNEE = 26;
const RIGHT_ANKLE = 28;

let stream = null;
let poseLandmarker = null;
let cameraRunning = false;
let lastVideoTime = -1;
let animationFrame = null;
let startingCamera = false;

let reps = 0;
let squatState = "up";
let lastFeedback = "";
let poseLoading = false;

const jointHistory = {};

// ======================================================
// UI HELPERS
// ======================================================

function setFeedback(message) {
  if (message !== lastFeedback) {
    formStatus.textContent = message;
    lastFeedback = message;
  }
}

function setRating(value) {
  const score = Math.max(0, Math.min(100, Math.round(value)));
  ratingDisplay.textContent = score;
}

function resetWorkoutState() {
  reps = 0;
  squatState = "up";
  repCountDisplay.textContent = "0";
  setRating(0);

  Object.keys(jointHistory).forEach((key) => {
    delete jointHistory[key];
  });
}

function cameraErrorMessage(error) {
  const name = error?.name || "";

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was denied. Allow camera access in the browser and try again.";
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found. Plug in a webcam and try again.";
  }

  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is already in use by another app. Close it and try again.";
  }

  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "The selected camera could not start. Try another camera or press Start Camera again.";
  }

  if (name === "SecurityError" || name === "NotSupportedError") {
    return "This page cannot use the camera in the current browser context.";
  }

  if (!window.isSecureContext) {
    return "Camera requires a secure origin. Open this site on https:// or http://localhost.";
  }

  return error?.message
    ? `Could not access the camera: ${error.message}`
    : "Could not access the camera.";
}

// ======================================================
// MEDIAPIPE
// ======================================================

async function initializeMediaPipe() {
  if (poseLandmarker || poseLoading) {
    return;
  }

  poseLoading = true;

  try {
    if (!cameraRunning) {
      setFeedback("Loading pose tracking...");
    }

    let lastError = new Error("Pose tracking library could not be loaded.");

    for (const packageUrl of POSE_PACKAGES) {
      try {
        const { FilesetResolver, PoseLandmarker } = await import(
          `${packageUrl}/vision_bundle.mjs`
        );

        const vision = await FilesetResolver.forVisionTasks(`${packageUrl}/wasm`);

        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: POSE_MODEL_URL,
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        poseLandmarker = null;
      }
    }

    if (!poseLandmarker) {
      throw lastError;
    }

    if (cameraRunning) {
      setFeedback("Camera running. Stand where your full body is visible.");
    } else {
      setFeedback("Pose tracking ready. Select a camera or press Start Camera.");
    }
  } catch (error) {
    console.error("MediaPipe initialization failed:", error);

    if (cameraRunning) {
      setFeedback("Camera running. Pose tracking unavailable.");
    } else {
      setFeedback("Pose tracking unavailable. Camera can still be used.");
    }
  } finally {
    poseLoading = false;
  }
}

// ======================================================
// CAMERAS
// ======================================================

function stopTracks(mediaStream) {
  if (!mediaStream) {
    return;
  }

  mediaStream.getTracks().forEach((track) => {
    track.stop();
  });
}

async function findCameras(preferredDeviceId = "") {
  if (!navigator.mediaDevices?.enumerateDevices) {
    setFeedback("This browser does not support camera selection.");
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(
    (device) => device.kind === "videoinput" && device.deviceId,
  );

  const currentCamera = preferredDeviceId || cameraSelect.value;

  cameraSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = cameras.length
    ? "Select Camera"
    : "No camera listed yet — press Start Camera";
  cameraSelect.appendChild(placeholder);

  cameras.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Camera ${index + 1}`;

    if (device.deviceId === currentCamera) {
      option.selected = true;
    }

    cameraSelect.appendChild(option);
  });
}

function preferredCameraId(cameras) {
  const ranked = cameras.slice().sort((a, b) => {
    const score = (label) => {
      const value = (label || "").toLowerCase();
      if (/android|droidcam|obs|virtual|iriun|epoccam/.test(value)) {
        return 0;
      }
      if (/integrated|built-?in|facetime|vga|laptop|internal|hd webcam/.test(value)) {
        return 2;
      }
      return 1;
    };

    return score(b.label) - score(a.label);
  });

  return ranked[0]?.deviceId || "";
}

async function requestCameraStream(deviceId) {
  if (!deviceId) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(
      (device) => device.kind === "videoinput" && device.deviceId,
    );
    deviceId = preferredCameraId(cameras);
  }

  const attempts = [];

  if (deviceId) {
    attempts.push({
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    attempts.push({
      video: { deviceId: { exact: deviceId } },
      audio: false,
    });
  }

  attempts.push({
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  attempts.push({
    video: { facingMode: "user" },
    audio: false,
  });
  attempts.push({
    video: true,
    audio: false,
  });

  let lastError = new Error("Camera API is unavailable.");

  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;

      if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
        throw error;
      }
    }
  }

  throw lastError;
}

function waitForVideoMetadata(mediaElement, timeoutMs = 8000) {
  if (mediaElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      mediaElement.removeEventListener("loadedmetadata", onLoaded);
      reject(new Error("The camera started but never sent video frames."));
    }, timeoutMs);

    function onLoaded() {
      window.clearTimeout(timeoutId);
      resolve();
    }

    mediaElement.addEventListener("loadedmetadata", onLoaded, { once: true });
  });
}

function syncCanvasToVideo() {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;

  if (canvas.width !== width) {
    canvas.width = width;
  }

  if (canvas.height !== height) {
    canvas.height = height;
  }
}

function activeCameraId() {
  return stream?.getVideoTracks()?.[0]?.getSettings()?.deviceId || "";
}

// ======================================================
// START CAMERA
// ======================================================

async function startCamera() {
  if (startingCamera) {
    return;
  }

  startingCamera = true;
  startButton.disabled = true;

  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Camera requires a secure origin. Open this site on https:// or http://localhost.",
      );
    }

    if (stream) {
      stopCamera(false);
    }

    setFeedback("Requesting camera access...");

    stream = await requestCameraStream(cameraSelect.value);

    video.srcObject = stream;

    await waitForVideoMetadata(video);
    await video.play();

    cameraRunning = true;
    lastVideoTime = -1;
    stopButton.disabled = false;

    syncCanvasToVideo();
    resetWorkoutState();

    await findCameras(activeCameraId());

    setFeedback(
      poseLandmarker
        ? "Camera running. Stand where your full body is visible."
        : "Camera running. Loading pose tracking...",
    );

    initializeMediaPipe();
    startPoseLoop();
  } catch (error) {
    console.error("Could not start camera:", error);

    cameraRunning = false;
    stopTracks(stream);
    stream = null;
    video.srcObject = null;
    stopButton.disabled = true;

    setFeedback(cameraErrorMessage(error));
  } finally {
    startingCamera = false;
    startButton.disabled = false;
  }
}

// ======================================================
// STOP CAMERA
// ======================================================

function stopCamera(updateMessage = true) {
  cameraRunning = false;
  lastVideoTime = -1;

  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  stopTracks(stream);
  stream = null;
  video.srcObject = null;

  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  stopButton.disabled = true;

  if (updateMessage) {
    setFeedback("Camera stopped.");
  }
}

// ======================================================
// PROCESS VIDEO
// ======================================================

function startPoseLoop() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }

  animationFrame = requestAnimationFrame(processVideo);
}

function processVideo() {
  animationFrame = null;

  if (!cameraRunning) {
    return;
  }

  if (poseLandmarker && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      syncCanvasToVideo();

      try {
        const result = poseLandmarker.detectForVideo(video, performance.now());
        drawPose(result);
      } catch (error) {
        console.error("Pose detection failed:", error);
        setFeedback("Pose tracking encountered an error.");
      }
    }
  }

  animationFrame = requestAnimationFrame(processVideo);
}

// ======================================================
// DRAW POSE
// ======================================================

function landmarkScore(joint) {
  if (!joint) {
    return 0;
  }

  if (typeof joint.visibility === "number") {
    return joint.visibility;
  }

  if (typeof joint.presence === "number") {
    return joint.presence;
  }

  return 1;
}

function pickLeg(pose) {
  const right = [pose[RIGHT_HIP], pose[RIGHT_KNEE], pose[RIGHT_ANKLE]];
  const left = [pose[LEFT_HIP], pose[LEFT_KNEE], pose[LEFT_ANKLE]];

  const rightScore = right.reduce((total, joint) => total + landmarkScore(joint), 0);
  const leftScore = left.reduce((total, joint) => total + landmarkScore(joint), 0);

  if (Math.min(...right.map(landmarkScore)) >= 0.4 && rightScore >= leftScore) {
    return {
      hip: right[0],
      knee: right[1],
      ankle: right[2],
      names: ["rightHip", "rightKnee", "rightAnkle"],
      indexes: [RIGHT_HIP, RIGHT_KNEE, RIGHT_ANKLE],
    };
  }

  if (Math.min(...left.map(landmarkScore)) >= 0.4) {
    return {
      hip: left[0],
      knee: left[1],
      ankle: left[2],
      names: ["leftHip", "leftKnee", "leftAnkle"],
      indexes: [LEFT_HIP, LEFT_KNEE, LEFT_ANKLE],
    };
  }

  return null;
}

function drawPose(result) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!result?.landmarks?.length) {
    setRating(0);
    setFeedback("No person detected. Step into the camera view.");
    return;
  }

  const pose = result.landmarks[0];
  const leg = pickLeg(pose);

  if (!leg) {
    setRating(0);
    setFeedback("Lower-body landmarks are not visible. Step back so hips and knees are in frame.");
    return;
  }

  showJoint(pose, leg.indexes[0], leg.names[0], 8);
  showJoint(pose, leg.indexes[1], leg.names[1], 8);
  showJoint(pose, leg.indexes[2], leg.names[2], 8);

  drawLine(leg.hip, leg.knee);
  drawLine(leg.knee, leg.ankle);

  const kneeAngle = calculateAngle(leg.hip, leg.knee, leg.ankle);
  setRating(calculateFormScore(kneeAngle));
  checkSquat(kneeAngle);
}

// ======================================================
// JOINT SMOOTHING
// ======================================================

function showJoint(pose, landmarkIndex, jointName, dotSize) {
  const joint = pose[landmarkIndex];

  if (!joint) {
    return;
  }

  if (!jointHistory[jointName]) {
    jointHistory[jointName] = [];
  }

  const history = jointHistory[jointName];

  history.push({
    x: joint.x,
    y: joint.y,
  });

  if (history.length > 3) {
    history.shift();
  }

  let averageX = 0;
  let averageY = 0;

  for (const point of history) {
    averageX += point.x;
    averageY += point.y;
  }

  averageX /= history.length;
  averageY /= history.length;

  const pixelX = averageX * canvas.width;
  const pixelY = averageY * canvas.height;

  ctx.beginPath();
  ctx.arc(pixelX, pixelY, dotSize, 0, Math.PI * 2);
  ctx.fillStyle = "#5ca0f2";
  ctx.fill();
}

// ======================================================
// DRAW SKELETON
// ======================================================

function drawLine(pointA, pointB) {
  if (!pointA || !pointB) {
    return;
  }

  const x1 = pointA.x * canvas.width;
  const y1 = pointA.y * canvas.height;
  const x2 = pointB.x * canvas.width;
  const y2 = pointB.y * canvas.height;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);

  ctx.strokeStyle = "#3f88e8";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.stroke();
}

// ======================================================
// ANGLE / FORM SCORE
// ======================================================

function calculateAngle(a, b, c) {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) -
    Math.atan2(a.y - b.y, a.x - b.x);

  let degrees = Math.abs((radians * 180) / Math.PI);

  if (degrees > 180) {
    degrees = 360 - degrees;
  }

  return degrees;
}

function calculateFormScore(angle) {
  if (angle >= 150) {
    return 100;
  }

  const distanceFromTarget = Math.abs(angle - 90);
  return Math.max(0, 100 - distanceFromTarget * 1.5);
}

// ======================================================
// SQUAT DETECTION
// ======================================================

function checkSquat(angle) {
  if (angle < 100 && squatState === "up") {
    squatState = "down";
    setFeedback("Good depth. Drive back up with control.");
    return;
  }

  if (angle > 160 && squatState === "down") {
    reps += 1;
    squatState = "up";
    repCountDisplay.textContent = String(reps);
    setFeedback("Good rep. Keep the next one controlled.");
    return;
  }

  if (squatState === "up" && !lastFeedback.startsWith("Good")) {
    setFeedback("Stand tall, then squat until the knees bend near 90 degrees.");
  }
}

// ======================================================
// BUTTONS
// ======================================================

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", () => stopCamera(true));

cameraSelect.addEventListener("change", async () => {
  if (cameraRunning && cameraSelect.value) {
    await startCamera();
  }
});

// ======================================================
// INITIALIZE
// ======================================================

async function initialize() {
  stopButton.disabled = true;
  setRating(0);

  if (!window.isSecureContext) {
    setFeedback(
      "Camera requires a secure origin. Open this site on https:// or http://localhost.",
    );
  } else if (!navigator.mediaDevices?.getUserMedia) {
    setFeedback("This browser cannot access the camera.");
  } else {
    setFeedback("Camera ready. Press Start Camera to begin.");
  }

  try {
    await findCameras();

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", () => {
        findCameras(activeCameraId());
      });
    }
  } catch (error) {
    console.error("Startup failed:", error);
  }

  initializeMediaPipe();
}

initialize();
