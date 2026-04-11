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
#
# Installs PowerShell from GitHub releases (reliable across Debian 11/12).
# ---------------------------------------------------------------------------
RUN set -eux; \
    . /etc/os-release; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        wget \
        libgssapi-krb5-2 \
        libstdc++6 \
        zlib1g; \
    case "$VERSION_ID" in \
        "11") apt-get install -y --no-install-recommends libicu67 ;; \
        "12") apt-get install -y --no-install-recommends libicu72 ;; \
        *)    apt-get install -y --no-install-recommends "libicu-dev" ;; \
    esac; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*; \
    PWSH_VERSION=$(python3 -c \
        "import urllib.request,json; \
         d=json.loads(urllib.request.urlopen('https://api.github.com/repos/PowerShell/PowerShell/releases/latest').read()); \
         print(d['tag_name'].lstrip('v'))"); \
    wget -q \
        "https://github.com/PowerShell/PowerShell/releases/download/v${PWSH_VERSION}/powershell-${PWSH_VERSION}-linux-x64.tar.gz" \
        -O /tmp/pwsh.tar.gz; \
    mkdir -p /opt/microsoft/powershell/7; \
    tar -xzf /tmp/pwsh.tar.gz -C /opt/microsoft/powershell/7; \
    chmod +x /opt/microsoft/powershell/7/pwsh; \
    ln -s /opt/microsoft/powershell/7/pwsh /usr/local/bin/pwsh; \
    rm /tmp/pwsh.tar.gz

RUN pwsh -NonInteractive -Command \
    "Install-Module -Name ExchangeOnlineManagement -Force -Scope AllUsers -AcceptLicense"

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
