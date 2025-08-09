var express = require('express')
const ffmpeg = require('fluent-ffmpeg');
const constants = require('../constants.js');
const logger = require('../utils/logger.js')
const utils = require('../utils/utils.js')
var router = express.Router()

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

// URL-based routes (existing)
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

// Audio extraction from video URLs
router.post('/video/extract/audio/from/url', function (req, res,next) {
    res.locals.conversion="extract_audio";
    res.locals.format="wav";
    res.locals.fromUrl=true;
    return convertFromUrl(req,res,next);
});

// NEW: Google Drive optimized routes
router.post('/audio/to/mp3/from/gdrive', function (req, res,next) {
    res.locals.conversion="audio";
    res.locals.format="mp3";
    res.locals.fromUrl=true;
    res.locals.gdrive=true;
    return convertFromUrl(req,res,next);
});

router.post('/video/extract/audio/from/gdrive', function (req, res,next) {
    res.locals.conversion="extract_audio";
    res.locals.format="wav";
    res.locals.fromUrl=true;
    res.locals.gdrive=true;
    return convertFromUrl(req,res,next);
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
                '-codec:a aac', // Changed from libfdk_aac for compatibility
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

// Google Drive URL processor to extract file ID
function processGoogleDriveUrl(driveUrl) {
    let fileId = null;
    
    const patterns = [
        /\/file\/d\/([a-zA-Z0-9-_]+)/,  // /file/d/FILE_ID
        /id=([a-zA-Z0-9-_]+)/,          // id=FILE_ID
        /\/open\?id=([a-zA-Z0-9-_]+)/   // /open?id=FILE_ID
    ];
    
    for (const pattern of patterns) {
        const match = driveUrl.match(pattern);
        if (match) {
            fileId = match[1];
            break;
        }
    }
    
    if (!fileId) {
        throw new Error('Invalid Google Drive URL format');
    }
    
    return fileId;
}

// Research-backed Google Drive bypass methods (fixed FFmpeg syntax)
function getGoogleDriveDirectUrls(fileId) {
    return [
        // Method 1: Confirmation bypass (most reliable for large files)
        `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`,
        
        // Method 2: Alternative export endpoint
        `https://docs.google.com/uc?export=download&id=${fileId}&confirm=t`,
        
        // Method 3: Using googleusercontent domain
        `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
        
        // Method 4: Direct with authuser parameter
        `https://drive.google.com/uc?export=download&id=${fileId}&authuser=0&confirm=t`
    ];
}

// Enhanced convertFromUrl with FIXED FFmpeg options
function convertFromUrl(req,res,next) {
    // Ensure we can read JSON body
    if (!req.body) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'Request body is required'}));
        return;
    }
    
    const { url } = req.body;
    
    if (!url) {
        res.writeHead(400, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'URL parameter is required in request body'}));
        return;
    }
    
    let format = res.locals.format;
    let conversion = res.locals.conversion;
    let processedUrl = url;
    
    logger.debug(`URL conversion - path: ${req.path}, conversion: ${conversion}, format: ${format}, url: ${url}`);
    
    // Process Google Drive URLs with bypass methods
    if (url.includes('drive.google.com')) {
        try {
            const fileId = processGoogleDriveUrl(url);
            const directUrls = getGoogleDriveDirectUrls(fileId);
            
            // Use the first bypass method (most reliable)
            processedUrl = directUrls[0];
            
            logger.info(`Google Drive bypass applied for file ID: ${fileId}`);
            logger.debug(`Using bypass URL: ${processedUrl}`);
            
        } catch (error) {
            logger.error(`Google Drive URL processing failed: ${error.message}`);
            res.writeHead(400, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({error: `Google Drive URL error: ${error.message}`}));
            return;
        }
    }
    
    let ffmpegParams = {
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
                '-codec:a aac', // Changed from libfdk_aac for better compatibility
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
    
    // Generate unique output filename
    const timestamp = Date.now();
    let outputFile = `/tmp/converted-${timestamp}.${ffmpegParams.extension}`;
    logger.debug(`begin URL conversion from ${processedUrl} to ${outputFile}`)
    
    // FIXED: Corrected FFmpeg input options (no more syntax errors)
    let inputOptions = [
        '-reconnect', '1',               // Auto-reconnect on connection loss
        '-reconnect_streamed', '1',      // Reconnect for streamed content  
        '-reconnect_delay_max', '5',     // Max delay between reconnects
        '-timeout', '60000000',          // 60 second timeout (microseconds)
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', // Fixed: separate value
        '-multiple_requests', '1',       // Allow multiple HTTP requests
        '-seekable', '0'                 // Don't assume stream is seekable
    ];
    
    //ffmpeg processing... converting from URL...
    let ffmpegConvertCommand = ffmpeg(processedUrl);
    ffmpegConvertCommand
            .renice(constants.defaultFFMPEGProcessPriority)
            .inputOptions(inputOptions)
            .outputOptions(ffmpegParams.outputOptions)
            .on('error', function(err) {
                logger.error(`URL conversion error: ${err}`);
                
                // If Google Drive and first method fails, try alternative URLs
                if (url.includes('drive.google.com') && processedUrl.includes('confirm=t')) {
                    logger.warn('Primary Google Drive bypass failed, trying alternatives...');
                    
                    try {
                        const fileId = processGoogleDriveUrl(url);
                        const alternativeUrls = getGoogleDriveDirectUrls(fileId);
                        
                        // Try second bypass method
                        if (alternativeUrls.length > 1) {
                            const fallbackUrl = alternativeUrls[1];
                            logger.info(`Retrying with alternative URL: ${fallbackUrl}`);
                            
                            // Use simpler options for fallback
                            let simpleInputOptions = [
                                '-timeout', '60000000',
                                '-user_agent', 'Mozilla/5.0'
                            ];
                            
                            let retryCommand = ffmpeg(fallbackUrl);
                            retryCommand
                                .renice(constants.defaultFFMPEGProcessPriority)
                                .inputOptions(simpleInputOptions)
                                .outputOptions(ffmpegParams.outputOptions)
                                .on('error', function(retryErr) {
                                    logger.error(`Alternative URL also failed: ${retryErr}`);
                                    // Safe file cleanup - check if file exists first
                                    try {
                                        utils.deleteFile(outputFile);
                                    } catch (cleanupErr) {
                                        logger.debug('File cleanup error (expected for non-existent files)');
                                    }
                                    res.writeHead(500, {'Connection': 'close'});
                                    res.end(JSON.stringify({error: `Google Drive conversion failed: ${retryErr.message}`}));
                                })
                                .on('end', function() {
                                    logger.debug(`Alternative URL conversion completed: ${outputFile}`);
                                    return utils.downloadFile(outputFile,null,req,res,next);
                                })
                                .save(outputFile);
                            return;
                        }
                    } catch (e) {
                        logger.error(`Alternative bypass failed: ${e.message}`);
                    }
                }
                
                // Original error handling with safe cleanup
                try {
                    utils.deleteFile(outputFile);
                } catch (cleanupErr) {
                    logger.debug('File cleanup error (expected for non-existent files)');
                }
                res.writeHead(500, {'Connection': 'close'});
                res.end(JSON.stringify({error: `URL conversion failed: ${err.message}`}));
            })
            .on('progress', function(progress) {
                if (progress.percent) {
                    logger.debug(`Processing: ${Math.round(progress.percent)}% done`);
                }
            })
            .on('end', function() {
                logger.debug(`URL conversion completed: ${outputFile}`);
                return utils.downloadFile(outputFile,null,req,res,next);
            })
            .save(outputFile);
}

module.exports = router
