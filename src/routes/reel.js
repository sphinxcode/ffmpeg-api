var express = require('express')
const ffmpeg = require('fluent-ffmpeg');
const logger = require('../utils/logger.js')
const utils = require('../utils/utils.js')
var router = express.Router()

const FONT_PATH = '/usr/share/fonts/truetype/inter/Inter-Regular.ttf';
const DEFAULT_BRIGHTNESS = -0.25;
const DEFAULT_DURATION = 7;
const DEFAULT_FPS = 24;
const FONT_SIZE = 44;
const MAX_CHARS_PER_LINE = 30;

function escapeDrawtext(text) {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '\u2019')
        .replace(/:/g, '\\:')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/,/g, '\\,');
}

// Word-wrap a single line to MAX_CHARS_PER_LINE, returns array of lines
function wordWrap(line) {
    const words = line.trim().split(/\s+/);
    const wrapped = [];
    let current = '';
    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length > MAX_CHARS_PER_LINE && current) {
            wrapped.push(current);
            current = word;
        } else {
            current = candidate;
        }
    }
    if (current) wrapped.push(current);
    return wrapped;
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

    // Split input lines, word-wrap each, cap total at 4 lines
    const inputLines = text.split('\n').filter(l => l.trim());
    const lines = inputLines.flatMap(l => wordWrap(l)).slice(0, 4);

    const lineHeight = 56;
    const bottomMargin = 140;

    const drawtextFilters = lines.map((line, i) => {
        const yPos = `h-${bottomMargin + (lines.length - 1 - i) * lineHeight}`;
        const escaped = escapeDrawtext(line.trim());
        return `drawtext=fontfile=${FONT_PATH}:text='${escaped}':fontcolor=white:fontsize=${FONT_SIZE}:x=(w-text_w)/2:y=${yPos}:borderw=0`;
    }).join(',');

    const videoFilter = `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,eq=brightness=${bri},${drawtextFilters}`;

    logger.debug(`reel render — lines: ${lines.length}, brightness: ${bri}, duration: ${dur}s`);

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
