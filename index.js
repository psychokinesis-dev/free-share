'use strict';

const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const Tray = electron.Tray;
const path = require('path');
const os = require('os');
const fs = require('fs');
const xdgBasedir = require('xdg-basedir');
const winston = require('winston');
const mkdirp = require('mkdirp');


const configDir = path.join(xdgBasedir.config || path.join(os.tmpdir(), '.config'), 'freeshare');

mkdirp(configDir, function (err) {
    if (err) { 
        console.error('make config path failed:', err);
        return;
    }
    
    winston.add(winston.transports.File, { filename: path.join(configDir, 'app.log') });
});


let mainWindow = null;
let tray = null;

const shouldQuit = app.makeSingleInstance((commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
        if (!mainWindow.isVisible()) mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

if (shouldQuit) {
    app.quit();
    return;
}


let isAppReady = false;

app.on('ready', () => {
    isAppReady = true;
    
    displayMainWindow();
    
    tray = new Tray(__dirname + '/app/icon.png');
    tray.setToolTip('Free Share');
    
    tray.on('click', (event, bounds) => {
        displayMainWindow();
    });
    
    tray.on('right-click', (event, bounds) => {
        displayMainWindow();
    });
    
    tray.on('double-click', (event, bounds) => {
        displayMainWindow();
    });
});

app.on('activate', (event, hasVisibleWindows) => {
    if (!hasVisibleWindows) displayMainWindow();
});

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    if (process.platform != 'darwin') app.quit();
});


const FileServer = require('./app/file-server');
let fileServer = new FileServer();

ipcMain.on('init', function (event) {
    fs.readFile(path.join(configDir, 'config.json'), (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                mainWindow.webContents.send('bootstrap');
            } else {
                winston.error(err);
                app.exit(1);
            }
            return;
        }

        let config = JSON.parse(data);
        fileServer.setConfig(config);
        fs.writeFile(path.join(configDir, 'config.json'), JSON.stringify(fileServer.config));

        fileServer.start(() => {
            let files = [];
            fileServer.forEachFile((fileInfo) => {
                files.push(fileInfo);
            });
        
            mainWindow.webContents.send('started', files);
        });
    });
});

ipcMain.on('set-config', function (event, config) {
    fileServer.setConfig(config);
    fs.writeFile(path.join(configDir, 'config.json'), JSON.stringify(fileServer.config));
    
    mainWindow.webContents.send('configured', config);
});

ipcMain.on('start-file-server', function (event) {
    fileServer.start(() => {
        let files = [];
        fileServer.forEachFile((fileInfo) => {
            files.push(fileInfo);
        });

        mainWindow.webContents.send('started', files);
    });
});

ipcMain.on('add-file', function (event, filePath) {
    fileServer.addFile(filePath, (error, _fileInfo) => {
        if (error) {
            winston.error('add file error:', error);
            return;
        }
        
        updateFilesView();
        winston.info('add file:', filePath);
    });
});

ipcMain.on('remove-file', function (event, fileName) {
    fileServer.removeFile(fileName, (error) => {
        if (error) {
            winston.error('remove file error:', error);
            return;
        }
        
        updateFilesView();
        winston.info('remove file:', fileName);
    });
});

ipcMain.on('exit', function (event, code) {
    app.exit(code);
});


function displayMainWindow() {
    if (mainWindow) {
        mainWindow.show();
    } else if (isAppReady) {
        mainWindow = new BrowserWindow({ width: 800, height: 600, icon: __dirname + '/app/icon.ico' });

        mainWindow.loadURL('file://' + __dirname + '/app/index.html');

        // mainWindow.webContents.openDevTools();

        mainWindow.on('minimize', () => {
            mainWindow.hide();
        });

        mainWindow.on('close', () => {
            mainWindow = null;
        });
    }
};

function updateFilesView() {
    let files = [];
    fileServer.forEachFile((fileInfo) => {
        files.push(fileInfo);
    });
    mainWindow.webContents.send('files-updated', files);
}