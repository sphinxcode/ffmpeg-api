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

RUN apk add --no-cache git

# install pkg
RUN npm install -g pkg

ENV PKG_CACHE_PATH /usr/cache

WORKDIR /usr/src/app

# Bundle app source
COPY ./src .
RUN npm install

# Create single binary file
RUN pkg --targets node18-alpine-x64 /usr/src/app/package.json


FROM jrottenberg/ffmpeg:4.2-alpine311

# Install Inter font for drawtext (clean sans-serif, TikTok-standard look)
RUN apk add --no-cache fontconfig curl unzip && \
    mkdir -p /usr/share/fonts/truetype/inter && \
    curl -fL "https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip" -o /tmp/inter.zip && \
    unzip -j /tmp/inter.zip "Inter Desktop/Inter-Regular.ttf" -d /usr/share/fonts/truetype/inter/ && \
    fc-cache -f && \
    rm -f /tmp/inter.zip

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

