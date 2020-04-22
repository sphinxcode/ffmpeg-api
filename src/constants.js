
exports.fileSizeLimit = parseInt(process.env.FILE_SIZE_LIMIT_BYTES || "536870912"); //536870912 = 512MB 
exports.defaultFFMPEGProcessPriority=10;
exports.serverPort = 3000;//port to listen, NOTE: if using Docker/Kubernetes this port may not be the one clients are using
exports.keepAllFiles = process.env.KEEP_ALL_FILES || "false"; //if true, do not delete any uploaded/generated files
