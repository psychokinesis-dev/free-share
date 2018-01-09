const os = require('os');
const mkdirp = require('mkdirp');
const path = require('path');
const fs = require('fs');
const splitFile = require('split-file');

const tempDir = os.tmpdir();
const tempStoreDir = path.join(tempDir, 'free-share-store');

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
            mkdirp(tempStoreDir, (err) => {
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

        this._addFileWorker(fileInfo.key);
    }
    
    _addFileWorker(key) {
        const fileInfo = this.fileMap.get(key);
        const filePath = fileInfo.path;

        return new Promise((resolve, reject) => {
            const dest = path.join(tempStoreDir, key);
            fs.createReadStream(filePath).pipe(fs.createWriteStream(dest)).on('finish', () => {
                splitFile.splitFile(dest, 3)
                .then((files) => {
                    console.log(files);
                })
                .catch((error) => {
                    console.log(error);
                })
            });
        });
    }
}

module.exports = FileStore;