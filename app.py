import webbrowser
import os

import cv2 as cv
import mediapipe as mp
from flask import Flask, Response, render_template, request

from mp_init.landmark_init import landmarker

camera = 0  # default camera
camera_running = False
joint_history = []
joint_x_avg = 0
joint_y_avg = 0


app = Flask(__name__)


def find_cameras():
    cameras = []

    for camera in range(5):
        webcam = cv.VideoCapture(camera)

        if webcam.isOpened():
            cameras.append(camera)

        webcam.release()

    return cameras


@app.route("/select_camera", methods=["POST"])
def select_camera():
    global camera

    data = request.get_json()
    camera = int(data["camera"])
    print(camera)
    return "Camera Selected"


@app.route("/")
def home():
    cameras = find_cameras()

    return render_template("home.html", cameras=cameras)  # homepage


def show_joint(pose, landmark, frame, dot_size, bgr_color):
    # once this works add the average cords to this
    global joint_x_avg, joint_y_avg
    joint = pose[landmark]

    joint_history.append((joint.x, joint.y))

    if len(joint_history) > 3:
        joint_history.pop(0)

    joint_x_avg,joint_y_avg = 0, 0
    for x, y in joint_history:
        joint_x_avg += x
        joint_y_avg += y

    joint_x_avg = joint_x_avg / len(joint_history)
    joint_y_avg = joint_y_avg / len(joint_history)


    joint_px_x = int(frame.shape[1] * joint_x_avg)
    joint_px_y = int(frame.shape[0] * joint_y_avg)

    cv.circle(
        frame,
        (joint_px_x, joint_px_y),
        dot_size,
        bgr_color,  # right knee -> green
        thickness=-1,
    )


def generate_frames():
    webcam = cv.VideoCapture(camera)

    frame_num = 0   

    while camera_running:
        is_true, frame = webcam.read()

        frame_num += 1

        if not is_true:
            break

        resized_frame = cv.resize(frame, (640, 450), interpolation=cv.INTER_AREA)

        rgb_frame = cv.cvtColor(resized_frame, cv.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        result = landmarker.detect(mp_image)

        if result.pose_landmarks:
            pose = result.pose_landmarks[0]

            show_joint(
                pose,
                mp.tasks.vision.PoseLandmark.RIGHT_EYE,
                resized_frame,
                10,
                (255, 0, 0),
            )

        # takes the frame and compresses it to JPEG(buffer contains it)
        _ret, buffer = cv.imencode(
            ".jpg", resized_frame
        )  # "_" prefix means variable not used
        resized_frame = buffer.tobytes()  # converts encoded img to bytes for HTTP
        # below: streaming the footage
        yield (
            b"--resized_frame\r\nContent-Type: image/jpeg\r\n\r\n"
            + resized_frame
            + b"\r\n"
        )
        # yield vs return : yield -> "Here's one thing, I'll give you another thing later"
        #                  return-> "I'm done"
        #  b -> means bytes
        # Content-Type: image/jpeg -> a new frame is starting ; its a JPEG


@app.route("/video_feed")  # creates the location of our live stream
def video_feed():
    # runs when the browser asks for video feed
    return Response(
        generate_frames(), mimetype="multipart/x-mixed-replace; boundary=resized_frame"
    )
    # Response makes a HTTP response
    # generate_frames() tells the browser that the frames are coming from that
    # mimetype="multipart/x-mixed-replace; boundary=frame" -> tells brower, response has >1 images seperated in frames
    # "This is the magic that makes the MJPEG-style stream work."


@app.route("/start_camera", methods=["POST"])
def start_camera():
    global camera_running
    camera_running = True
    return "LIVE FEED IS ON"


@app.route("/stop_camera", methods=["POST"])
def stop_camera():
    global camera_running
    camera_running = False
    return "LIVE FEED IS OFF"


# THIS SHOULD ALWAYS RUN IN THE END
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    webbrowser.open(f"http://127.0.0.1:{port}")  # opens the local host in chrome
    app.run(debug=True, use_reloader=False, port=port, host='0.0.0.0')
