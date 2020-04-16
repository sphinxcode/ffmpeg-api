# ffmpeg API

An web service for converting audio/video files using FFMPEG.

Sources: https://github.com/samisalkosuo/ffmpeg-api.

Based on:

- https://github.com/surebert/docker-ffmpeg-service
- https://github.com/jrottenberg/ffmpeg 
- https://github.com/fluent-ffmpeg/node-fluent-ffmpeg


### Endpoints

- `POST /mp3` - Convert audio file in request body to mp3
- `POST /mp4` - Convert video file in request body to mp4
- `POST /jpg` - Convert image file to jpg
- `GET /` - Web Service Readme, this file

### Examples

- `curl -F "file=@input.wav" 127.0.0.1:3000/mp3  > output.mp3`
- `curl -F "file=@input.m4a" 127.0.0.1:3000/mp3  > output.mp3`
- `curl -F "file=@input.mov" 127.0.0.1:3000/mp4  > output.mp4`
- `curl -F "file=@input.mp4" 127.0.0.1:3000/mp4  > output.mp4`
- `curl -F "file=@input.tiff" 127.0.0.1:3000/jpg  > output.jpg`
- `curl -F "file=@input.png" 127.0.0.1:3000/jpg  > output.jpg`


