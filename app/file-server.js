'use strict';

const psychokinesis = require('psychokinesis');
const path = require('path');
const url = require('url');
const fs = require('fs');
const _ = require('lodash');
const send = require('send');
const xdgBasedir = require('xdg-basedir');
const winston = require('winston');
const os = require('os');
const readdirp = require('readdirp');
const zipstream = require('zip-stream');
const async = require('async');


const configDir = path.join(xdgBasedir.config || path.join(os.tmpdir(), '.config'), 'freeshare');


let instance = null;

class FileServer {
    constructor(store) {
        if (!instance) {
            instance = this;
        }

        instance.store = store;
        return instance;
    }

    setConfig(config) {
        this.config = _.defaultsDeep(config, {
            nodeIdFile: path.join(configDir, 'nodeid.data'),
            domain: 'test.com'
        });
    }

    start(cb) {
        if (this.started) {
            cb();
            return;
        }

        fs.readFile(path.join(configDir, 'files.json'), (err, data) => {
            if (err) {
                this.fileMap = new Map();
            } else {
                this.fileMap = new Map(JSON.parse(data));
            }

            this.psyc = psychokinesis.createServer(this.config, (req, resp) => {
                let reqUrl = url.parse(req.url);
                let filename = decodeURI(path.basename(reqUrl.pathname));

                if (!this.fileMap.has(filename)) {
                    resp.end(filename + ' not found');
                    return;
                }

                let fileInfo = this.fileMap.get(filename);
                let filepath = fileInfo.path;

                if (fileInfo.type === 1) {
                    readdirp({ root: filepath }, function (err, items) {
                        resp.setHeader('Content-Type', 'application/zip');
                        resp.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

                        const zip = zipstream();
                        zip.pipe(resp);

                        async.forEachSeries(items.files, (file, cb) => {
                            zip.entry(fs.createReadStream(file.fullPath), { name: file.path }, cb);
                        }, (err) => {
                            if (err) {
                                resp.statusCode = 500;
                                resp.end(err);
                                return;
                            }

                            zip.finalize();
                        });
                    });
                } else {
                    send(req, filepath).on('error', function (err) {
                        resp.statusCode = err.status || 500;
                        resp.end(err.message);
                    }).pipe(resp);
                }
            });

            this.psyc.on('ready', () => {
                if (this.config.domain === 'localhost') {
                    let ifaces = os.networkInterfaces();
                    Object.keys(ifaces).forEach((dev) => {
                        ifaces[dev].forEach((details) => {
                            if (this.ip) return;

                            if (details.family === 'IPv4' && details.address !== '127.0.0.1') {
                                this.ip = details.address;
                            }
                        });
                    });

                    this.psyc.listen(this.ip, 8181, () => {
                        this.started = true;
                        cb();
                    });
                } else {
                    this.started = true;
                    cb();
                }
            });

            this.psyc.on('error', (err) => {
                winston.error('file server error:', err);
            });
        });
    }

    addFile(filepath, cb) {
        let filename = path.basename(filepath);
        let fileType = 0;                         // file

        if (fs.lstatSync(filepath).isDirectory()) {
            filename += '.zip';
            fileType = 1;                         // directory
        }

        if (this.fileMap.has(filename)) {
            cb({ desc: 'file name exists' });
            return;
        }

        const fileInfo = {
            key: filename,
            path: filepath,
            type: fileType,
            storeState: 0
        };

        this.fileMap.set(fileInfo.key, fileInfo);
        this._persistent((error) => {
            cb(error, this._covertFileInfo(fileInfo))
        });
    }

    storeFile(filename, cb) {
        if (!this.fileMap.has(filename)) {
            cb({ desc: 'file doesn\'t exists' });
            return;
        }

        const fileInfo = this.fileMap.get(filename);

        if (fileInfo.type === 1) {
            cb({ desc: 'directory is not supported yet' });
            return;
        }

        this.store.addFile(fileInfo);

        fileInfo.storeState = 1;

        this._persistent(cb);
    }

    removeFile(filename, cb) {
        if (!this.fileMap.has(filename)) {
            cb({ desc: 'file doesn\'t exists' });
            return;
        }

        this.fileMap.delete(filename);
        this._persistent(cb);
    }

    forEachFile(cb) {
        this.fileMap.forEach((fileInfo, filename) => {
            cb(this._covertFileInfo(fileInfo))
        })
    }

    _persistent(cb) {
        let filesArray = Array.from(this.fileMap);

        fs.writeFile(path.join(configDir, 'files.json'), JSON.stringify(filesArray), cb);
    }

    _covertFileInfo(fileInfo) {
        const filename = fileInfo.key;
        let fileURL;
        if (this.config.domain === 'localhost') {
            fileURL = 'http://' + path.join(this.ip + ':8181', this.config.domain, filename).replace(/\\/g, '\/');
        } else {
            fileURL = 'http://' + path.join(this.config.entryNode.host + ':' + (this.config.entryNode.dhtPort ? this.config.entryNode.dhtPort : this.config.port), this.config.domain, filename).replace(/\\/g, '\/');
        }

        return {
            name: filename,
            url: fileURL,
            type: fileInfo.type,
            storeState: fileInfo.storeState
        }
    }
}


module.exports = FileServer;