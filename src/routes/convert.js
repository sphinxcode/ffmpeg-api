var express = require('express')
const ffmpeg = require('fluent-ffmpeg');
const constants = require('../constants.js');
const logger = require('../utils/logger.js')
const utils = require('../utils/utils.js')
var router = express.Router()

// Middleware for URL-based requests
router.use('/*/from/url', express.json())

//routes for /convert
//adds conversion type and format to res.locals. to be used in final post function
router.post('/audio/to/mp3', function (req, res,next) {
    res.locals.conversion="audio";
    res.locals.format="mp3";
    return convert(req,res,next);
});

router.post('/audio/to/wav', function (req, res,next) {
    res.locals.conversion="audio";
    res.locals.format="wav";
    return convert(req,res,next);
});

router.post('/video/to/mp4', function (req, res,next) {
    res.locals.conversion="video";
    res.locals.format="mp4";
    return convert(req,res,next);
});

router.post('/image/to/jpg', function (req, res,next) {
    res.locals.conversion="image";
    res.locals.format="jpg";
    return convert(req,res,next);
});

// NEW URL-based routes
router.post('/audio/to/mp3/from/url', function (req, res,next) {
    res.locals.conversion="audio";
    res.locals.format="mp3";
    res.locals.fromUrl=true;
    return convertFromUrl(req,res,next);
});

router.post('/audio/to/wav/from/url', function (req, res,next) {
    res.locals.conversion="audio";
    res.locals.format="wav";
    res.locals.fromUrl=true;
    return convertFromUrl(req,res,next);
});

router.post('/video/to/mp4/from/url', function (req, res,next) {
    res.locals.conversion="video";
    res.locals.format="mp4";
    res.locals.fromUrl=true;
    return convertFromUrl(req,res,next);
});

router.post('/video/to/avi/from/url', function (req, res,next) {
    res.locals.conversion="video";
    res.locals.format="avi";
    res.locals.fromUrl=true;
    return convertFromUrl(req,res,next);
});

router.post('/video/to/mov/from/url', function (req, res,next) {
    res.locals.conversion="video";
    res.locals.format="mov";
    res.locals.fromUrl=true;
    return convertFromUrl(req,res,next);
});

// Audio extraction from video URLs - standalone handler
router.post('/video/extract/audio/from/url', express.json(), function (req, res, next) {
    const { url } = req.body;
    
    if (!url) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'URL parameter is required'}));
        return;
    }
    
    // Get mono parameter from URL query (default to true for single channel)
    const mono = req.query.mono !== 'no';
    
    logger.debug(`Audio extraction from URL: ${url}, mono: ${mono}`);
    
    let outputOptions;
    if (mono) {
        outputOptions = ['-vn', '-codec:a pcm_s16le', '-ar 44100', '-ac 1'];
    } else {
        outputOptions = ['-vn', '-codec:a pcm_s16le', '-ar 44100', '-ac 2'];
    }
    
    // Generate unique output filename
    const timestamp = Date.now();
    let outputFile = `/tmp/extracted-audio-${timestamp}.wav`;
    logger.debug(`Begin audio extraction from ${url} to ${outputFile}`)
    
    //ffmpeg processing... extracting audio from URL...
    let ffmpegCommand = ffmpeg(url);
    ffmpegCommand
            .renice(constants.defaultFFMPEGProcessPriority)
            .outputOptions(outputOptions)
            .on('error', function(err) {
                logger.error(`Audio extraction error: ${err}`);
                res.writeHead(500, {'Connection': 'close'});
                res.end(JSON.stringify({error: `Audio extraction failed: ${err}`}));
            })
            .on('end', function() {
                logger.debug(`Audio extraction completed: ${outputFile}`);
                return utils.downloadFile(outputFile, null, req, res, next);
            })
            .save(outputFile);
});

