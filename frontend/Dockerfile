# ── Etapa 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite resuelve import.meta.env.VITE_* en build time (no en runtime), así que
# la URL del backend tiene que estar disponible como build arg. En Render,
# las env vars configuradas en el servicio se pasan como build args a
# Dockerfiles que declaren el ARG correspondiente.
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# ── Etapa 2: runtime (Nginx sirviendo el build estático) ───────────────────
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
# La imagen oficial de nginx procesa /etc/nginx/templates/*.template con
# envsubst al arrancar y escribe el resultado en /etc/nginx/conf.d/ — así
# el contenedor escucha en el puerto que indique la plataforma (Render lo
# inyecta vía $PORT) sin necesidad de un entrypoint propio.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV PORT=80
EXPOSE 80
