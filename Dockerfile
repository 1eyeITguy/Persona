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

# Copy backend source as a package
COPY backend/ ./backend/

# Copy built frontend into static/ (FastAPI serves this at runtime)
COPY --from=frontend-build /frontend/dist/ ./backend/static/

# Volume mount point for runtime config (config.json, certs/, etc.)
RUN mkdir -p /app/data /app/data/certs

# ---------------------------------------------------------------------------
# PowerShell Core + ExchangeOnlineManagement module
#
# Required for Exchange Online PowerShell integration (Phase 3).
# Adds ~200 MB to the image. The EXO features degrade gracefully if pwsh
# is unavailable, so this block can be commented out in space-constrained
# environments — all Graph API-based Exchange features will still work.
# ---------------------------------------------------------------------------
RUN apt-get update && \
    apt-get install -y --no-install-recommends wget gnupg ca-certificates && \
    wget -q "https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb" && \
    dpkg -i packages-microsoft-prod.deb && \
    rm packages-microsoft-prod.deb && \
    apt-get update && \
    apt-get install -y --no-install-recommends powershell && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN pwsh -NonInteractive -Command \
    "Install-Module -Name ExchangeOnlineManagement -Force -Scope AllUsers -AcceptLicense"

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
