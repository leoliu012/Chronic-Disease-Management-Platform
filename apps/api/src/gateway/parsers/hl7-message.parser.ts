/**
 * hl7-message.parser.ts
 *
 * HL7 v2.x 报文解析器（零依赖）。
 *
 * HL7 v2 报文结构：
 *   MSH|^~\&|...|...|||TIMESTAMP||ADT^A03|MSG_CTRL_ID|P|2.5\r
 *   PID|||MZ20260519001||王建国||19580314|M|||...||13800010001\r
 *   PV1||I|WARD1|...\r
 *   DG1|1|I10|I10|高血压|20260101\r
 *
 * 关键约定：
 *   - 段与段之间用 \r 分隔（不是 \n，注意）
 *   - 第一段必须是 MSH
 *   - 字段分隔符由 MSH-1 决定（标准是 '|'），编码字符由 MSH-2 决定（标准是 ^~\&）
 *       MSH-2[0] = '^' 组件分隔符
 *       MSH-2[1] = '~' 重复分隔符
 *       MSH-2[2] = '\' 转义字符
 *       MSH-2[3] = '&' 子组件分隔符
 *   - 字段编号从 1 开始；MSH 段的 MSH-1 就是字段分隔符本身，因此 MSH-2 在数组中实际是索引 1
 *
 * 本解析器只实现"读"，不实现"写"（ACK 在 hl7-listener 里手动拼）。
 * 为了维护成本，没有引入 simple-hl7 这类第三方库。
 */

export interface Hl7Encoding {
  field: string;       // 默认 |
  component: string;   // 默认 ^
  repetition: string;  // 默认 ~
  escape: string;      // 默认 \
  subcomponent: string;// 默认 &
}

export interface Hl7Segment {
  /** 段类型，例如 "MSH" / "PID" / "PV1" */
  type: string;
  /**
   * 字段数组，索引 0 是段名本身。
   *
   * 重要：MSH 段比较特殊 —— 标准里 MSH-1 就是字段分隔符 '|'，MSH-2 是编码字符 '^~\&'。
   * 为了让所有段在解析后下标语义一致（fields[N] 对应 HL7 文档中的 SEGMENT-N），
   * 我们对 MSH 做了对齐：fields[0]="MSH", fields[1]="|", fields[2]="^~\&", fields[3]=SendingApp, ...
   */
  fields: string[];
}

export interface Hl7Message {
  encoding: Hl7Encoding;
  segments: Hl7Segment[];
  /** MSH-9 触发事件，例如 "ADT^A03" / "ORU^R01" */
  triggerEvent: string;
  /** MSH-10 消息控制 ID，用于幂等 + ACK */
  messageControlId: string;
  /** MSH-12 协议版本，例如 "2.5" */
  version: string;
  /** 原始文本（去掉 MLLP 框） */
  raw: string;
}

const DEFAULT_ENCODING: Hl7Encoding = {
  field: '|',
  component: '^',
  repetition: '~',
  escape: '\\',
  subcomponent: '&',
};

/**
 * 解析一条 HL7 v2 报文。
 *
 * 注意：调用方负责剥掉 MLLP 框（<SB> 和 <EB><CR>），传进来的应该是从 "MSH" 开头的纯文本。
 *
 * @throws Error 如果不是合法 HL7 报文（首段不是 MSH 或字段不够）
 */
export function parseHl7Message(raw: string): Hl7Message {
  if (!raw || typeof raw !== 'string') {
    throw new Error('HL7 parse: empty payload');
  }

  // 兼容用 \n 而不是 \r 的发送方（也偶尔见到 \r\n）
  const normalizedSeparator = raw.replace(/\r\n?/g, '\r').replace(/\n/g, '\r');
  const segmentStrings = normalizedSeparator
    .split('\r')
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0);

  if (segmentStrings.length === 0) {
    throw new Error('HL7 parse: no segments found');
  }

  const first = segmentStrings[0];
  if (!first.startsWith('MSH')) {
    throw new Error(`HL7 parse: first segment must be MSH, got ${first.slice(0, 3)}`);
  }
  if (first.length < 8) {
    throw new Error('HL7 parse: MSH segment too short');
  }

  // MSH 段的字段分隔符就是第 4 个字符，编码字符紧随其后到下一个字段分隔符
  const fieldSep = first.charAt(3);
  const encodingChars = first.substring(4, first.indexOf(fieldSep, 4));

  if (encodingChars.length < 4) {
    throw new Error('HL7 parse: MSH-2 encoding characters incomplete');
  }

  const encoding: Hl7Encoding = {
    field: fieldSep,
    component: encodingChars.charAt(0),
    repetition: encodingChars.charAt(1),
    escape: encodingChars.charAt(2),
    subcomponent: encodingChars.charAt(3),
  };

  const segments: Hl7Segment[] = segmentStrings.map((segText) => {
    const parts = segText.split(encoding.field);
    if (parts[0] === 'MSH') {
      // 对齐 MSH 段使其下标语义和其他段一致
      // 原始 split 结果: ["MSH", "<encodingChars>", "<SendingApp>", ...]
      // 期望:           ["MSH", "<fieldSep>",     "<encodingChars>", "<SendingApp>", ...]
      return {
        type: 'MSH',
        fields: ['MSH', encoding.field, encodingChars, ...parts.slice(1)],
      };
    }
    return {
      type: parts[0],
      fields: parts,
    };
  });

  const mshSegment = segments[0];
  const triggerEvent = (mshSegment.fields[9] ?? '').trim();
  const messageControlId = (mshSegment.fields[10] ?? '').trim();
  const version = (mshSegment.fields[12] ?? '').trim();

  return {
    encoding,
    segments,
    triggerEvent,
    messageControlId,
    version,
    raw,
  };
}

