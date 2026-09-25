# Static Astro site: type-check + build, then serve dist/ with nginx.
FROM node:22-slim AS build
WORKDIR /site
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /site/dist /usr/share/nginx/html
EXPOSE 80
