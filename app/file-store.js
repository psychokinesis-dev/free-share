const os = require('os');
const mkdirp = require('mkdirp');
const path = require('path');
const fs = require('fs');
const splitFile = require('split-file');
const async = require('async');
const xdgBasedir = require('xdg-basedir');
const md5File = require('md5-file');


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
        const that = this;
        this.fileMap = new Map();

        console.log('store init success');

        return new Promise((resolve, reject) => {
            mkdirp(storeDir, (err) => {
                if (err) { 
                    console.error('create store path failed:', err);
                    reject(err);
                    return;
                }
                
                resolve();
            });
        });
    }

    addFile(fileInfo) {
        this.fileMap.set(fileInfo.key, fileInfo);

        return this._addFileWorker(fileInfo.key);
    }
    
    _addFileWorker(key) {
        const fileInfo = this.fileMap.get(key);
        const filePath = fileInfo.path;

        return new Promise((resolve, reject) => {
            const dest = path.join(storeDir, key);

            fs.createReadStream(filePath).pipe(fs.createWriteStream(dest)).on('finish', () => {
                splitFile.splitFile(dest, 3)
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

                        console.log('finished', files);

                        resolve();
                    });
                })
                .catch((error) => {
                    console.log(error);
                })
            });
        });
    }
}

module.exports = FileStore;