/**
 * 从报文中按段类型取出第一个匹配段。
 */
export function findSegment(msg: Hl7Message, type: string): Hl7Segment | undefined {
  return msg.segments.find((s) => s.type === type);
}

/**
 * 取出指定段的所有实例（HL7 允许重复段，例如多个 DG1）。
 */
export function findAllSegments(msg: Hl7Message, type: string): Hl7Segment[] {
  return msg.segments.filter((s) => s.type === type);
}

/**
 * 安全取字段：getField(seg, 5, 1, 0) 表示 "PID-5.1.0"（即第 5 字段，第 1 组件）。
 *
 * 注意：HL7 字段从 1 开始（不是 0），组件也从 1 开始。
 *      我们这里 fieldIndex / componentIndex 都按 HL7 自然计数。
 */
export function getField(
  segment: Hl7Segment | undefined,
  fieldIndex: number,
  componentIndex?: number,
  subComponentIndex?: number,
  encoding: Hl7Encoding = DEFAULT_ENCODING,
): string | undefined {
  if (!segment) return undefined;
  const fieldValue = segment.fields[fieldIndex];
  if (fieldValue === undefined || fieldValue === '') return undefined;

  // HL7 允许字段中出现重复（用 ~ 分隔），这里只取第一个重复
  const firstRepetition = fieldValue.split(encoding.repetition)[0];

  if (componentIndex === undefined) return firstRepetition;

  const components = firstRepetition.split(encoding.component);
  const componentValue = components[componentIndex - 1];
  if (componentValue === undefined || componentValue === '') return undefined;

  if (subComponentIndex === undefined) return componentValue;

  const subComponents = componentValue.split(encoding.subcomponent);
  return subComponents[subComponentIndex - 1];
}

/**
 * HL7 时间字符串解析。
 * HL7 时间格式：YYYYMMDDHHmmss[.SSSS][+/-ZZZZ]
 * 例如 "20260520143000" / "20260520" / "202605201430"
 *
 * 返回 ISO 8601 字符串，解析失败返回 undefined。
 */
export function parseHl7Timestamp(value: string | undefined): string | undefined {
  if (!value || value.length < 8) return undefined;
  const year = value.substring(0, 4);
  const month = value.substring(4, 6);
  const day = value.substring(6, 8);
  const hour = value.length >= 10 ? value.substring(8, 10) : '00';
  const minute = value.length >= 12 ? value.substring(10, 12) : '00';
  const second = value.length >= 14 ? value.substring(12, 14) : '00';
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

/**
 * 构造 HL7 ACK 报文（MSH + MSA 两段）。
 *
 * @param original           原始入站报文，用于回填 sending/receiving facility
 * @param ackCode            "AA" = Application Accept, "AE" = App Error, "AR" = App Reject
 * @param textMessage        可选，附带错误说明
 */
export function buildHl7Ack(
  original: Hl7Message,
  ackCode: 'AA' | 'AE' | 'AR',
  textMessage?: string,
): string {
  const msh = original.segments[0];
  // 把发送方/接收方互换
  const sendingApp = msh.fields[3] ?? '';
  const sendingFac = msh.fields[4] ?? '';
  const receivingApp = msh.fields[5] ?? '';
  const receivingFac = msh.fields[6] ?? '';
  const now = formatHl7Timestamp(new Date());
  const version = original.version || '2.5';
  const messageControlId = original.messageControlId || `ACK-${Date.now()}`;

  const fieldSep = original.encoding.field;
  const encodingChars = `${original.encoding.component}${original.encoding.repetition}${original.encoding.escape}${original.encoding.subcomponent}`;

  // ACK 自己的 messageControlId 应该不同；我们在原 ID 前加 "ACK-"
  const ackMsgId = `ACK-${messageControlId}`;
  const mshLine = [
    'MSH',
    encodingChars,
    receivingApp, // 互换
    receivingFac,
    sendingApp,
    sendingFac,
    now,
    '',
    `ACK^${original.triggerEvent.split('^')[1] ?? ''}`.replace(/\^$/, ''),
    ackMsgId,
    'P',
    version,
  ].join(fieldSep);

  const msaLine = ['MSA', ackCode, messageControlId, textMessage ?? ''].join(fieldSep);

  return `${mshLine}\r${msaLine}\r`;
}

/** Date → HL7 timestamp 字符串 YYYYMMDDHHmmss */
function formatHl7Timestamp(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}` +
    `${pad(d.getUTCMonth() + 1)}` +
    `${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}` +
    `${pad(d.getUTCMinutes())}` +
    `${pad(d.getUTCSeconds())}`
  );
}
