# The web app is built with Node and served by the API: one container, one port.
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY src ./src
RUN pip install --no-cache-dir . \
    && useradd --create-home --uid 10001 console
COPY --from=web /web/dist ./web
ENV WEB_DIR=/app/web PORT=8000
EXPOSE 8000
USER console
CMD ["plant-console"]
