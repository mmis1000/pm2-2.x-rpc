process.on('message', function(packet) {
    process.send({
        type: 'process:msg',
        data: {
            msg: packet.data.msg
        }
    });
});

