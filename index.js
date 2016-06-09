'use strict';

const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;

let mainWindow = null;

app.on('ready', () => {
    mainWindow = new BrowserWindow({width: 800, height: 600, icon: __dirname + '/app/icon.ico'});
    
    mainWindow.loadURL('file://' + __dirname + '/app/index.html');
    
    // mainWindow.webContents.openDevTools();
    
    mainWindow.on('close', () => {
        mainWindow = null;
    });
});

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    if (process.platform != 'darwin') app.quit();
});

ipcMain.on('set-config', function (event, config) {
    mainWindow.webContents.send('set-config', config);
});

ipcMain.on('exit', function (event, code) {
    app.exit(code);
});