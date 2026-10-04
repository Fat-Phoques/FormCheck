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
const ratingDisplay = document.getElementById("rating");

// ======================================================
// STATE
// ======================================================

let stream = null;
let poseLandmarker = null;
let cameraRunning = false;
let lastVideoTime = -1;

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
    setFeedback("Loading pose tracking...");

    const { FilesetResolver, PoseLandmarker } = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs"
    );

    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm",
    );

    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "/static/pose_landmarker_lite.task",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    if (cameraRunning) {
      setFeedback("Camera running. Pose tracking ready.");
    } else {
      setFeedback("Pose tracking ready. Select a camera to start.");
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

async function findCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    setFeedback("This browser does not support camera selection.");
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const currentCamera = cameraSelect.value;

  cameraSelect.innerHTML = '<option value="">Select Camera</option>';

  cameras.forEach((device, index) => {
    const option = document.createElement("option");

    option.value = device.deviceId;
    option.textContent = device.label || `Camera ${index + 1}`;

    if (device.deviceId === currentCamera) {
      option.selected = true;
    }

    cameraSelect.appendChild(option);
  });

  if (cameras.length === 0) {
    const option = document.createElement("option");

    option.value = "";
    option.textContent = "No camera found";

    cameraSelect.appendChild(option);
  }
}

// ======================================================
// START CAMERA
// ======================================================

async function startCamera() {
  startButton.disabled = true;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera API is unavailable.");
    }

    if (stream) {
      stopCamera(false);
    }

    const selectedCamera = cameraSelect.value;

    const constraints = {
      video: selectedCamera
        ? {
            deviceId: { exact: selectedCamera },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user",
          },
      audio: false,
    };

    setFeedback("Requesting camera access...");

    stream = await navigator.mediaDevices.getUserMedia(constraints);

    video.srcObject = stream;

    await new Promise((resolve) => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        resolve();
        return;
      }

      video.addEventListener("loadedmetadata", resolve, { once: true });
    });

    await video.play();

    cameraRunning = true;
    lastVideoTime = -1;

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    stopButton.disabled = false;

    await findCameras();

    setFeedback(
      poseLandmarker
        ? "Camera running. Stand where your full body is visible."
        : "Camera running. Loading pose tracking..."
    );

    if (!poseLandmarker) {
      initializeMediaPipe();
    }

    requestAnimationFrame(processVideo);
  } catch (error) {
    console.error("Could not start camera:", error);

    cameraRunning = false;

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }

    video.srcObject = null;
    stopButton.disabled = true;

    setFeedback(
      error.name === "NotAllowedError"
        ? "Camera permission was denied."
        : "Could not access the camera.",
    );
  } finally {
    startButton.disabled = false;
  }
}

// ======================================================
// STOP CAMERA
// ======================================================

function stopCamera(updateMessage = true) {
  cameraRunning = false;
  lastVideoTime = -1;

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

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

function processVideo() {
  if (!cameraRunning || !poseLandmarker) {
    return;
  }

  if (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.currentTime !== lastVideoTime
  ) {
    lastVideoTime = video.currentTime;

    try {
      const result = poseLandmarker.detectForVideo(
        video,
        performance.now(),
      );

      drawPose(result);
    } catch (error) {
      console.error("Pose detection failed:", error);
      setFeedback("Pose tracking encountered an error.");
    }
  }

  requestAnimationFrame(processVideo);
}

// ======================================================
// DRAW POSE
// ======================================================

function drawPose(result) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!result?.landmarks?.length) {
    setRating(0);
    setFeedback("No person detected. Step into the camera view.");
    return;
  }

  const pose = result.landmarks[0];

  const rightHip = pose[24];
  const rightKnee = pose[26];
  const rightAnkle = pose[28];

  if (!rightHip || !rightKnee || !rightAnkle) {
    setRating(0);
    setFeedback("Lower-body landmarks are not visible.");
    return;
  }

  showJoint(pose, 24, "rightHip", 8);
  showJoint(pose, 26, "rightKnee", 8);
  showJoint(pose, 28, "rightAnkle", 8);

  drawLine(rightHip, rightKnee);
  drawLine(rightKnee, rightAnkle);

  const kneeAngle = calculateAngle(
    rightHip,
    rightKnee,
    rightAnkle,
  );

  const score = calculateFormScore(kneeAngle);

  setRating(score);

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
  // For the current squat detector, approximately 90 degrees
  // represents the target bottom position.
  const distanceFromTarget = Math.abs(angle - 90);

  return Math.max(
    0,
    100 - distanceFromTarget * 1.5,
  );
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

    repCountDisplay.textContent = reps;
    setFeedback("Good rep. Keep the next one controlled.");
  }
}

// ======================================================
// BUTTONS
// ======================================================

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", () => stopCamera(true));

cameraSelect.addEventListener("change", async () => {
  if (cameraRunning) {
    await startCamera();
  }
});

// ======================================================
// INITIALIZE
// ======================================================

async function initialize() {
  stopButton.disabled = true;
  setRating(0);
  setFeedback("Camera ready. Select a camera or press Start Camera.");

  try {
    await findCameras();

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", findCameras);
    }
  } catch (error) {
    console.error("Startup failed:", error);
  }
}

initialize();
