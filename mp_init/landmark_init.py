import mediapipe as mp

BaseOptions = mp.tasks.BaseOptions
PoseLandmarker = mp.tasks.vision.PoseLandmarker
PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions

options = PoseLandmarkerOptions(
    base_options=BaseOptions(model_asset_path="mp_init/pose_landmarker_lite.task")
)

landmarker = PoseLandmarker.create_from_options(options)

print("\n LANDMARKER MADE!")