# ── build ────────────────────────────────────────────────────────────────
# AI Studio가 만든 Vite + React + TypeScript 앱을 정적 번들로 빌드한다.
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci || npm install

COPY . .

# Gemini API 키를 빌드 타임에 주입해야 하는 경우 GitHub Actions에서
# --build-arg 로 넘긴다. 주의: 이렇게 넣은 키는 브라우저 번들에 그대로 남는다.
ARG GEMINI_API_KEY=""
ENV GEMINI_API_KEY=$GEMINI_API_KEY

RUN npm run build

# ── serve ────────────────────────────────────────────────────────────────
# Cloud Run은 $PORT(기본 8080)로 들어온다. nginx 설정에 그 값을 치환해 넣는다.
FROM nginx:alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV PORT=8080
EXPOSE 8080
