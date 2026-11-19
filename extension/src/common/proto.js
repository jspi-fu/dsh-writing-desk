// 桥协议客户端镜像(cli/src/proto.js 的另一半):报文形状与常量保持一致。
// 协议事实:hello 握手带 token(一次性),之后 request/result 往返;publish/platforms/extract
// 是桥发给扩展的请求,capture 是扩展发给桥的请求。
export const PROTOCOL_VERSION = 1

export function helloMessage(token) {
  return { type: 'hello', v: PROTOCOL_VERSION, client: 'extension', token }
}
