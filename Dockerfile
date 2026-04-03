# ─── Stage 1: Build the React frontend ───────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --frozen-lockfile

COPY frontend/ .
RUN npm run build
# Output: /frontend/dist/


# ─── Stage 2: Production image ────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ .

# Copy built frontend into static/ (FastAPI serves this at runtime)
COPY --from=frontend-build /frontend/dist/ ./static/

# Volume mount point for runtime config (config.json, etc.)
RUN mkdir -p /app/data

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
