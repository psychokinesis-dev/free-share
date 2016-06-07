'use strict';

const electron = require('electron');
const { clipboard } = require('electron');
const BrowserWindow = electron.remote.BrowserWindow;
const fs = require('fs');
const ipcRenderer = electron.ipcRenderer;
const fileServer = require('./file-server');
const winston = require('winston');
const xdgBasedir = require('xdg-basedir');
const os = require('os');
const path = require('path');
const mkdirp = require('mkdirp');


const configDir = path.join(xdgBasedir.config || path.join(os.tmpdir(), '.config'), 'freeshare');

mkdirp(configDir, function (err) {
    if (err) { 
        console.error('make config path failed:', err);
        return;
    }
    
    winston.add(winston.transports.File, { filename: path.join(configDir, 'app.log') });
});


angular.module('free-share', ['ngRoute', 'angularSpinner'])
    .controller('LoadingController', ($scope, $route, $routeParams, $location) => { 
        fs.readFile(path.join(configDir, 'config.json'), (err, data) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    let bootstrapWin = new BrowserWindow({ width: 600, height: 300, alwaysOnTop: true, icon: '/' + __dirname + '/icon.png' });
                    // bootstrapWin.webContents.openDevTools();
                    bootstrapWin.loadURL('file://' + __dirname + '/bootstrap.html');
                    
                    let configged = false;
                    bootstrapWin.on('closed', () => {
                        bootstrapWin = null;
                        
                        if (configged === false) {
                            winston.info('exit without config');
                            ipcRenderer.send('exit', 0);
                        }
                    });
                    
                    ipcRenderer.once('set-config', function (event, config) {
                        configged = true;
                        
                        winston.info('set config:', config);
                        
                        let server = new fileServer();
                        server.setConfig(config);
                        
                        fs.writeFile(path.join(configDir, 'config.json'), JSON.stringify(server.config));
                        bootstrapWin.close();
                        
                        server.start(() => {
                            $location.path('/share-list');
                            $scope.$apply();
                        });
                    });
                } else {
                    winston.error(err);
                }
                
                return;
            }
            
            let server = new fileServer();
            server.setConfig(JSON.parse(data));
            
            server.start(() => {
                $location.path('/share-list');
                $scope.$apply();
            });
        });
    })
    .controller('ShareListController', ($scope, $route, $routeParams, $location) => {
        let server = new fileServer();
        
        $scope.files = [];
        let addFile = function (fileInfo) {
            $scope.files.push({
                name: fileInfo.name,
                url: fileInfo.url
            });
        };
        
        $scope.remove = function (files, index) {
            let fileName = files[index].name;

            server.removeFile(fileName, (error2) => {
                if (error2) {
                    winston.error('remove file error:', error2);
                    return;
                }

                winston.info('remove file:', fileName);
            });
            
            // files.splice(index, 1);
        };
        
        $scope.copyURL = function (files, index) {
            clipboard.writeText(files[index].url);
        };
        
        server.forEachFile((fileInfo) => {
            addFile(fileInfo);
        });
        
        let drop = document.getElementById('drop');
        let processDragOverOrEnter = (event) => {
            event.stopPropagation();
            event.preventDefault();
        };
        
        drop.addEventListener('dragover', processDragOverOrEnter, false);
        drop.addEventListener('dragenter', processDragOverOrEnter, false);
        drop.addEventListener('drop', (event) => {
            event.stopPropagation();
            event.preventDefault();
            
            let dropFile = event.dataTransfer.files[0];
            server.addFile(dropFile.path, (error, fileInfo) => {
                if (error) {
                    winston.error('add file error:', error);
                    return;
                }
                
                winston.info('add file:', dropFile.path);
                
                addFile(fileInfo);
                $scope.$apply();
            });
            
        }, false);
    })
    .config(($routeProvider) => {
        $routeProvider
            .when('/', {
                templateUrl: 'loading.html',
                controller: 'LoadingController'
            })
            .when('/share-list', {
                templateUrl: 'share-list.html',
                controller: 'ShareListController'
            });
    });