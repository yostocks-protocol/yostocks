# yostocks Telegram bot + agent. State (wallet session, strategies, paid jobs) lives in /data.
FROM node:22-slim
# baw's optional keytar native build is skipped: without a keychain it stores the session in $BINANCE_BAW_DIR,
# encrypted with a key from BINANCE_INSTANCE_ID (else the machine identity, which changes on every container
# restart). Set BINANCE_INSTANCE_ID to a fixed secret at runtime or the wallet signs out on each redeploy.
RUN npm i -g @binance/agentic-wallet@1.10.0 --ignore-scripts && npm cache clean --force
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/agent/package.json apps/agent/
COPY apps/bot/package.json apps/bot/
RUN npm ci --omit=dev && npm cache clean --force
COPY apps/agent apps/agent
COPY apps/bot apps/bot
ENV NODE_ENV=production \
    BAW=baw \
    BINANCE_BAW_DIR=/data/baw \
    YO_DATA=/data/strategies.json \
    YO_JOBS=/data/analyst-jobs.json
# A named volume copies this ownership on first mount, so the non-root user can write the session.
RUN mkdir -p /data/baw && chown -R node:node /data
VOLUME /data
USER node
CMD ["node", "apps/bot/bot.mjs"]
