var express = require('express')
const ffmpeg = require('fluent-ffmpeg');
const logger = require('../utils/logger.js')
const utils = require('../utils/utils.js')
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { execFile } = require('child_process');
const util = require('util');
var router = express.Router()

const execFileAsync = util.promisify(execFile);

// ── Audio download helper ────────────────────────────────────────────

function normalizeAudioUrl(url) {
    // tmpfiles.org view page → direct download
    const m = url.match(/^(https?:\/\/tmpfiles\.org\/)(\d+\/.+)$/);
    if (m) return `${m[1]}dl/${m[2]}`;
    return url;
}

function downloadToTemp(url) {
    return new Promise((resolve, reject) => {
        const resolved = normalizeAudioUrl(url);
        const timestamp = Date.now();
        const ext = path.extname(new URL(resolved).pathname) || '.mp3';
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
                const ct = res.headers['content-type'] || '';
                if (ct.includes('text/html')) {
                    file.close();
                    fs.unlink(tmpPath, () => {});
                    return reject(new Error(`Audio URL returned HTML — provide a direct download link`));
                }
                res.pipe(file);
                file.on('finish', () => file.close(() => resolve(tmpPath)));
                file.on('error', (err) => { fs.unlink(tmpPath, () => {}); reject(err); });
            }).on('error', (err) => { fs.unlink(tmpPath, () => {}); reject(err); });
        }

        fetch(resolved);
    });
}

// ── Text + emoji overlay (ImageMagick pango + Twemoji CDN) ───────────
//
// FFmpeg drawtext has no color-emoji support (no FT_LOAD_COLOR upstream).
// Pango/fontconfig also returns "No glyph" for CBDT emoji on many Debian
// configs. Solution: fetch emoji as PNG from Twemoji CDN (confirmed working
// approach used by pilmoji and similar libraries), composite below text.

const FONT_NAMES = {
    inter:     'Inter',
    helvetica: 'Liberation Sans',
};
const DEFAULT_FONT       = 'inter';
const DEFAULT_BRIGHTNESS = -0.35;
const DEFAULT_DURATION   = 7;
const DEFAULT_FPS        = 24;
const DEFAULT_FONT_SIZE  = 48;
const MAX_CHARS_PER_LINE = 30;

function escapeXml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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

// Convert emoji string to Twemoji filename codepoint (e.g. "📈" → "1f4c8")
function emojiToTwemojiCode(emojiStr) {
    const cps = [];
    for (const char of emojiStr) {
        const cp = char.codePointAt(0);
        if (cp !== undefined && cp !== 0xFE0F) cps.push(cp.toString(16));
    }
    return cps.join('-');
}

// Generic URL fetcher with redirect following (reuses downloadToTemp logic)
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const ts = Date.now() + Math.random().toString(36).slice(2, 6);
        const ext = path.extname(new URL(url).pathname) || '.png';
        const tmpPath = `/tmp/fetch-${ts}${ext}`;
        const file = fs.createWriteStream(tmpPath);

        function get(currentUrl) {
            const mod = currentUrl.startsWith('https') ? https : http;
            mod.get(currentUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
                if ([301, 302, 307, 308].includes(res.statusCode)) return get(res.headers.location);
                if (res.statusCode !== 200) {
                    file.close(); fs.unlink(tmpPath, () => {});
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                res.pipe(file);
                file.on('finish', () => file.close(() => resolve(tmpPath)));
                file.on('error', (err) => { fs.unlink(tmpPath, () => {}); reject(err); });
            }).on('error', (err) => { fs.unlink(tmpPath, () => {}); reject(err); });
        }
        get(url);
    });
}

