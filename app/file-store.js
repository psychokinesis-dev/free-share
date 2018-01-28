const os = require('os');
const mkdirp = require('mkdirp');
const path = require('path');
const fs = require('fs');
const splitFile = require('split-file');
const async = require('async');
const xdgBasedir = require('xdg-basedir');
const md5File = require('md5-file');
const request = require('request');
const send = require('send');

const configDir = path.join(xdgBasedir.config || path.join(os.tmpdir(), '.config'), 'freeshare');
const storeDir = path.join(xdgBasedir.data || path.join(os.tmpdir(), '.local'), 'free-share-store');

let instance = null;

class FileStore {
    constructor() {
        if (!instance) {
            instance = this;
        }

        return instance;
    }

    init() {
        this.fileMap = new Map();

        return new Promise((resolve, reject) => {
            fs.readFile(path.join(configDir, 'partitions.json'), 'utf8', (err, data) => {
                if (err) {
                    this.partitionMap = new Map();
                } else {
                    this.partitionMap = new Map(JSON.parse(data));
                }

                mkdirp(storeDir, (err) => {
                    if (err) {
                        console.error('create store path failed:', err);
                        reject(err);
                        return;
                    }

                    this._sync();
                    this._fetchLatestPartitions();

                    this.refreshInterval = setInterval(() => {
                        this._sync();
                    }, 10 * 1000);

                    resolve();
                });
            });
        });
    }

    setConfig(config) {
        this.config = Object.assign({
            nodeIdFile: path.join(configDir, 'nodeid.data'),
            domain: 'test.com'
        }, config);

        this.fileRecorderHost = this.config.entryNode.host + ':3000';
    }

    addFile(fileInfo) {
        this.fileMap.set(fileInfo.key, fileInfo);

        return this._addFileWorker(fileInfo.key);
    }

    handleRequest(filename, request, response) {
        const filePath = path.join(storeDir, filename);

        send(request, filePath).on('error', function(err) {
            response.statusCode = err.status || 500;
            response.end(err.message);
        }).pipe(response);
    }

    listPartitionContributors(partitions, cb) {
        request({
            method: 'POST',
            url: 'http://' + this.fileRecorderHost + '/v1/list-contributor',
            body: {
                partition_hash: partitions
            },
            json: true
        }, (error, httpResponse, body) => {
            if (error || httpResponse.statusCode != 200) {
                cb('request recorder host failed');
                return;
            }

            cb(null, body.contributors);
        });
    }

    _addFileWorker(key) {
        const fileInfo = this.fileMap.get(key);
        const filePath = fileInfo.path;

        return new Promise((resolve, reject) => {
            const dest = path.join(storeDir, key);

            const originalFileStats = fs.statSync(filePath);

            fs.createReadStream(filePath).pipe(fs.createWriteStream(dest)).on('finish', () => {
                splitFile.splitFileBySize(dest, 1024 * 1024)
                    .then((files) => {
                        async.map(files, (file, cb) => {
                            md5File(file, (err, hash) => {
                                if (err) {
                                    return cb(err);
                                }

                                const finalFilePath = path.join(storeDir, hash);
                                fs.rename(file, finalFilePath, (err) => {
                                    if (err) {
                                        return cb(err);
                                    }

                                    cb(null, {
                                        path: finalFilePath,
                                        name: hash
                                    });
                                });
                            });
                        }, (err, files) => {
                            if (err) {
                                return reject(err);
                            }

                            fs.unlink(dest);

                            const partitions = files.map((file) => {
                                this.partitionMap.set(file.name, {
                                    status: 1,
                                    path: file.path
                                });

                                const fileStats = fs.statSync(file.path);

                                return {
                                    hash: file.name,
                                    meta: {
                                        size: fileStats.size
                                    }
                                }
                            });

                            this._persistent();
                            this._sync();

                            request({
                                method: 'POST',
                                url: 'http://' + this.fileRecorderHost + '/v1/create-file',
                                body: {
                                    name: key,
                                    size: originalFileStats.size,
                                    partitions: partitions
                                },
                                json: true
                            }, (error, httpResponse, body) => {
                                if (!error && httpResponse.statusCode == 200) {
                                    resolve({
                                        id: body.id,
                                        partitions: partitions
                                    });
                                } else {
                                    reject(error);
                                }
                            });
                        });
                    })
                    .catch((error) => {
                        console.log(error);
                    })
            });
        });
    }

    _persistent(cb) {
        const partitionsArray = Array.from(this.partitionMap);

        fs.writeFile(path.join(configDir, 'partitions.json'), JSON.stringify(partitionsArray), cb);
    }

    _sync() {
        const partitionsArray = Array.from(this.partitionMap).filter(p => p[1].status === 1).map(p => p[0]);

        request({
            method: 'POST',
            url: 'http://' + this.fileRecorderHost + '/v1/add-contributor',
            body: {
                contributor: this.config.domain,
                partition_hash: partitionsArray
            },
            json: true
        }, (error, httpResponse, body) => {
            if (error || httpResponse.statusCode != 200) {
                // console.log(error, httpResponse.statusCode);
            }
        });
    }

    _fetchLatestPartitions() {
        request({
            method: 'GET',
            url: 'http://' + this.fileRecorderHost + '/v1/list-file?offset=0&limit=10',
            json: true
        }, (error, httpResponse, body) => {
            if (error || httpResponse.statusCode != 200) {
                // console.log(error, httpResponse.statusCode);
                setTimeout(() => {
                    this._fetchLatestPartitions()
                }, 10000);
                return;
            }

            const files = body.rows;

            let latestPartition;
            async.detectSeries(files, (file, callback) => {
                const fileId = file.id;

                request({
                    method: 'GET',
                    url: 'http://' + this.fileRecorderHost + '/v1/detail-file?id=' + fileId,
                    json: true
                }, (error, httpResponse, body) => {
                    if (error || httpResponse.statusCode != 200) {
                        console.log(error, httpResponse.statusCode);
                        callback(error);
                        return;
                    }

                    const partitions = body.partitions;
                    const newPartitions = partitions.filter(p => {
                        if (!this.partitionMap.has(p.hash)) {
                            return true;
                        }

                        return this.partitionMap.get(p.hash).status !== 1;
                    });

                    if (newPartitions.length === 0) {
                        callback(null, false);
                        return;
                    }

                    latestPartition = newPartitions[0];

                    callback(null, true);
                });
            }, (error, result) => {
                if (!latestPartition) {
                    setTimeout(() => {
                        this._fetchLatestPartitions()
                    }, 10000);
                    return;
                }

                const partition = latestPartition;
                const dest = path.join(storeDir, partition.hash);
                const host = this.config.entryNode.host + ':' + (this.config.entryNode.dhtPort ? this.config.entryNode.dhtPort : this.config.port);

                this.partitionMap.set(partition.hash, {
                    status: 0,
                    path: dest
                });
                this._persistent();

                request('http://' + path.join(host, 'chunks', partition.hash).replace(/\\/g, '\/')).pipe(fs.createWriteStream(dest)).on('finish', () => {
                    this.partitionMap.get(partition.hash).status = 1;
                    this._sync();
                    this._persistent();
                    this._fetchLatestPartitions();
                }).on('error', (e) => {
                    console.log(e);
                    setTimeout(() => {
                        this._fetchLatestPartitions()
                    }, 10000);
                });
            });
        });
    }
}

module.exports = FileStore;