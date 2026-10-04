import os
import sqlite3

from flask import Flask, render_template, request, jsonify


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static"),
    static_url_path="/static",
)


INSTANCE_DIR = os.path.join(BASE_DIR, "instance")
DATABASE = os.path.join(INSTANCE_DIR, "formcheck.db")


def get_database():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database():
    os.makedirs(INSTANCE_DIR, exist_ok=True)

    connection = get_database()

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS workouts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exercise TEXT NOT NULL,
            reps INTEGER NOT NULL,
            good_reps INTEGER NOT NULL,
            bad_reps INTEGER NOT NULL,
            duration INTEGER NOT NULL
        )
        """
    )

    connection.commit()
    connection.close()


initialize_database()


@app.after_request
def add_camera_headers(response):
    response.headers["Permissions-Policy"] = "camera=(self), microphone=()"
    return response


@app.route("/")
def home():
    return render_template("home.html")


@app.route("/api/workout", methods=["POST"])
def save_workout():
    data = request.get_json(silent=True) or {}

    try:
        exercise = str(data.get("exercise", "squat"))
        reps = int(data.get("reps", 0))
        good_reps = int(data.get("good_reps", 0))
        bad_reps = int(data.get("bad_reps", 0))
        duration = int(data.get("duration", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid workout data"}), 400

    connection = get_database()

    connection.execute(
        """
        INSERT INTO workouts
        (
            exercise,
            reps,
            good_reps,
            bad_reps,
            duration
        )
        VALUES (?, ?, ?, ?, ?)
        """,
        (exercise, reps, good_reps, bad_reps, duration),
    )

    connection.commit()
    connection.close()

    return jsonify({"message": "Workout saved"})


@app.route("/api/workouts", methods=["GET"])
def get_workouts():
    connection = get_database()

    workouts = connection.execute(
        """
        SELECT *
        FROM workouts
        ORDER BY id DESC
        """
    ).fetchall()

    connection.close()

    return jsonify([dict(workout) for workout in workouts])


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port, debug=False)
