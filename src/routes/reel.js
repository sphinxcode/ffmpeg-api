var express = require('express')
const ffmpeg = require('fluent-ffmpeg');
const logger = require('../utils/logger.js')
const utils = require('../utils/utils.js')
var router = express.Router()

const FONT_PATH = '/usr/share/fonts/truetype/freefont/FreeSans.ttf';
const DEFAULT_BRIGHTNESS = -0.4;
const DEFAULT_DURATION = 7;
const DEFAULT_FPS = 24;

function escapeDrawtext(text) {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\u2019")   // smart quote — avoids drawtext escape hell
        .replace(/:/g, '\\:')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/,/g, '\\,');
}

// POST /reel/render
// Body (JSON): { video_url, text, brightness?, duration?, audio_url? }
router.post('/render', function(req, res, next) {
    const { video_url, text, brightness, duration, audio_url } = req.body;

    if (!video_url) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: 'video_url is required' }));
        return;
    }
    if (!text) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: 'text is required' }));
        return;
    }

    const bri = parseFloat(brightness) || DEFAULT_BRIGHTNESS;
    const dur = parseInt(duration) || DEFAULT_DURATION;
    const timestamp = Date.now();
    const outputFile = `/tmp/reel-${timestamp}.mp4`;

    const lines = text.split('\n').filter(l => l.trim()).slice(0, 3);
    const lineHeight = 62;
    const bottomMargin = 100;

    const drawtextFilters = lines.map((line, i) => {
        const yPos = `h-${bottomMargin + (lines.length - 1 - i) * lineHeight}`;
        const escaped = escapeDrawtext(line.trim());
        return `drawtext=fontfile=${FONT_PATH}:text='${escaped}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=${yPos}:borderw=0`;
    }).join(',');

    const videoFilter = `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,eq=brightness=${bri},${drawtextFilters}`;

    logger.debug(`reel render — url: ${video_url}, lines: ${lines.length}, brightness: ${bri}, duration: ${dur}s, audio: ${audio_url || 'none'}`);

    let cmd = ffmpeg(video_url);

    if (audio_url) {
        cmd.addInput(audio_url);
        cmd.complexFilter([
            `[0:v]${videoFilter}[v]`,
            `[1:a]volume=-20dB[a]`
        ])
        .outputOptions([
            '-map [v]',
            '-map [a]',
            `-t ${dur}`,
            `-r ${DEFAULT_FPS}`,
            '-c:v libx264',
            '-preset fast',
            '-crf 23',
            '-c:a aac',
            '-b:a 128k',
            '-shortest'
        ]);
    } else {
        cmd.videoFilters(videoFilter)
        .outputOptions([
            `-t ${dur}`,
            `-r ${DEFAULT_FPS}`,
            '-c:v libx264',
            '-preset fast',
            '-crf 23',
            '-an'
        ]);
    }

    cmd
        .on('error', function(err) {
            logger.error(`reel render error: ${err}`);
            res.writeHead(500, {'Connection': 'close'});
            res.end(JSON.stringify({ error: `Render failed: ${err.message}` }));
        })
        .on('end', function() {
            logger.debug(`reel render complete: ${outputFile}`);
            return utils.downloadFile(outputFile, null, req, res, next);
        })
        .save(outputFile);
});

module.exports = router;
