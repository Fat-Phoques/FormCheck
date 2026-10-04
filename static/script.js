import {
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

// ======================================================
// HTML ELEMENTS
// ======================================================

const video = document.getElementById("video");

const canvas = document.getElementById("canvas");

const ctx = canvas.getContext("2d");

const cameraSelect = document.getElementById("camera");

const startButton = document.getElementById("start-button");

const stopButton = document.getElementById("stop-button");

const formStatus = document.getElementById("form-status");

const repCountDisplay = document.getElementById("rep-count");

const angleDisplay = document.getElementById("angle");

// ======================================================
// VARIABLES
// ======================================================

let stream = null;

let poseLandmarker = null;

let cameraRunning = false;

let lastVideoTime = -1;

// ======================================================
// SQUAT VARIABLES
// ======================================================

let reps = 0;

let squatState = "up";

// ======================================================
// JOINT SMOOTHING
// ======================================================

const jointHistory = {};

// ======================================================
// STARTUP
// ======================================================

async function initializeMediaPipe() {
  formStatus.textContent = "Loading MediaPipe...";

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(
    vision,

    {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
      },

      runningMode: "VIDEO",

      numPoses: 1,

      minPoseDetectionConfidence: 0.5,

      minPosePresenceConfidence: 0.5,

      minTrackingConfidence: 0.5,
    },
  );

  formStatus.textContent = "MediaPipe ready";

  console.log("MediaPipe ready");
}

// ======================================================
// FIND CAMERAS
// ======================================================

async function findCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();

  cameraSelect.innerHTML = '<option value="">Select Camera</option>';

  for (const device of devices) {
    if (device.kind === "videoinput") {
      const option = document.createElement("option");

      option.value = device.deviceId;

      option.textContent = device.label || `Camera ${cameraSelect.length}`;

      cameraSelect.appendChild(option);
    }
  }
}

// ======================================================
// START CAMERA
// ======================================================

async function startCamera() {
  if (!poseLandmarker) {
    formStatus.textContent = "MediaPipe is still loading.";

    return;
  }

  if (stream) {
    stopCamera();
  }

  const selectedCamera = cameraSelect.value;

  const constraints = {
    video: selectedCamera
      ? {
          deviceId: {
            exact: selectedCamera,
          },
        }
      : true,
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);

    video.srcObject = stream;

    await video.play();

    cameraRunning = true;

    canvas.width = video.videoWidth;

    canvas.height = video.videoHeight;

    formStatus.textContent = "Camera running";

    requestAnimationFrame(processVideo);
  } catch (error) {
    console.error(error);

    formStatus.textContent = "Could not access camera.";
  }
}

// ======================================================
// STOP CAMERA
// ======================================================

function stopCamera() {
  cameraRunning = false;

  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }

    stream = null;
  }

  video.srcObject = null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  formStatus.textContent = "Camera stopped";
}

// ======================================================
// PROCESS WEBCAM
// ======================================================

function processVideo() {
  if (!cameraRunning) {
    return;
  }

  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;

    const timestamp = performance.now();

    poseLandmarker.detectForVideo(
      video,

      timestamp,

      (result) => {
        drawPose(result);
      },
    );
  }

  requestAnimationFrame(processVideo);
}

// ======================================================
// DRAW POSE
// ======================================================

function drawPose(result) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!result.landmarks || result.landmarks.length === 0) {
    formStatus.textContent = "No person detected";

    return;
  }

  const pose = result.landmarks[0];

  formStatus.textContent = "Person detected";

  // RIGHT SIDE OF BODY

  const rightHip = pose[24];

  const rightKnee = pose[26];

  const rightAnkle = pose[28];

  // DRAW THE IMPORTANT JOINTS

  showJoint(pose, 24, "rightHip", 10);

  showJoint(pose, 26, "rightKnee", 10);

  showJoint(pose, 28, "rightAnkle", 10);

  // DRAW SKELETON

  drawLine(rightHip, rightKnee);

  drawLine(rightKnee, rightAnkle);

  // CALCULATE KNEE ANGLE

  const kneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);

  angleDisplay.textContent = `${Math.round(kneeAngle)}°`;

  // SQUAT DETECTION

  checkSquat(kneeAngle);
}

// ======================================================
// YOUR PYTHON show_joint() REPLACEMENT
// ======================================================

function showJoint(pose, landmark, jointName, dotSize) {
  const joint = pose[landmark];

  // Create history for this joint
  // the first time we see it.

  if (!jointHistory[jointName]) {
    jointHistory[jointName] = [];
  }

  const history = jointHistory[jointName];

  // Add newest position.

  history.push({
    x: joint.x,
    y: joint.y,
  });

  // Keep only the last 3 frames.

  if (history.length > 3) {
    history.shift();
  }

  // Calculate the average.

  let averageX = 0;

  let averageY = 0;

  for (const point of history) {
    averageX += point.x;

    averageY += point.y;
  }

  averageX = averageX / history.length;

  averageY = averageY / history.length;

  // Convert normalized coordinates
  // into canvas pixel coordinates.

  const pixelX = averageX * canvas.width;

  const pixelY = averageY * canvas.height;

  // Draw the joint.

  ctx.beginPath();

  ctx.arc(pixelX, pixelY, dotSize, 0, Math.PI * 2);

  ctx.fillStyle = "lime";

  ctx.fill();
}

// ======================================================
// DRAW LINE
// ======================================================

function drawLine(pointA, pointB) {
  const x1 = pointA.x * canvas.width;

  const y1 = pointA.y * canvas.height;

  const x2 = pointB.x * canvas.width;

  const y2 = pointB.y * canvas.height;

  ctx.beginPath();

  ctx.moveTo(x1, y1);

  ctx.lineTo(x2, y2);

  ctx.strokeStyle = "black";

  ctx.lineWidth = 3;

  ctx.stroke();
}

// ======================================================
// ANGLE CALCULATION
// ======================================================

function calculateAngle(a, b, c) {
  const angle =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);

  let degrees = Math.abs((angle * 180) / Math.PI);

  if (degrees > 180) {
    degrees = 360 - degrees;
  }

  return degrees;
}

// ======================================================
// SQUAT DETECTION
// ======================================================

function checkSquat(angle) {
  // Going DOWN

  if (angle < 100 && squatState === "up") {
    squatState = "down";

    formStatus.textContent = "Good — keep going!";
  }

  // Coming back UP

  if (angle > 160 && squatState === "down") {
    reps++;

    squatState = "up";

    repCountDisplay.textContent = reps;

    formStatus.textContent = "GOOD REP!";
  }
}

// ======================================================
// BUTTONS
// ======================================================

startButton.addEventListener("click", startCamera);

stopButton.addEventListener("click", stopCamera);

cameraSelect.addEventListener("change", async () => {
  if (cameraRunning) {
    await startCamera();
  }
});

// ======================================================
// INITIALIZE
// ======================================================

async function initialize() {
  await initializeMediaPipe();

  try {
    await navigator.mediaDevices.getUserMedia({
      video: true,
    });

    await findCameras();
  } catch (error) {
    console.error(error);

    formStatus.textContent = "Camera permission required.";
  }
}

initialize();
