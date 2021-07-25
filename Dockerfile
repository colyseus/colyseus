## Stage 0 (production base)
# This gets our prod dependencies installed and out of the way
# FROM lucidsightinc/node:10.24-alpine as base / node:15-buster / tarampampam/node:10-alpine | tarampampam/node:14-alpine  / 12-alpine
FROM node:14.17.3-buster as base

ENV NODE_ENV=production \
    PORTUDP=2222 \
    PORT=2567 \
    LOCALUDP="false" \
    MONGO_URI="mongodb+srv://fazri:lucid!!S1914@lsdevcluster0.a2pcc.gcp.mongodb.net/test?retryWrites=true&w=majority" \
    APIVERSION="0.14.18_Node-14.17.3-Buster"

# RUN apt install curl
RUN apt update
RUN apt install -y curl
RUN apt install -y vim
# RUN apk add --update --no-cache python3 && ln -sf python3 /usr/bin/python
# RUN python3 -m ensurepip
# RUN pip3 install --no-cache --upgrade pip setuptools
# RUN apk add --update make
# RUN apk add --update g++
# RUN apk add --update libc-dev
# RUN apk add --update mtools
# RUN apk add --update libstdc++
# RUN apk add --update gcc
# RUN apk add --update libgcc
# RUN apk add --update bzip2
# RUN apk add --update abuild 
# RUN apk add --update curl 
 
EXPOSE 2567 2222 80

WORKDIR /colyseus

COPY package*.json ./

# CMD ["node", "app/server/index.js"]

## Stage 1 (dev base): docker-compose will mount files dont need to copy here
FROM base as dev

ENV NODE_ENV=development \
    LOCALUDP="false" \
    MONGO_URI="mongodb+srv://fazri:lucid!!S1914@lsdevcluster0.a2pcc.gcp.mongodb.net/test?retryWrites=true&w=majority"

ENV PATH=/colyseus/node_modules/.bin:$PATH

RUN npm install

ENTRYPOINT ["/colyseus/app/dev-prelaunch-actions.sh"]
CMD ["./node_modules/nodemon/bin/nodemon.js","--legacy-watch", "--exec", "ts-node", "--project", "./tsconfig.json",  "--transpile-only", "./server/index.ts", "--inspect=0.0.0.0:9229"]

## Stage 2 (prod)
FROM base as prod

ENV NODE_ENV=production

RUN npm install --only=production \
    && npm cache clean --force

#copy into /colyseus
WORKDIR /colyseus
COPY prelaunch-actions.sh .
COPY packageCombine.js .

WORKDIR /colyseus/app
COPY dist/. .

# RUN chown node:node .
# USER node
ENTRYPOINT ["/colyseus/prelaunch-actions.sh"]
CMD ["node", "server/index.js"]
