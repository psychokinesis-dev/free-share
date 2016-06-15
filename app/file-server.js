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


const configDir = path.join(xdgBasedir.config || path.join(os.tmpdir(), '.config'), 'freeshare');


let instance = null;

class FileServer {
    constructor() {
        if (!instance) {
            instance = this;
        }
                
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

                if (this.fileMap.has(filename)) {
                    let filepath = this.fileMap.get(filename);

                    send(req, filepath).on('error', function (err) {
                        resp.statusCode = err.status || 500;
                        resp.end(err.message);
                    }).pipe(resp);
                } else {
                    resp.end(filename + ' not found');
                }
            });

            this.psyc.on('ready', () => {
                this.started = true;
                cb();
            });

            this.psyc.on('error', (err) => {
                winston.error('file server error:', err);
            });
        });
    }
    
    addFile(filepath, cb) {
        let filename = path.basename(filepath);
        
        if (this.fileMap.has(filename)) {
            cb({desc: 'file name exists'});
            return;
        }
        
        this.fileMap.set(filename, filepath);
        this._persistent((error) => {
            cb(error, this._covertFileInfo(filename))
        });
    }
    
    removeFile(filename, cb) {
        if (!this.fileMap.has(filename)) {
            cb({desc: 'file doesn\'t exists'});
            return;
        }
        
        this.fileMap.delete(filename);
        this._persistent(cb);
    }
    
    forEachFile(cb) {
        this.fileMap.forEach((filepath, filename) => {
            cb(this._covertFileInfo(filename))
        })
    }
    
    _persistent(cb) {
        let filesArray = Array.from(this.fileMap);
        
        fs.writeFile(path.join(configDir, 'files.json'), JSON.stringify(filesArray), cb);
    }
    
    _covertFileInfo(filename) {
        return {
            name: filename,
            url: 'http://' + path.join(this.config.entryNode.host + ':' + (this.config.entryNode.dhtPort ? this.config.entryNode.dhtPort : this.config.port), this.config.domain, filename).replace(/\\/g, '\/')
        };
    }
}


module.exports = FileServer;