/** CLI 本地服务的扩展桥（Desk 协议 v1）。 */
export { ExtensionBridge, PROTOCOL_VERSION, defaultAuthFile } from './ws-bridge.js'
export type { BridgeOptions, BridgeHelloInfo, DeskEventHandler } from './ws-bridge.js'
export type { PlatformInfo, SyncResult, RequestMessage, ResponseMessage } from './types.js'