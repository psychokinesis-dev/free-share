# free-share

通过一条链接与他人分享本地的任何文件，基于 [js-psychokinesis](https://github.com/psychokinesis-dev/js-psychokinesis) 构建。

## 如何使用
1. 配置一个合适的域名（任意一个目前没有被使用的域名即可）及对应网络的入口地址；
2. 将要访问分享文件的终端 DNS 服务器配置为对应网络的入口地址 IP ，然后即可直接通过界面上产生的 URL 获取到对应的文件。

## 构建
```bash
$ apt-get install nodejs npm
$ npm install
$ npm install -g bower
$ bower install
```

## 启动
```bash
$ npm start
```

## 打包
```bash
$ npm run-script pack
```

完成后各平台对应的可执行程序位于上层目录的 free-share-dist 下。