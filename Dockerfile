#####################################################################
#
# A Docker image to convert audio and video for web using web API
#
#   with
#     - FFMPEG (mwader/static-ffmpeg — fully featured static binary)
#     - NodeJS 20 on Debian bookworm
#     - ImageMagick + pango (text + color emoji overlay rendering)
#     - Inter, Liberation Sans (Helvetica substitute), Noto Color Emoji
#
#####################################################################

# ── Stage 1: pull static FFmpeg binaries ────────────────────────────
FROM mwader/static-ffmpeg:latest AS ffmpeg-static

# ── Stage 2: build deps + download fonts ────────────────────────────
FROM node:20-bookworm AS build

RUN apt-get update && apt-get install -y --no-install-recommends curl unzip \
    && rm -rf /var/lib/apt/lists/*

# Inter Regular from official release zip
RUN mkdir -p /fonts/inter && \
    curl -fL "https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip" -o /tmp/inter.zip && \
    unzip -j /tmp/inter.zip "*Regular.ttf" -d /fonts/inter/ && \
    FIRST=$(find /fonts/inter -name "*.ttf" | head -1) && \
    [ -n "$FIRST" ] && mv "$FIRST" /fonts/inter/Inter-Regular.ttf && \
    rm /tmp/inter.zip

WORKDIR /usr/src/app
COPY ./src .
RUN npm install --production

# ── Stage 3: runtime ────────────────────────────────────────────────
FROM node:20-bookworm-slim

# Static FFmpeg + ffprobe
COPY --from=ffmpeg-static /ffmpeg  /usr/local/bin/ffmpeg
COPY --from=ffmpeg-static /ffprobe /usr/local/bin/ffprobe

# ImageMagick (with pango delegate) + emoji + text fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
        imagemagick \
        libmagickcore-6.q16-6-extra \
        fonts-noto-color-emoji \
        fonts-liberation \
        fontconfig \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

# Inter font
RUN mkdir -p /usr/share/fonts/truetype/inter
COPY --from=build /fonts/inter/Inter-Regular.ttf /usr/share/fonts/truetype/inter/Inter-Regular.ttf
RUN fc-cache -fv

# App
RUN adduser --disabled-password --gecos "" ffmpgapi
WORKDIR /home/ffmpgapi
COPY --from=build /usr/src/app .
RUN chown -R ffmpgapi:ffmpgapi /home/ffmpgapi

EXPOSE 3000
USER ffmpgapi
CMD ["node", "app.js"]
