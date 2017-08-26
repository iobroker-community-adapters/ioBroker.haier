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
        sendCmd(cmd, val);
    }
});


var byte = {
    temp:       11,
    mode:       21,
    fanspeed:   23,
    swing:      25,
    lockremote: 26,
    fresh:      29,
    settemp:    33,
    power:      27,
    quiet:      27,
    compressor: 27,
    cmd:        15
};
function sendCmd(cmd, val){
    out_msg = in_msg;
    switch (cmd) {
        case 'power':
            if(val === true){
                send(cmd.poweron);
            } else {
                send(cmd.poweroff);
            }
            break;
        case 'mode': //4 - DRY, 1 - cool, 2 - heat, 0 - smart, 3 - fan
                 if(val == 'smart') { val = 0; }
            else if(val == 'cool')  { val = 1; }
            else if(val == 'heat')  { val = 2; }
            else if(val == 'fan')   { val = 3; }
            else if(val == 'fan')   { val = 4; }
            out_msg[byte.mode] = val;
            send(out_msg);
            break;
        case 'fanspeed': //Скорость 2 - min, 1 - mid, 0 - max, 3 - auto
                 if(val == 'max')  { val = 0; }
            else if(val == 'mid')  { val = 1; }
            else if(val == 'min')  { val = 2; }
            else if(val == 'auto') { val = 3; }
            out_msg[byte.fanspeed] = val;
            send(out_msg);
            break;
        case 'swing': //1 - верхний и нижний предел вкл., 0 - выкл., 2 - левый/правый вкл., 3 - оба вкл
                 if(val == false)  { val = 0; }
            else if(val == 'ud')  { val = 1; }
            else if(val == 'lr')  { val = 2; }
            else if(val == 'any') { val = 3; }
            out_msg[byte.swing] = val;
            send(out_msg);
            break;
        case 'lockremote': //128 блокировка вкл., 0 -  выкл
            send(cmd.lockremote);
            break;
        case 'fresh': //fresh 0 - off, 1 - on
                 if(val == false) { val = 0; }
            else if(val == true)  { val = 1; }
            out_msg[byte.fresh] = val;
            send(out_msg);
            break;
        case 'settemp':
            if(val < 18){
                val = 18;
            } else if(val > 33){
                val = 33;
            }
            out_msg[byte.settemp] = val - 16;
            send(out_msg);
            break;
        case 'quiet':  //on/off 1 - on, 0 - off (16, 17)-Компрессор??? 9 - QUIET (17)
                 if(val == false) { val = 1; }
            else if(val == true)  { val = 9; }
            out_msg[byte.quiet] = val;
            send(out_msg);
            break;
        default:
    }

}

adapter.on('ready', function () {
    main();
});

function main() {
    adapter.subscribeStates('*');

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
        adapter.log.info('Haier connected to: ' + host + ':' + port);
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
            cmd[byte.cmd] = 0; // 00-команда 7F-ответ
        }
        cmd = packet(cmd);
        adapter.log.debug('Send Command: ' + cmd.toString("hex"));
        haier.write(cmd);
    }
}


function parse(msg){
    //22 00 00 00 00 00 01 02 6d 01 00 1a 00 00 00 7f 00 00 00 00 00 01 00 02 00 00 00 11 00 00 00 00 00 0a
    states.temp = msg[byte.temp];        //Текущая температура
    switch (msg[byte.mode]) { //4 - DRY, 1 - cool, 2 - heat, 0 - smart, 3 - вентиляция
        case 0:
            states.mode = 'smart';
            break;
        case 1:
            states.mode = 'cool';
            break;
        case 2:
            states.mode = 'heat';
            break;
        case 3:
            states.mode = 'fan';
            break;
        case 4:
            states.mode = 'dry';
            break;
        default:
    }
    switch (msg[byte.fanspeed]) { //Скорость 2 - min, 1 - mid, 0 - max, 3 - auto
        case 0:
            states.fanspeed = 'max';
            break;
        case 1:
            states.fanspeed = 'mid';
            break;
        case 2:
            states.fanspeed = 'min';
            break;
        case 3:
            states.fanspeed = 'auto';
            break;
        default:
    }
    switch (msg[byte.swing]) { //1 - верхний и нижний предел вкл., 0 - выкл., 2 - левый/правый вкл., 3 - оба вкл
        case 0:
            states.swing = false;
            break;
        case 1:
            states.swing = 'ud';
            break;
        case 2:
            states.swing = 'lr';
            break;
        case 3:
            states.swing = 'any';
            break;
        default:
    }
    states.lockremote = toBool(msg[byte.lockremote]);        //128 блокировка вкл., 0 -  выкл
    states.fresh      = toBool(msg[byte.fresh]);        //fresh 0 - off, 1 - on
    states.settemp    = msg[byte.settemp] + 16;   //Установленная температура

    if(msg[byte.power] == 1 || msg[byte.power] == 16 || msg[byte.power] == 17 || msg[byte.power] == 9){
        //on/off 1 - on, 0 - off (16, 17)-Компрессор??? 9 - QUIET (17)
        states.power = true;
    } else if(msg[byte.power] == 0){
        states.power = false;
    }
    if(msg[byte.quiet] == 9){
        states.quiet = true; //бесшумный режим
    } else {
        states.quiet = false;
    }
    if(msg[byte.compressor] == 17){
        states.compressor = true;
    } else if(msg[byte.power] == 16){
        states.compressor = false;
    }

    adapter.log.debug('states ' + JSON.stringify(states));
    Object.keys(states).forEach(function(key) {
        if(states[key] !== old_states[key]){
            old_states[key] = states[key];
            setObject(key, states[key]);
        }
    });
}

function toBool(nb){
    if(nb == 0){
        return false;
    } else {
        return true;
    }
}

function setObject (name, val){
    var type = 'string';
    var role = 'state';
    adapter.log.debug('setObject ' + JSON.stringify(name));
    /*adapter.getState(name, function (err, state){
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
    });*/
    adapter.setState(name, {val: val, ack: true});
    //adapter.subscribeStates('*');
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
