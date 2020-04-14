const fs = require('fs');
const express = require('express');
const app = express();
const Busboy = require('busboy');
const compression = require('compression');
const ffmpeg = require('fluent-ffmpeg');
const uniqueFilename = require('unique-filename');
const endpoints = require('./endpoints.js');

//const winston = require('winston');
//setup custom logger
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, printf } = format;

const logFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${label}] ${level}: ${message}`;
});

const logger = createLogger({
  format: combine(    
    label({ label: 'ffmpegapi' }),
    timestamp(),
    logFormat
  ),
  transports: [new transports.Console({
    level: process.env.LOG_LEVEL || 'info'
  })]
});

//constants
fileSizeLimit = 524288000;
port = 3000;
timeout = 3600000;

// catch SIGINT and SIGTERM and exit
// Using a single function to handle multiple signals
function handle(signal) {
    console.log(`Received ${signal}. Exiting...`);
    process.exit(1)
  }  
//SIGINT is typically CTRL-C
process.on('SIGINT', handle);
//SIGTERM is sent to terminate process, for example docker stop sends SIGTERM
process.on('SIGTERM', handle);



app.use(compression());

for (let prop in endpoints.types) {
    if (endpoints.types.hasOwnProperty(prop)) {
        let ffmpegParams = endpoints.types[prop];
        let bytes = 0;
        app.post('/' + prop, function(req, res) {
            let hitLimit = false;
            let fileName = '';
            //let savedFile = uniqueFilename(__dirname + '/uploads/');
            let savedFile = uniqueFilename('/tmp/');
            let busboy = new Busboy({
                headers: req.headers,
                limits: {
                    files: 1,
                    fileSize: fileSizeLimit,
            }});
            busboy.on('filesLimit', function() {
                logger.error(JSON.stringify({
                    type: 'filesLimit',
                    message: 'Upload file size limit hit',
                }));
            });

            busboy.on('file', function(
                fieldname,
                file,
                filename,
                encoding,
                mimetype
            ) {
                file.on('limit', function(file) {
                    hitLimit = true;
                    let err = {file: filename, error: 'exceeds max size limit'};
                    err = JSON.stringify(err);
                    logger.error(err);
                    res.writeHead(500, {'Connection': 'close'});
                    res.end(err);
                });
                let log = {
                    file: filename,
                    encoding: encoding,
                    mimetype: mimetype,
                };
                logger.log('debug',JSON.stringify(log));
                file.on('data', function(data) {
                    bytes += data.length;
                });
                file.on('end', function(data) {
                    log.bytes = bytes;
                    logger.log('debug',JSON.stringify(log));
                });

                fileName = filename;
                logger.log('debug',JSON.stringify({
                    action: 'Uploading',
                    name: fileName,
                }));
                let written = file.pipe(fs.createWriteStream(savedFile));

                if (written) {
                    logger.log('debug',JSON.stringify({
                        action: 'saved',
                        path: savedFile,
                    }));
                }
            });
            busboy.on('finish', function() {
                if (hitLimit) {
                    fs.unlinkSync(savedFile);
                    return;
                }
                logger.log('debug',JSON.stringify({
                    action: 'upload complete',
                    name: fileName,
                }));
                let outputFile = savedFile + '.' + ffmpegParams.extension;
                logger.log('debug',JSON.stringify({
                    action: 'begin conversion',
                    from: savedFile,
                    to: outputFile,
                }));
                let ffmpegConvertCommand = ffmpeg(savedFile);
                ffmpegConvertCommand
                        .renice(15)
                        .outputOptions(ffmpegParams.outputOptions)
                        .on('error', function(err) {
                            let log = JSON.stringify({
                                type: 'ffmpeg',
                                message: err,
                            });
                            logger.error(log);
                            fs.unlinkSync(savedFile);
                            res.writeHead(500, {'Connection': 'close'});
                            res.end(log);
                        })
                        .on('end', function() {
                            fs.unlinkSync(savedFile);
                            logger.log('debug',JSON.stringify({
                                action: 'starting download to client',
                                file: savedFile,
                            }));

                            res.download(outputFile, null, function(err) {
                                if (err) {
                                    logger.error(JSON.stringify({
                                        type: 'download',
                                        message: err,
                                    }));
                                }
                                logger.log('debug',JSON.stringify({
                                    action: 'deleting',
                                    file: outputFile,
                                }));
                                if (fs.unlinkSync(outputFile)) {
                                    logger.log('debug',JSON.stringify({
                                        action: 'deleted',
                                        file: outputFile,
                                    }));
                                }
                            });
                        })
                        .save(outputFile);
            });
            return req.pipe(busboy);
        });
    }
}

require('express-readme')(app, {
    filename: 'index.md',
    routes: ['/', '/readme'],
});


const server = app.listen(port, function() {
    let host = server.address().address;
    let port = server.address().port;
    logger.info(JSON.stringify({
        action: 'listening',
        url: 'http://'+host+':'+port,
    }));
});


server.on('connection', function(socket) {
    logger.log('debug',JSON.stringify({
        action: 'new connection',
        timeout: timeout,
    }));
    socket.setTimeout(timeout);
    socket.server.timeout = timeout;
    server.keepAliveTimeout = timeout;
});

app.use(function(req, res, next) {
  res.status(404).send(JSON.stringify({error: 'route not available'})+'\n');
});
