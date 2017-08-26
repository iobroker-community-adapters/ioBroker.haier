"use strict";
var utils =    require(__dirname + '/lib/utils'); // Get common adapter utils
var adapter = utils.adapter('haier');
var net = require('net');
var haier = net.Socket();
var polling_time = 2000;
var query = null;
var qstn = new Buffer([10,0,0,0,0,0,1,1,77,1]);
var in_msg;
var out_msg;
var states = {};
var old_states = {};
var cmd = {
    qstn:       [10,0,0,0,0,0,1,1,77,1], // Команда опроса
    poweron:    [10,0,0,0,0,0,1,1,77,2], // Включение кондиционера
    poweroff:   [10,0,0,0,0,0,1,1,77,3], // Выключение кондиционера
    lockremote: [10,0,0,0,0,0,1,3,0,0]  // Блокировка пульта
};

adapter.on('unload', function (callback) {
    if(haier){
        haier.destroy();
    }
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('objectChange', function (id, obj) {
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

adapter.on('stateChange', function (id, state) {
    if (state && !state.ack) {
        adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
        var ids = id.split(".");
        var val = state.val;
        var cmd = ids[ids.length - 1].toString().toLowerCase();
        adapter.log.debug('cmd ' + cmd);
        //parseCmd(cmd);
    }
});

adapter.on('ready', function () {
    main();
});

function main() {
    connect();

    haier.on('data', function(chunk) {
        if (chunk.length == 36){
            in_msg = Buffer.from(chunk);
            in_msg = in_msg.slice(1, 35);
            adapter.log.info("Haier incomming: " + in_msg.toString('hex'));
            parse(in_msg);
        }
    });

    haier.on('error', function(e) {
        err(e);
    });

    haier.on('close', function(exception) {
        err('Haier disconnected');
    });
}

function connect(cb){
    var host = adapter.config.host ? adapter.config.host : '192.168.1.55';
    var port = adapter.config.port ? adapter.config.port : 23;
    adapter.log.debug('Haier ' + 'connect to: ' + host + ':' + port);
    haier.connect(port, host, function() {
        adapter.setState('info.connection', true, true);
        adapter.log.debug('Haier connected');
        clearInterval(query);
        query = setInterval(function() {
            send(cmd.qstn);
        }, polling_time);
        if(cb){return cb;}
    });
}

function send(cmd){
    cmd = Buffer(cmd);
    if (cmd !== undefined){
        if(cmd.length > 20){
            cmd[15] = 0; // 00-команда 7F-ответ
        }
        cmd = packet(cmd);
        adapter.log.debug('Send Command: ' + cmd.toString("hex"));
        haier.write(cmd);
    }
}

function parse(msg){
    //22 00 00 00 00 00 01 02 6d 01 00 1a 00 00 00 7f 00 00 00 00 00 01 00 02 00 00 00 11 00 00 00 00 00 0a
    states.temp       = msg[11];        //Текущая температура
    states.mode       = msg[21];        //4 - DRY, 1 - cool, 2 - heat, 0 - smart, 3 - вентиляция
    states.fanspeed   = msg[23];        //Скорость 2 - min, 1 - mid, 0 - max, 3 - auto
    states.swing      = msg[25];        //1 - верхний и нижний предел вкл., 0 - выкл., 2 - левый/правый вкл., 3 - оба вкл
    states.lockremote = msg[26];        //128 блокировка вкл., 0 -  выкл
    states.fresh      = msg[29];        //fresh 0 - off, 1 - on
    states.settemp    = msg[33] + 16;   //Установленная температура
    states.power      = msg[27];        //on/off 1 - on, 0 - off (16, 17)-Компрессор??? 9 - QUIET (17)
    adapter.log.debug('states ' + JSON.stringify(states));
    Object.keys(states).forEach(function(key) {
        if(states[key] !== old_states[key]){
            old_states[key] = states[key];
            setObject(key, states[key]);
        }
    });
}

function setObject (name, val){
    var type = 'string';
    var role = 'state';
    adapter.log.debug('setObject ' + JSON.stringify(name));
    adapter.getState(name, function (err, state){
        if ((err || !state)){
            adapter.setObject(name, {
                type:   'state',
                common: {
                    name: name,
                    desc: name,
                    type: type,
                    role: role
                },
                native: {}
            });
            adapter.setState(name, {val: val, ack: true});
        } else {
            adapter.setState(name, {val: val, ack: true});
        }
    });
    adapter.subscribeStates('*');
}


function packet(data){
    var chksum = CRC(data);
    return Buffer.concat([Buffer.from([255,255]), data, Buffer.from([chksum])]);
}

function CRC(d){
    var sum = 0;
    for (var key of d.keys()) {
        sum += d[key];
    }
   return sum;
}

function err(e){
    if (e){
        adapter.log.error("Haier " + e);
        clearInterval(query);
        adapter.log.error('Error socket: Reconnect after 15 sec...');
        adapter.setState('info.connection', false, true);
        setTimeout(function() {
            main();
        }, 15000);
    }
}