async function renderTextOverlay(textLines, emoji, fontSize, fontName, position, outputPath) {
    const ts = Date.now();
    const hasEmoji = !!(emoji && emoji.trim());
    const textContent = escapeXml(textLines.join('\n'));
    const markup = `<span font="${fontName} ${fontSize}" foreground="white">${textContent}</span>`;

    if (!hasEmoji) {
        // Text only — pango renders fine
        const posArgs = position === 'bottom'
            ? ['-gravity', 'South', '-splice', '0x140', '-gravity', 'South', '-extent', '720x1280']
            : ['-gravity', 'Center', '-extent', '720x1280'];
        await execFileAsync('convert', [
            '-background', 'none', '-gravity', 'Center', '-size', '720x0', `pango:${markup}`,
            ...posArgs, outputPath
        ]);
        return;
    }

    // With emoji: render text PNG, fetch Twemoji PNG, stack vertically, position on canvas
    const emojiSize  = Math.max(Math.round(fontSize * 1.2), 48);
    const textPng    = `/tmp/text-${ts}.png`;
    const emojiPng   = `/tmp/emoji-${ts}.png`;
    const emojiRow   = `/tmp/emojirow-${ts}.png`;
    const spacerPng  = `/tmp/spacer-${ts}.png`;
    const tmpFiles   = [textPng, emojiPng, emojiRow, spacerPng];

    try {
        // 1. Render text at natural height (720px wide)
        await execFileAsync('convert', [
            '-background', 'none', '-gravity', 'Center', '-size', '720x0', `pango:${markup}`,
            textPng
        ]);

        // 2. Fetch emoji PNG from Twemoji CDN and resize
        const code = emojiToTwemojiCode(emoji.trim());
        const twemojiUrl = `https://cdn.jsdelivr.net/npm/twemoji@14.0.2/assets/72x72/${code}.png`;
        logger.debug(`fetching twemoji: ${twemojiUrl}`);
        const rawPng = await fetchUrl(twemojiUrl);
        tmpFiles.push(rawPng);
        await execFileAsync('convert', [rawPng, '-resize', `${emojiSize}x${emojiSize}`, emojiPng]);

        // 3. Center emoji in a 720-wide transparent row
        await execFileAsync('convert', [
            '-background', 'none', '-size', `720x${emojiSize}`, 'xc:none',
            emojiPng, '-gravity', 'Center', '-composite',
            emojiRow
        ]);

        // 4. 12px transparent spacer between text and emoji
        await execFileAsync('convert', ['-background', 'none', '-size', '720x12', 'xc:none', spacerPng]);

        // 5. Stack text → spacer → emoji row, then position on full 720x1280 canvas
        const gravity = position === 'bottom' ? 'South' : 'Center';
        const spliceArgs = position === 'bottom'
            ? ['-gravity', 'South', '-splice', '0x140'] : [];
        await execFileAsync('convert', [
            '-background', 'none',
            textPng, spacerPng, emojiRow,
            '-append',
            '-gravity', gravity, ...spliceArgs, '-extent', '720x1280',
            outputPath
        ]);
    } finally {
        tmpFiles.forEach(f => fs.unlink(f, () => {}));
    }
}

// ── Route ─────────────────────────────────────────────────────────────

// POST /reel/render
// Body (JSON): {
//   video_url,  text,        brightness?,  duration?,
//   font?,      font_size?,  emoji?,       audio_url?,  audio_start?,  text_position?
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
    const fontName = FONT_NAMES[fontKey] || FONT_NAMES[DEFAULT_FONT];
    const position = (text_position || 'center').toLowerCase();
    const timestamp = Date.now();
    const outputFile = `/tmp/reel-${timestamp}.mp4`;
    const overlayFile = `/tmp/overlay-${timestamp}.png`;

    // Word-wrap text into lines (cap at 4)
    const inputLines = text.split('\n').filter(l => l.trim());
    const lines = inputLines.flatMap(l => wordWrap(l)).slice(0, 4);

    logger.debug(`reel render — font: ${fontKey}, size: ${fontSize}, brightness: ${bri}, dur: ${dur}s, emoji: ${emoji || 'none'}, audio: ${audio_url || 'none'}`);

    // Step 1: render text + emoji overlay PNG via ImageMagick pango
    try {
        await renderTextOverlay(lines, emoji, fontSize, fontName, position, overlayFile);
        logger.debug(`overlay rendered: ${overlayFile}`);
    } catch (err) {
        logger.error(`overlay render error: ${err}`);
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: `Text overlay failed: ${err.message}` }));
        return;
    }

    // Step 2: download audio if provided
    let localAudioPath = null;
    try {
        if (audio_url) {
            logger.debug(`downloading audio: ${audio_url}`);
            localAudioPath = await downloadToTemp(audio_url);
            logger.debug(`audio saved: ${localAudioPath}`);
        }
    } catch (err) {
        logger.error(`audio download error: ${err}`);
        fs.unlink(overlayFile, () => {});
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ error: `Audio download failed: ${err.message}` }));
        return;
    }

    // Step 3: FFmpeg — scale/crop/brightness + overlay PNG
    const videoBase = `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,eq=brightness=${bri}`;

    function cleanup() {
        fs.unlink(overlayFile, () => {});
        if (localAudioPath) fs.unlink(localAudioPath, () => {});
    }

    // inputs: [0]=video  [1]=overlay  [2]=audio (optional)
    let cmd = ffmpeg(video_url);
    cmd.addInput(overlayFile);

    if (localAudioPath) {
        const audioSeek = parseFloat(audio_start) || 0;
        cmd.addInput(localAudioPath).inputOptions(audioSeek > 0 ? [`-ss ${audioSeek}`] : []);
        cmd.complexFilter([
            `[0:v]${videoBase}[v]`,
            `[v][1:v]overlay=0:0[vout]`,
            `[2:a]volume=-20dB[a]`
        ])
        .outputOptions([
            '-map [vout]',
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
        cmd.complexFilter([
            `[0:v]${videoBase}[v]`,
            `[v][1:v]overlay=0:0[vout]`
        ])
        .outputOptions([
            '-map [vout]',
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
            cleanup();
            res.writeHead(500, {'Connection': 'close'});
            res.end(JSON.stringify({ error: `Render failed: ${err.message}` }));
        })
        .on('end', function() {
            logger.debug(`reel render complete: ${outputFile}`);
            cleanup();
            return utils.downloadFile(outputFile, null, req, res, next);
        })
        .save(outputFile);
});

module.exports = router;
