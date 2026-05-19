const { execSync } = require('child_process');
const path = require('path');

let input = Buffer.alloc(0);

process.stdin.on('data', function(chunk) {
  input = Buffer.concat([input, chunk]);

  while (input.length >= 4) {
    var msgLen = input.readUInt32LE(0);
    if (input.length < 4 + msgLen) break;

    var msg = JSON.parse(input.slice(4, 4 + msgLen).toString());
    input = input.slice(4 + msgLen);

    if (msg.action === 'pull') {
      try {
        var extDir = path.join(__dirname, '..');
        var output = execSync('git pull', { cwd: extDir, encoding: 'utf8', timeout: 30000 });
        send({ success: true, output: output.trim() });
      } catch (e) {
        send({ success: false, error: (e.stderr || e.message || '').substring(0, 500) });
      }
    } else {
      send({ success: false, error: 'Unknown action' });
    }
  }
});

function send(msg) {
  var json = Buffer.from(JSON.stringify(msg));
  var header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}
