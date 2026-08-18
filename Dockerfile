FROM node:22-bookworm-slim

# Headless Chromium for PDF export (playwright-core drives the system browser
# rather than downloading its own - see server/lib/pdfExport.js).
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Bake the embedding model into the image (see scripts/warm-model.mjs).
RUN node scripts/warm-model.mjs

ENV NODE_ENV=production
ENV PDF_BROWSER_PATH=/usr/bin/chromium
EXPOSE 5678

CMD ["node", "server/server.js"]
