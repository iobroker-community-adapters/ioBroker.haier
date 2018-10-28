"use strict";
var utils =    require(__dirname + '/lib/utils');
var adapter = utils.Adapter('haier');
var net = require('net');
var polling_time = 2000;
var _connect = false;
var tabu = false;
var query, recnt, haier, in_msg, out_msg, states = {}, old_states = {};
var command = {
    qstn:       [10,0,0,0,0,0,1,1,77,1], // Команда опроса
    poweron:    [10,0,0,0,0,0,1,1,77,2], // Включение кондиционера
    poweroff:   [10,0,0,0,0,0,1,1,77,3], // Выключение кондиционера
    no:         [10,0,0,0,0,0,1,1,77,4], // отображает на дисплее установленную температуру ???
    lockremote: [10,0,0,0,0,0,1,3,0,0],  // Блокировка пульта ???
    healthon:   [10,0,0,0,0,0,1,1,77,9], // Включение режима health (здоровье)
    healthoff:  [10,0,0,0,0,0,1,1,77,8]  // Выключение режима health (здоровье)
};
var byte = {
    temp:       11,
    mode:       21,
    fanspeed:   23,
    swing:      25,
    lockremote: 26,
    fresh:      29,
    settemp:    33,
    power:      27,
    compressor: 27,
    health:     27,
    cmd:        15
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

function sendCmd(cmd, val){
    out_msg = in_msg;
    tabu = true;
    switch (cmd) {
        case 'power':
            if(val === true){
                send(command.poweron);
            } else {
                send(command.poweroff);
            }
            break;
        case 'mode': //4 - DRY, 1 - cool, 2 - heat, 0 - smart, 3 - fan
            if(val == 'smart' || val == 0) { val = 0; }
            else if(val == 'cool'  || val == 1) { val = 1; }
            else if(val == 'heat'  || val == 2) { val = 2; }
            else if(val == 'fan'   || val == 3) { val = 3; }
            else if(val == 'dry'   || val == 4) { val = 4; }
            out_msg[byte.mode] = val;
            send(out_msg);
            break;
        case 'fanspeed': //Скорость 2 - min, 1 - mid, 0 - max, 3 - auto
            if(val == 'max' || val == 0) { val = 0; }
            else if(val == 'mid' || val == 1) { val = 1; }
            else if(val == 'min' || val == 2) { val = 2; }
            else if(val == 'auto'|| val == 3) { val = 3; }
            out_msg[byte.fanspeed] = val;
            send(out_msg);
            break;
        case 'swing': //1 - верхний и нижний предел вкл., 0 - выкл., 2 - левый/правый вкл., 3 - оба вкл
            if(val == false || val == 0) { val = 0; }
            else if(val == 'ud'  || val == 1) { val = 1; }
            else if(val == 'lr'  || val == 2) { val = 2; }
            else if(val == 'both'|| val == 3) { val = 3; }
            out_msg[byte.swing] = val;
            send(out_msg);
            break;
        case 'lockremote': //128 блокировка вкл., 0 -  выкл
            if(val == false)  { val = 0; }
            else if(val == true)  { val = 128; }
            out_msg[byte.lockremote] = val;
            send(out_msg);
            //send(command.lockremote);
            break;
        case 'fresh': //fresh 0 - off, 1 - on
            if(val == false) { val = 0; }
            else if(val == true)  { val = 1; }
            out_msg[byte.fresh] = val;
            send(out_msg);
            break;
        case 'settemp':
            val =  parseInt(val);
            if(val < 16){
                val = 16;
            } else if(val > 30){
                val = 30;
            }
            out_msg[byte.settemp] = val - 16;
            send(out_msg);
            break;
        case 'health':  //on/off 1 - on, 0 - off (16, 17)-Компрессор??? 9 - QUIET (17)
            if(val === true){
                send(command.healthon);
            } else {
                send(command.healthoff);
            }
            break;
        case 'raw':
            send(toArr(val, 2));
            break;
        default:
    }
}

adapter.on('ready', function () {
    adapter.subscribeStates('*');
    connect();
});

function connect(cb){
    var host = adapter.config.host ? adapter.config.host : '127.0.0.1';
    var port = adapter.config.port ? adapter.config.port : 23;
    adapter.log.debug('Haier ' + 'connect to: ' + host + ':' + port);
    haier = net.connect(port, host, function() {
        clearTimeout(recnt);
        adapter.setState('info.connection', true, true);
        adapter.log.info('Haier connected to: ' + host + ':' + port);
        _connect = true;
        clearInterval(query);
        query = setInterval(function() {
            if(!tabu){
                send(command.qstn);
            }
        }, polling_time);
        if(cb){return cb;}
    });
    haier.on('data', function(chunk) {
        adapter.log.debug("Haier raw response: {" + chunk.toString('hex') + '} Length packet:[' + chunk.length + ']');
        if(chunk.length == 33 || chunk.length == 34){ //20 00 00 00 01 02 6d01001e0000007f0000000000010002000000100000000000094c
            var a;
            chunk[0] = 0;
            if(chunk.length == 34){
                a = Buffer.from([0]);
            } else if (chunk.length == 33){
                a = Buffer.from([0,0]);
            }
            chunk = Buffer.concat([a, chunk]);
            chunk[0] = 34;
        }
        if (chunk.length == 37){
            in_msg = Buffer.from(chunk);
            in_msg = in_msg.slice(2, 36);
            adapter.log.debug("Haier incomming: " + in_msg.toString('hex'));
            parse(in_msg);
        } else if(chunk.length == 36){
            in_msg = Buffer.from(chunk);
            in_msg = in_msg.slice(1, 35);
            adapter.log.debug("Haier incomming: " + in_msg.toString('hex'));
            parse(in_msg);
        } else if(chunk.length == 35){
            in_msg = Buffer.from(chunk);
            in_msg = in_msg.slice(0, 34);
            adapter.log.debug("Haier incomming: " + in_msg.toString('hex'));
            parse(in_msg);
        } else {
            adapter.log.error("Error length packet. Raw response: {" + chunk.toString('hex') + '} Length packet:[' + chunk.length + ']');
        }
    });
    haier.on('error', function(e) {
        err(e);
    });
    haier.on('close', function(e) {
        if(_connect){
            err('Haier disconnected');
        }
        reconnect();
    });
}

function send(cmd){
    cmd = Buffer(cmd);
    if (cmd !== undefined){
        if(cmd.length > 20 && cmd.length < 35){
            cmd[byte.cmd] = 0; // 00-команда 7F-ответ
            cmd[7] = 1;
            cmd[8] = 77;
            cmd[9] = 95;
        }
        cmd = packet(cmd);
        adapter.log.debug('Send Command: ' + cmd.toString("hex"));
        haier.write(cmd);
        tabu = false;
    }
}

function parse(msg){
    states.temp = msg[byte.temp]; //Текущая температура
    switch (msg[byte.mode]) { //4 - DRY, 1 - cool, 2 - heat, 0 - smart, 3 - вентилятор
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
            states.swing = 'both';
            break;
        default:
    }
    states.lockremote = toBool(msg[byte.lockremote]);   //128 блокировка вкл., 0 -  выкл
    states.fresh      = toBool(msg[byte.fresh]);        //fresh 0 - off, 1 - on
    states.settemp    = msg[byte.settemp] + 16;         //Установленная температура
    if(msg[byte.power] == 1 || msg[byte.power] == 17 || msg[byte.power] == 25 || msg[byte.power] == 9){
        //on/off 1 - on, 0 - off (16, 17)-Компрессор??? 9 - QUIET (17)
        states.power = true;
    } else if(msg[byte.power] == 0 || msg[byte.power] == 16){
        states.power = false;
    }
    if(msg[byte.health] == 25 || msg[byte.power] == 9){
        states.health = true; //УФ лампа - режим здоровье
    } else {
        states.health = false;
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
            adapter.setState(key, {val: states[key], ack: true});
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

function toArr(text, numb){
    var arr = [], res;
    for (var i = 0; i < text.length / numb; i++) {
        res = parseInt(text.slice(numb * i, numb * i + numb), 16);
        if(!isNaN(res)){
            arr.push(res);
        }
    }
    return arr
}

function reconnect(){
    clearInterval(query);
    clearTimeout(recnt);
    haier.destroy();
    adapter.setState('info.connection', false, true);
    old_states = {};
    adapter.log.info('Reconnect after 60 sec...');
    _connect = false;
    recnt = setTimeout(function() {
        connect();
    }, 60000);
}

function err(e){
    adapter.log.error("Haier " + e);
    if (e.code == "ENOTFOUND" || e.code == "ECONNREFUSED" || e.code == "ETIMEDOUT") {
        haier.destroy();
    }
}
