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
    constructor(store, triggerUpdateFilesView) {
        if (!instance) {
            instance = this;
        }

        instance.store = store;
        instance.triggerUpdateFilesView = triggerUpdateFilesView;
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

        fs.readFile(path.join(configDir, 'files_v2.json'), 'utf8', (err, data) => {
            if (err) {
                this.fileMap = new Map();
            } else {
                this.fileMap = new Map(JSON.parse(data));
            }

            this.fileMap.forEach((fileInfo, filename) => {
                const partitions = fileInfo.partitions;
                if (!partitions) return;

                // reset online
                partitions.forEach(p => p.online = 0);
            });

            this.psyc = psychokinesis.createServer(this.config, (req, resp) => {
                let reqUrl = url.parse(req.url);
                let filename = decodeURI(path.basename(reqUrl.pathname));
                let dir = decodeURI(path.dirname(reqUrl.pathname));

                if (dir === '/chunks') {
                    this.store.handleRequest(filename, req, resp);
                    return;
                }

                if (!this.fileMap.has(filename)) {
                    resp.end(filename + ' not found');
                    return;
                }

                let fileInfo = this.fileMap.get(filename);
                let filepath = fileInfo.path;

                if (fileInfo.type === 1) {
                    readdirp({ root: filepath }, function (err, items) {
                        resp.setHeader('Content-Type', 'application/zip');
                        resp.setHeader('Content-Disposition', 'attachment; filename="' + encodeURI(filename) + '"');

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

            this.refreshInterval = setInterval(() => {
                this._fetchFileContributors();
            }, 10 * 1000);
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

    storeFile(filename, storeCB, finishCB) {
        if (!this.fileMap.has(filename)) {
            storeCB({ desc: 'file doesn\'t exists' });
            return;
        }

        const fileInfo = this.fileMap.get(filename);

        if (fileInfo.type === 1) {
            storeCB({ desc: 'directory is not supported yet' });
            return;
        }

        this.store.addFile(fileInfo).then((storeInfo) => {
            fileInfo.storeId = storeInfo.id;
            fileInfo.partitions = storeInfo.partitions;
            fileInfo.storeState = 2;
            this._persistent(storeCB);

            finishCB();
        }, (error) => {
            finishCB(error);
        });

        fileInfo.storeState = 1;

        this._persistent(storeCB);
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

        fs.writeFile(path.join(configDir, 'files_v2.json'), JSON.stringify(filesArray), cb);
    }

    _covertFileInfo(fileInfo) {
        const filename = fileInfo.key;
        let fileURL;
        if (this.config.domain === 'localhost') {
            fileURL = 'http://' + path.join(this.ip + ':8181', this.config.domain, filename).replace(/\\/g, '\/');
        } else {
            const host = this.config.entryNode.host + ':' + (this.config.entryNode.dhtPort ? this.config.entryNode.dhtPort : this.config.port);

            if (fileInfo.storeId != null) {
                fileURL = 'http://' + path.join(host, 'offline', fileInfo.storeId.toString()).replace(/\\/g, '\/');
            } else {
                fileURL = 'http://' + path.join(host, this.config.domain, filename).replace(/\\/g, '\/');
            }
        }

        let storeRate;
        if (fileInfo.partitions) {
            const total = fileInfo.partitions.reduce((a, p) => {
                return a + (p.online || 0);
            }, 0);

            storeRate = total / fileInfo.partitions.length;
        }

        return {
            name: filename,
            url: fileURL,
            type: fileInfo.type,
            storeState: fileInfo.storeState,
            storeRate: storeRate
        }
    }

    _fetchFileContributors() {
        this.fileMap.forEach((fileInfo, filename) => {
            const partitions = fileInfo.partitions;
            if (!partitions) return;

            const partitionsArray = partitions.map(p => p.hash);

            this.store.listPartitionContributors(partitionsArray, (error, contributors) => {
                if (error) {
                    winston.error('fetch file contributors error:', error);
                    return;
                }

                contributors.forEach((c, i) => {
                    partitions[i].online = c.length;
                });

                this.triggerUpdateFilesView();
            });
        })
    }
}


module.exports = FileServer;