// convert audio or video or image to mp3 or mp4 or jpg
function convert(req,res,next) {
    let format = res.locals.format;
    let conversion = res.locals.conversion;
    logger.debug(`path: ${req.path}, conversion: ${conversion}, format: ${format}`);
    
    let ffmpegParams ={
        extension: format
    };
    
    if (conversion == "image")
    {
        ffmpegParams.outputOptions= ['-pix_fmt yuv422p'];
    }
    
    if (conversion == "audio")
    {
        // Get speed parameter from URL query (default to 1.0 if not provided)
        const speed = parseFloat(req.query.speed) || 1.0;
        
        // Build atempo filter for speeds > 2.0 (FFmpeg limitation)
        let atempoFilter = '';
        if (speed !== 1.0) {
            if (speed <= 2.0) {
                atempoFilter = `atempo=${speed}`;
            } else {
                // For speeds > 2.0, chain multiple atempo filters
                let remainingSpeed = speed;
                let filters = [];
                while (remainingSpeed > 2.0) {
                    filters.push('atempo=2.0');
                    remainingSpeed = remainingSpeed / 2.0;
                }
                if (remainingSpeed > 1.0) {
                    filters.push(`atempo=${remainingSpeed}`);
                }
                atempoFilter = filters.join(',');
            }
        }
        
        if (format === "mp3")
        {
            ffmpegParams.outputOptions=['-codec:a libmp3lame'];
            if (atempoFilter) {
                ffmpegParams.outputOptions.push(`-filter:a ${atempoFilter}`);
            }
        }
        if (format === "wav")
        {
            ffmpegParams.outputOptions=['-codec:a pcm_s16le'];
            if (atempoFilter) {
                ffmpegParams.outputOptions.push(`-filter:a ${atempoFilter}`);
            }
        }
    }
    
    if (conversion == "extract_audio")
    {
        // Get mono parameter from URL query (default to true for single channel)
        const mono = req.query.mono !== 'no';
        
        if (mono) {
            ffmpegParams.outputOptions=['-vn', '-codec:a pcm_s16le', '-ar 44100', '-ac 1'];
        } else {
            ffmpegParams.outputOptions=['-vn', '-codec:a pcm_s16le', '-ar 44100', '-ac 2'];
        }
    }
    
    if (conversion == "video")
    {
        if (format === "mp4") {
            ffmpegParams.outputOptions=[
                '-codec:v libx264',
                '-profile:v high',
                '-r 15',
                '-crf 23',
                '-preset ultrafast',
                '-b:v 500k',
                '-maxrate 500k',
                '-bufsize 1000k',
                '-vf scale=-2:640',
                '-threads 8',
                '-codec:a libfdk_aac',
                '-b:a 128k',
            ];
        } else if (format === "avi") {
            ffmpegParams.outputOptions=[
                '-codec:v libx264',
                '-codec:a libmp3lame',
                '-b:a 128k',
            ];
        } else if (format === "mov") {
            ffmpegParams.outputOptions=[
                '-codec:v libx264',
                '-codec:a aac',
                '-b:a 128k',
            ];
        }
    }
    
    let savedFile = res.locals.savedFile;
    let outputFile = savedFile + '-output.' + ffmpegParams.extension;
    logger.debug(`begin conversion from ${savedFile} to ${outputFile}`)
    
    //ffmpeg processing... converting file...
    let ffmpegConvertCommand = ffmpeg(savedFile);
    ffmpegConvertCommand
            .renice(constants.defaultFFMPEGProcessPriority)
            .outputOptions(ffmpegParams.outputOptions)
            .on('error', function(err) {
                logger.error(`${err}`);
                utils.deleteFile(savedFile);
                res.writeHead(500, {'Connection': 'close'});
                res.end(JSON.stringify({error: `${err}`}));
            })
            .on('end', function() {
                utils.deleteFile(savedFile);
                return utils.downloadFile(outputFile,null,req,res,next);
            })
            .save(outputFile);
        
}

// NEW FUNCTION: convert from URL
function convertFromUrl(req,res,next) {
    const { url } = req.body;
    
    if (!url) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'URL parameter is required'}));
        return;
    }
    
    let format = res.locals.format;
    let conversion = res.locals.conversion;
    logger.debug(`URL conversion - path: ${req.path}, conversion: ${conversion}, format: ${format}, url: ${url}`);
    
    let ffmpegParams ={
        extension: format
    };
    
    if (conversion == "image")
    {
        ffmpegParams.outputOptions= ['-pix_fmt yuv422p'];
    }
    
    if (conversion == "audio")
    {
        // Get speed parameter from URL query (default to 1.0 if not provided)
        const speed = parseFloat(req.query.speed) || 1.0;
        
        // Build atempo filter for speeds > 2.0 (FFmpeg limitation)
        let atempoFilter = '';
        if (speed !== 1.0) {
            if (speed <= 2.0) {
                atempoFilter = `atempo=${speed}`;
            } else {
                // For speeds > 2.0, chain multiple atempo filters
                let remainingSpeed = speed;
                let filters = [];
                while (remainingSpeed > 2.0) {
                    filters.push('atempo=2.0');
                    remainingSpeed = remainingSpeed / 2.0;
                }
                if (remainingSpeed > 1.0) {
                    filters.push(`atempo=${remainingSpeed}`);
                }
                atempoFilter = filters.join(',');
            }
        }
        
        if (format === "mp3")
        {
            ffmpegParams.outputOptions=['-codec:a libmp3lame'];
            if (atempoFilter) {
                ffmpegParams.outputOptions.push(`-filter:a ${atempoFilter}`);
            }
        }
        if (format === "wav")
        {
            ffmpegParams.outputOptions=['-codec:a pcm_s16le'];
            if (atempoFilter) {
                ffmpegParams.outputOptions.push(`-filter:a ${atempoFilter}`);
            }
        }
    }
    
    if (conversion == "video")
    {
        ffmpegParams.outputOptions=[
            '-codec:v libx264',
            '-profile:v high',
            '-r 15',
            '-crf 23',
            '-preset ultrafast',
            '-b:v 500k',
            '-maxrate 500k',
            '-bufsize 1000k',
            '-vf scale=-2:640',
            '-threads 8',
            '-codec:a libfdk_aac',
            '-b:a 128k',
        ];
    }
    
    // Generate unique output filename
    const timestamp = Date.now();
    let outputFile = `/tmp/converted-${timestamp}.${ffmpegParams.extension}`;
    logger.debug(`begin URL conversion from ${url} to ${outputFile}`)
    
    //ffmpeg processing... converting from URL...
    let ffmpegConvertCommand = ffmpeg(url);
    ffmpegConvertCommand
            .renice(constants.defaultFFMPEGProcessPriority)
            .outputOptions(ffmpegParams.outputOptions)
            .on('error', function(err) {
                logger.error(`URL conversion error: ${err}`);
                res.writeHead(500, {'Connection': 'close'});
                res.end(JSON.stringify({error: `URL conversion failed: ${err}`}));
            })
            .on('end', function() {
                logger.debug(`URL conversion completed: ${outputFile}`);
                return utils.downloadFile(outputFile,null,req,res,next);
            })
            .save(outputFile);
}

module.exports = router
