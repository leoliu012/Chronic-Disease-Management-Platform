#!/usr/bin/env node
/**
 * test-hl7-client.js
 *
 * 小工具：从本地通过 MLLP 协议向网关发送一条 HL7 v2 消息，并打印收到的 ACK。
 *
 * 用法：
 *   # 启动 API 时打开 HL7 监听:
 *   GATEWAY_HL7_ENABLED=true GATEWAY_HL7_PORT=2575 npm run start:dev
 *
 *   # 默认发 ADT^A03 出院消息:
 *   node docs/gateway/samples/test-hl7-client.js
 *
 *   # 改发检验结果:
 *   node docs/gateway/samples/test-hl7-client.js docs/gateway/samples/hl7-oru-r01-lab.txt
 *
 *   # 指定 host / port:
 *   HL7_HOST=127.0.0.1 HL7_PORT=2575 node docs/gateway/samples/test-hl7-client.js
 */

const net = require('net');
const fs = require('fs');
const path = require('path');

const SB = Buffer.from([0x0b]); // <VT>
const EB = Buffer.from([0x1c]); // <FS>
const CR = Buffer.from([0x0d]); // <CR>

const HL7_HOST = process.env.HL7_HOST || '127.0.0.1';
const HL7_PORT = Number.parseInt(process.env.HL7_PORT || '2575', 10);

const sampleFile = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, 'hl7-adt-a03-discharge.txt');

if (!fs.existsSync(sampleFile)) {
  console.error(`Sample file not found: ${sampleFile}`);
  process.exit(1);
}

// 读取样例文件，删掉注释行，把换行替换成真 CR 作为段分隔符
const raw = fs.readFileSync(sampleFile, 'utf8');
const hl7Body = raw
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('#'))
  .join('\r');

const framed = Buffer.concat([SB, Buffer.from(hl7Body, 'utf8'), EB, CR]);

console.log(`Connecting to ${HL7_HOST}:${HL7_PORT} ...`);
const sock = net.createConnection({ host: HL7_HOST, port: HL7_PORT }, () => {
  console.log(`Connected. Sending ${framed.length} bytes (HL7 framed).`);
  sock.write(framed);
});

let buffer = Buffer.alloc(0);
sock.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  // MLLP 帧：SB ... EB CR
  const ebIdx = buffer.indexOf(EB[0]);
  if (ebIdx >= 0) {
    const sbIdx = buffer.indexOf(SB[0]);
    const ack = buffer
      .slice(sbIdx + 1, ebIdx)
      .toString('utf8')
      .replace(/\r/g, '\n');
    console.log('\n----- ACK received -----');
    console.log(ack);
    console.log('-------------------------');
    sock.end();
  }
});

sock.on('error', (err) => {
  console.error('TCP error:', err.message);
  process.exit(1);
});

sock.on('close', () => {
  console.log('Connection closed.');
});
