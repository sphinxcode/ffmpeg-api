#####################################################################
#
# A Docker image to convert audio and video for web using web API
#
#   with
#     - FFMPEG (built)
#     - NodeJS
#     - fluent-ffmpeg
#
#   For more on Fluent-FFMPEG, see
#
#            https://github.com/fluent-ffmpeg/node-fluent-ffmpeg
#
# Original image and FFMPEG API by Paul Visco
# https://github.com/surebert/docker-ffmpeg-service
#
#####################################################################

FROM node:18.14-alpine3.16 as build

RUN apk add --no-cache git curl unzip

# install pkg
RUN npm install -g pkg

# Download Inter + Liberation Sans (Helvetica metric-compatible, free)
RUN mkdir -p /fonts/inter /fonts/liberation && \
    curl -fL "https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip" -o /tmp/inter.zip && \
    unzip -j /tmp/inter.zip "*Inter-Regular.ttf" -d /fonts/inter/ && \
    rm /tmp/inter.zip && \
    apk add --no-cache ttf-liberation && \
    cp /usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf /fonts/liberation/

ENV PKG_CACHE_PATH /usr/cache

WORKDIR /usr/src/app

# Bundle app source
COPY ./src .
RUN npm install

# Create single binary file
RUN pkg --targets node18-alpine-x64 /usr/src/app/package.json


FROM jrottenberg/ffmpeg:4.2-alpine311

# Install fontconfig only (font file copied from build stage)
RUN apk add --no-cache fontconfig

# Copy Inter font from build stage and register it
RUN mkdir -p /usr/share/fonts/truetype/inter /usr/share/fonts/truetype/liberation
COPY --from=build /fonts/inter/Inter-Regular.ttf /usr/share/fonts/truetype/inter/Inter-Regular.ttf
COPY --from=build /fonts/liberation/LiberationSans-Regular.ttf /usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf
RUN fc-cache -f

# Create user and change workdir
RUN adduser --disabled-password --home /home/ffmpgapi ffmpgapi
WORKDIR /home/ffmpgapi

# Copy files from build stage
COPY --from=build /usr/src/app/ffmpegapi .
COPY --from=build /usr/src/app/index.md .
RUN chown ffmpgapi:ffmpgapi * && chmod 755 ffmpegapi

EXPOSE 3000

# Change user
USER ffmpgapi

ENTRYPOINT []
CMD [ "./ffmpegapi" ]
