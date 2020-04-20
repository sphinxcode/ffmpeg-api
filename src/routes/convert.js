var express = require('express')
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

var router = express.Router()
const logger = require('../utils/logger.js')


//routes for /convert
//adds conversion type and format to res.locals. to be used in final post function
router.post('/audio/to/mp3', function (req, res,next) {

    res.locals.conversion="audio"
    res.locals.format="mp3"
    next()
});

router.post('/video/to/mp4', function (req, res,next) {

    res.locals.conversion="video"
    res.locals.format="mp4"
    next()
});

router.post('/image/to/jpg', function (req, res,next) {

    res.locals.conversion="image"
    res.locals.format="jpg"
    next()
});

// convert audio or video or image to mp3 or mp4 or jpg
router.post('*', function (req, res,next) {
    let format = res.locals.format;
    let conversion = res.locals.conversion;
    logger.debug(`path: ${req.path}, conversion: ${conversion}, format: ${format}`);
    if (conversion == undefined || format == undefined)
    {
        res.status(400).send("Invalid convert URL. Use one of: /convert/image/to/jpg, /convert/audio/to/mp3 or /convert/video/to/mp4.\n");
        return;
    }

    let ffmpegParams ={
        extension: format
    };
    if (conversion == "image")
    {
        ffmpegParams.outputOptions= ['-pix_fmt yuv422p']
    }
    if (conversion == "audio")
    {
        ffmpegParams.outputOptions=['-codec:a libmp3lame' ]
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

    let savedFile = res.locals.savedFile;
    let outputFile = savedFile + '-output.' + ffmpegParams.extension;
    logger.debug(`begin conversion from ${savedFile} to ${outputFile}`)

    //ffmpeg processing... converting file...
    let ffmpegConvertCommand = ffmpeg(savedFile);
    ffmpegConvertCommand
            .renice(15)
            .outputOptions(ffmpegParams.outputOptions)
            .on('error', function(err) {
                logger.error(`${err}`);
                fs.unlinkSync(savedFile);
                res.writeHead(500, {'Connection': 'close'});
                res.end(JSON.stringify({error: `${err}`}));
            })
            .on('end', function() {
                fs.unlinkSync(savedFile);
                logger.debug(`starting download to client ${savedFile}`);

                res.download(outputFile, null, function(err) {
                    if (err) {
                        logger.error(`download ${err}`);
                    }
                    logger.debug(`deleting ${outputFile}`);
                    if (fs.unlinkSync(outputFile)) {
                        logger.debug(`deleted ${outputFile}`);
                    }
                });
            })
            .save(outputFile);
        
});

module.exports = router