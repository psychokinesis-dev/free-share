const os = require('os');
const mkdirp = require('mkdirp');
const path = require('path');

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
        return new Promise((resolve, reject) => {
            mkdirp(tempStoreDir, function (err) {
                if (err) { 
                    console.error('create store path failed:', err);
                    reject(err);
                    return;
                }
                
                resolve();
            });
        });
    }
}

module.exports = FileStore;