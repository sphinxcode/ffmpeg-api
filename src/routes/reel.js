var express = require('express')
const ffmpeg = require('fluent-ffmpeg');
const logger = require('../utils/logger.js')
const utils = require('../utils/utils.js')
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
var router = express.Router()

function downloadToTemp(url) {
    return new Promise((resolve, reject) => {
        const timestamp = Date.now();
        const ext = path.extname(new URL(url).pathname) || '.mp3';
        const tmpPath = `/tmp/audio-${timestamp}${ext}`;
        const file = fs.createWriteStream(tmpPath);

        function fetch(currentUrl) {
            const mod = currentUrl.startsWith('https') ? https : http;
            mod.get(currentUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
                if ([301, 302, 307, 308].includes(res.statusCode)) {
                    return fetch(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    file.close();
                    fs.unlink(tmpPath, () => {});
                    return reject(new Error(`Audio download failed: HTTP ${res.statusCode}`));
                }
                res.pipe(file);
                file.on('finish', () => file.close(() => resolve(tmpPath)));
                file.on('error', (err) => { fs.unlink(tmpPath, () => {}); reject(err); });
            }).on('error', (err) => { fs.unlink(tmpPath, () => {}); reject(err); });
        }

        fetch(url);
    });
}

const FONTS = {
    inter:     '/usr/share/fonts/truetype/inter/Inter-Regular.ttf',
    helvetica: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
};
const DEFAULT_FONT       = 'inter';
const DEFAULT_BRIGHTNESS = -0.35;
const DEFAULT_DURATION   = 7;
const DEFAULT_FPS        = 24;
const DEFAULT_FONT_SIZE  = 48;
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
// Body (JSON): {
//   video_url,  text,        brightness?,  duration?,
//   font?,      font_size?,  emoji?,       audio_url?
// }
router.post('/render', async function(req, res, next) {
    const {
        video_url, text,
        brightness, duration,
        font, font_size,
        emoji, audio_url, audio_start,
        text_position
    } = req.body;

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

    const bri      = parseFloat(brightness) || DEFAULT_BRIGHTNESS;
    const dur      = parseInt(duration)     || DEFAULT_DURATION;
    const fontSize = parseInt(font_size)    || DEFAULT_FONT_SIZE;
    const fontKey  = (font || DEFAULT_FONT).toLowerCase();
    const fontPath = FONTS[fontKey] || FONTS[DEFAULT_FONT];
    const timestamp = Date.now();
    const outputFile = `/tmp/reel-${timestamp}.mp4`;

    // Split, word-wrap, cap at 4 lines, optionally append emoji to last line
    const inputLines = text.split('\n').filter(l => l.trim());
    let lines = inputLines.flatMap(l => wordWrap(l)).slice(0, 4);
    if (emoji && lines.length > 0) {
        lines[lines.length - 1] = lines[lines.length - 1] + ' ' + emoji;
    }

    const lineHeight    = Math.round(fontSize * 1.3);
    const totalHeight   = lines.length * lineHeight;
    const position      = (text_position || 'center').toLowerCase();

    const drawtextFilters = lines.map((line, i) => {
        // center: vertically center the whole text block
        // bottom: anchor to lower portion (140px from bottom)
        const yPos = position === 'bottom'
            ? `h-${140 + (lines.length - 1 - i) * lineHeight}`
            : `(h-${totalHeight})/2+${i * lineHeight}`;
        const escaped = escapeDrawtext(line.trim());
        return `drawtext=fontfile=${fontPath}:text='${escaped}':fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=${yPos}:borderw=0`;
    }).join(',');

    const videoFilter = `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,eq=brightness=${bri},${drawtextFilters}`;

    logger.debug(`reel render — font: ${fontKey}, size: ${fontSize}, brightness: ${bri}, dur: ${dur}s, emoji: ${emoji || 'none'}, audio: ${audio_url || 'none'}`);

    let localAudioPath = null;

    try {
        if (audio_url) {
            logger.debug(`downloading audio: ${audio_url}`);
            localAudioPath = await downloadToTemp(audio_url);
            logger.debug(`audio saved to: ${localAudioPath}`);
        }
    } catch (err) {
        logger.error(`audio download error: ${err}`);
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: `Audio download failed: ${err.message}` }));
        return;
    }

    let cmd = ffmpeg(video_url);

    if (localAudioPath) {
        const audioSeek = parseFloat(audio_start) || 0;
        cmd.addInput(localAudioPath).inputOptions(audioSeek > 0 ? [`-ss ${audioSeek}`] : []);
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
            if (localAudioPath) fs.unlink(localAudioPath, () => {});
            res.writeHead(500, {'Connection': 'close'});
            res.end(JSON.stringify({ error: `Render failed: ${err.message}` }));
        })
        .on('end', function() {
            logger.debug(`reel render complete: ${outputFile}`);
            if (localAudioPath) fs.unlink(localAudioPath, () => {});
            return utils.downloadFile(outputFile, null, req, res, next);
        })
        .save(outputFile);
});

module.exports = router;
