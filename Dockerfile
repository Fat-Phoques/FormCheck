# Use an official Python runtime with all build tools included
FROM python:3.10-slim

# Install system dependencies required by OpenCV and MediaPipe
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgles2 \
    libegl1 \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Run the application using Gunicorn
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:10000"]
