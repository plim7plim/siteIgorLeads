FROM node:24-bookworm-slim

WORKDIR /app
RUN install -d -o node -g node -m 0750 /data
COPY --chown=node:node package.json server.mjs soumaisblu.mjs production-goals.mjs goals-db.mjs reports.mjs backup-db.mjs brazil-regions.mjs ./
COPY --chown=node:node index.html styles.css app.js favicon.png brazil-map.js brasil-ufs.geojson ./

USER node
ENV NODE_ENV=production PANEL_HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "server.mjs"]
