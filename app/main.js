'use strict';

const electron = require('electron');
const { clipboard } = require('electron');
const BrowserWindow = electron.remote.BrowserWindow;
const ipcRenderer = electron.ipcRenderer;
const winston = require('winston');
const xdgBasedir = require('xdg-basedir');
const os = require('os');
const path = require('path');


const configDir = path.join(xdgBasedir.config || path.join(os.tmpdir(), '.config'), 'freeshare');

let fileArray = null;

angular.module('free-share', ['ngRoute', 'angularSpinner', 'monospaced.qrcode'])
    .controller('LoadingController', ($scope, $route, $routeParams, $location) => {
        ipcRenderer.once('bootstrap', function (event) {
            let bootstrapWin = new BrowserWindow({ width: 600, height: 300, alwaysOnTop: true, icon: __dirname + '/icon.ico' });
            // bootstrapWin.webContents.openDevTools();
            bootstrapWin.loadURL('file://' + __dirname + '/bootstrap.html');

            let configged = false;
            bootstrapWin.on('closed', () => {
                bootstrapWin = null;

                if (configged === true) {
                    ipcRenderer.send('start-file-server');
                } else {
                    winston.info('exit without config');
                    ipcRenderer.send('exit', 0);
                }
            });

            ipcRenderer.once('configured', function (event, config) {
                configged = true;

                winston.info('set config:', config);

                bootstrapWin.close();
            });
        });
        
        ipcRenderer.once('started', function (event, files) {
            fileArray = files;
            
            $location.path('/share-list');
            $scope.$apply();
        });
        
        ipcRenderer.send('init');
    })
    .controller('ShareListController', ($scope, $route, $routeParams, $location) => {
        $scope.files = fileArray ? fileArray : [];

        ipcRenderer.on('files-updated', function (event, files) {
            fileArray = files;
            $scope.files = fileArray;
            $scope.$apply();
        });
        
        $scope.store = function (files, index) {
            let fileName = files[index].name;

            // processing
            if (files[index].storeState === 1) return;

            ipcRenderer.send('store-file', fileName);
        };

        $scope.remove = function (files, index) {
            let fileName = files[index].name;

            ipcRenderer.send('remove-file', fileName);
            
            // files.splice(index, 1);
        };
        
        $scope.copyURL = function (files, index) {
            clipboard.writeText(files[index].url);
        };
        
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
            ipcRenderer.send('add-file', dropFile.path);
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
    }).filter('storeStateToPrompt',function(){
        return function (file) {
            const state = file.storeState;
            switch(state) {
                case 0: return '离线分享';
                case 1: return '处理中';
                case 2: return '离线分享中 ' + file.storeRate.toFixed(2);
                default: return '';
            }
        };
    });