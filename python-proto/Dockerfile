FROM python:3.12-slim

# Install system dependencies for rtree, open3d, and mesh processing
RUN apt-get update && apt-get install -y \
    libspatialindex-dev \
    libgl1-mesa-glx \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Copy project files
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-cache

COPY . .

# Ensure jobs and accessories directories exist
RUN mkdir -p jobs accessories

EXPOSE 8000

# Run the API
CMD ["uv", "run", "python", "api.py"]
