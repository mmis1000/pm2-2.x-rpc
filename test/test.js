var assert = require('chai').assert;
var Server = require("../lib/server")
var dnode = require("dnode");
var path = require("path");

describe('Server', function() {
    describe('new', function() {
        it('should be able to new the instance', function() {
            new Server();
        });
        
        it('should be able to use as a dnode instance', function(done) {
            var server = new Server();
            var client = new dnode();
            client.pipe(server).pipe(client);
            client.on('remote', function (remote) {
                // console.log(remote);
                server.on('end', done)
                client.end();
            })
        });
    });
    
    describe('methods', function () {
        var workerName = 'test_worker_' + Math.random();
        var server;
        var client;
        var pm2;
        var bus;
        var pm_id;
        
        it('should be able to connect to remote daemon', function (done) {
            server = new Server();
            client = new dnode();
            client.pipe(server).pipe(client);
            client.on('remote', function (_remote) {
                pm2 = _remote;
                pm2.connect(function (err) {
                    assert.ok(!err);
                    done();
                })
            })
        })
        
        it('should be able to start a process', function (done) {
            pm2.start({
                name: workerName,
                script: path.resolve(__dirname, 'test_script.js')
            }, function (err, proc) {
                assert.ok(!err);
                done();
            })
        })
        
        it('should be able to list the process', function (done) {
            pm2.list(function (err, list) {
                assert.ok(!err);
                assert.ok(list.some(function (item) {
                    if (item.name === workerName) {
                        pm_id = item.pm2_env.pm_id
                    }
                    return item.name === workerName
                }));
                done();
            })
        })
        
        it('should get a launchBus', function (done) {
            pm2.launchBus(function (err, _bus) {
                assert.ok(!err);
                assert.ok(_bus);
                bus = _bus;
                done();
            })
        })
        
        it('should be able to recieve message via launchbus', function(cb) {
            pm2.sendDataToProcessId(
                pm_id,
                {
                    topic: 'process:msg',
                    data: {
                        msg: "hello"
                    }
                }, 
                function(err, res) {
                    assert(!err);
                }
            );
            
            pm2.sendDataToProcessId(
                pm_id,
                {
                    topic: 'process:msg',
                    data: {
                        msg: "world"
                    }
                }, 
                function(err, res) {
                    assert(!err);
                }
            );
            
            var msgs = []
            
            bus.on('process:msg', function(packet) {
                msgs.push(packet.data.msg)
                if (msgs.join(' ') === "hello world") {
                    cb();
                }
            });
            
            // console.log('sending to pm2 id: ' + pm_id);
            
        })
        
        it('should be able to delete a process', function (done) {
            pm2.delete(workerName, function (err) {
                assert.ok(!err);
                pm2.list(function (err, list) {
                    assert.ok(!err);
                    assert.ok(!list.some(function (item) {
                        return item.name === workerName
                    }));
                    done();
                });
            })
        })
        
        it('should be able to disconnect from daemomn', function (done) {
            pm2.disconnect(function (err) {
                assert(!err);
                done();
            });
        })
        
        it('wait client to exit...', function (done) {
            setTimeout(function () {
                server.on('end', done)
                client.end();
            }, 0)
        })
    })
});
