# Use an Ubuntu-based Python image (massively improves MediaPipe stability)
FROM ubuntu:22.04

# Avoid prompts from package manager
ENV DEBIAN_FRONTEND=noninteractive

# Install Python and all required media framework graphics libraries
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgles2 \
    libegl1 \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy requirements and install python packages
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy the rest of your application code
COPY . .

# Start the Flask app using Gunicorn on Render's required port
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:10000"]
